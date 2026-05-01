import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  inventoryItems,
  codesApprovalHistory,
  codesApprovalRouting,
  codesRoleAssignments,
  type CodesRole,
  CODES_ROLES,
  CODES_ROLE_LABELS,
} from '@db/schema';
import {
  type ApprovalState,
  type CodeKind,
  CODE_KINDS,
  assertCanTransitionAndResolve,
  routingNextStage,
} from '@/server/codes/approval-state-machine';
import {
  assertHasCodesRole,
  assertHasAnyCodesRole,
  listUserCodesRoles,
} from '@/server/codes/approval-permissions';
import { describeSla, slaRemainingPct } from '@/server/codes/approval-sla';
import { writeAuditLog } from '@/lib/audit/logger';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

// =============================================================================
// codes.approvals.* — approval workflow router (Phase 2)
// =============================================================================
// Per Q3-locked design + Phase 2 PRD-line scope:
//   - submit         draft → first applicable stage (per routing config)
//   - clinicalApprove pending_clinical_review → pending_master_data_review
//   - mdoApprove     pending_master_data_review → active (or pending_cms_gm_review)
//   - cmsGmApprove   pending_cms_gm_review → active (Phase 3+)
//   - reject         pending_* → rejected (with feedback note)
//   - resubmit       rejected → draft
//   - listForStage   queue view filtered by reviewer's role
//   - listMyHistory  user's own actions across all items
//   - getDetail      one item + its full history
//   - bootstrapHistorical (super_admin only) — historical migration of pre-Phase-2 items
//   - assignRole / revokeRole / listRoles / listMyRoles — RBAC management
// =============================================================================

// ─── helpers ────────────────────────────────────────────────────────────────

/** Best-effort code-kind classification for an inventory item. */
function inferCodeKind(itemType: string, itemCategory: string | null): CodeKind {
  const t = (itemType || '').toLowerCase();
  const c = (itemCategory || '').toLowerCase();
  if (t.includes('drug') || c === 'drug' || c === 'medicine') return 'drug';
  if (t.includes('implant') || c === 'implant') return 'implant';
  if (t.includes('procedure') || c === 'procedure') return 'procedure';
  if (t.includes('lab') || c === 'lab' || c === 'lab_test') return 'lab_test';
  if (t.includes('imaging') || c === 'radiology' || c === 'imaging_study') return 'imaging_study';
  if (t.includes('pack') || c === 'pack') return 'pack';
  return 'consumable'; // default fallback per Q3 routing matrix
}

async function loadRouting(hospital_id: string, code_kind: CodeKind) {
  const rows = await db
    .select()
    .from(codesApprovalRouting)
    .where(and(
      eq(codesApprovalRouting.hospital_id, hospital_id),
      eq(codesApprovalRouting.code_kind, code_kind),
      eq(codesApprovalRouting.is_active, true),
    ))
    .limit(1);
  if (rows.length === 0) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `No approval routing configured for hospital=${hospital_id} kind=${code_kind}. Seed via codes_approval_routing.`,
    });
  }
  const r = rows[0];
  return {
    code_kind: r.code_kind as CodeKind,
    clinical_role: (r.clinical_role as CodesRole | null),
    requires_cms_gm_for_high_impact: r.requires_cms_gm_for_high_impact,
    sla_clinical_working_days: r.sla_clinical_working_days,
    sla_mdo_working_days: r.sla_mdo_working_days,
    sla_cms_gm_working_days: r.sla_cms_gm_working_days,
  };
}

async function recordTransition(args: {
  hospital_id: string;
  item_id: string;
  code_kind: CodeKind;
  from_state: string;
  to_state: ApprovalState;
  actor_user_id: string;
  actor_role: string;
  sla_remaining_pct_at_action: number | null;
  feedback_note: string | null;
}) {
  await db.insert(codesApprovalHistory).values({
    hospital_id: args.hospital_id,
    item_id: args.item_id,
    code_kind: args.code_kind,
    from_state: args.from_state,
    to_state: args.to_state,
    actor_user_id: args.actor_user_id,
    actor_role: args.actor_role,
    sla_remaining_pct_at_action: args.sla_remaining_pct_at_action !== null
      ? String(args.sla_remaining_pct_at_action)
      : null,
    feedback_note: args.feedback_note,
  });
}

// ─── procedures ────────────────────────────────────────────────────────────

/** submit — draft → first applicable stage (per routing) */
export const submitProcedure = protectedProcedure
  .input(z.object({ item_id: z.string().uuid(), feedback_note: z.string().optional() }))
  .mutation(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, input.item_id))
      .limit(1);
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
    if (item.status !== 'draft' && item.status !== 'rejected') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `submit requires status=draft|rejected; got ${item.status}`,
      });
    }

    const code_kind = inferCodeKind(item.item_type, item.item_category);
    const routing = await loadRouting(hospitalId, code_kind);
    const callerRoles = await listUserCodesRoles(hospitalId, ctx.user.sub);

    const { toState } = assertCanTransitionAndResolve({
      action: 'submit',
      fromState: item.status as ApprovalState,
      routing,
      isHighImpact: false,
      callerCodesRoles: callerRoles,
      callerSystemRole: ctx.user.role,
    });

    await db
      .update(inventoryItems)
      .set({ status: toState, updated_at: new Date() })
      .where(eq(inventoryItems.id, input.item_id));

    await recordTransition({
      hospital_id: hospitalId,
      item_id: input.item_id,
      code_kind,
      from_state: item.status,
      to_state: toState,
      actor_user_id: ctx.user.sub,
      actor_role: ctx.user.role,
      sla_remaining_pct_at_action: 100, // SLA clock starts at submit
      feedback_note: input.feedback_note ?? null,
    });

    await writeAuditLog({
      action: 'UPDATE',
      table: 'inventory_items',
      row_id: input.item_id,
      actor_id: ctx.user.sub,
      hospital_id: hospitalId,
      new_values: { status: toState, transitioned_via: 'submit' },
    });

    return { item_id: input.item_id, new_state: toState };
  });

/** Helper used by clinicalApprove + mdoApprove + cmsGmApprove. */
async function performApproveTransition(
  ctx: any,
  input: { item_id: string },
  action: 'clinical_approve' | 'mdo_approve' | 'cms_gm_approve',
) {
  const hospitalId = ctx.user.hospital_id;
  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, input.item_id))
    .limit(1);
  if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
  const code_kind = inferCodeKind(item.item_type, item.item_category);
  const routing = await loadRouting(hospitalId, code_kind);
  const callerRoles = await listUserCodesRoles(hospitalId, ctx.user.sub);

  const { toState } = assertCanTransitionAndResolve({
    action,
    fromState: item.status as ApprovalState,
    routing,
    isHighImpact: false, // Phase 2: no high-impact rules yet
    callerCodesRoles: callerRoles,
    callerSystemRole: ctx.user.role,
  });

  // SLA-remaining at action: pull most recent state-transition's createdAt
  const [lastHistory] = await db
    .select({ created_at: codesApprovalHistory.created_at })
    .from(codesApprovalHistory)
    .where(eq(codesApprovalHistory.item_id, input.item_id))
    .orderBy(desc(codesApprovalHistory.created_at))
    .limit(1);

  let slaPct: number | null = null;
  if (lastHistory) {
    const slaDays =
      action === 'clinical_approve'
        ? routing.sla_clinical_working_days
        : action === 'mdo_approve'
        ? routing.sla_mdo_working_days
        : routing.sla_cms_gm_working_days;
    slaPct = slaRemainingPct(new Date(lastHistory.created_at), slaDays);
  }

  await db
    .update(inventoryItems)
    .set({ status: toState, updated_at: new Date() })
    .where(eq(inventoryItems.id, input.item_id));

  await recordTransition({
    hospital_id: hospitalId,
    item_id: input.item_id,
    code_kind,
    from_state: item.status,
    to_state: toState,
    actor_user_id: ctx.user.sub,
    actor_role: ctx.user.role,
    sla_remaining_pct_at_action: slaPct,
    feedback_note: null,
  });

  await writeAuditLog({
    action: 'UPDATE',
    table: 'inventory_items',
    row_id: input.item_id,
    actor_id: ctx.user.sub,
    hospital_id: hospitalId,
    new_values: { status: toState, transitioned_via: action },
  });

  return { item_id: input.item_id, new_state: toState };
}

export const clinicalApproveProcedure = protectedProcedure
  .input(z.object({ item_id: z.string().uuid() }))
  .mutation(({ ctx, input }) => performApproveTransition(ctx, input, 'clinical_approve'));

export const mdoApproveProcedure = protectedProcedure
  .input(z.object({ item_id: z.string().uuid() }))
  .mutation(({ ctx, input }) => performApproveTransition(ctx, input, 'mdo_approve'));

export const cmsGmApproveProcedure = protectedProcedure
  .input(z.object({ item_id: z.string().uuid() }))
  .mutation(({ ctx, input }) => performApproveTransition(ctx, input, 'cms_gm_approve'));

export const rejectProcedure = protectedProcedure
  .input(z.object({
    item_id: z.string().uuid(),
    feedback_note: z.string().min(1, 'feedback_note required for reject'),
  }))
  .mutation(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, input.item_id))
      .limit(1);
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
    const code_kind = inferCodeKind(item.item_type, item.item_category);
    const routing = await loadRouting(hospitalId, code_kind);
    const callerRoles = await listUserCodesRoles(hospitalId, ctx.user.sub);

    const { toState } = assertCanTransitionAndResolve({
      action: 'reject',
      fromState: item.status as ApprovalState,
      routing,
      isHighImpact: false,
      callerCodesRoles: callerRoles,
      callerSystemRole: ctx.user.role,
      feedbackNote: input.feedback_note,
    });

    await db
      .update(inventoryItems)
      .set({ status: toState, updated_at: new Date() })
      .where(eq(inventoryItems.id, input.item_id));

    await recordTransition({
      hospital_id: hospitalId,
      item_id: input.item_id,
      code_kind,
      from_state: item.status,
      to_state: toState,
      actor_user_id: ctx.user.sub,
      actor_role: ctx.user.role,
      sla_remaining_pct_at_action: null,
      feedback_note: input.feedback_note,
    });

    await writeAuditLog({
      action: 'UPDATE',
      table: 'inventory_items',
      row_id: input.item_id,
      actor_id: ctx.user.sub,
      hospital_id: hospitalId,
      new_values: { status: toState, transitioned_via: 'reject', reason: input.feedback_note },
    });

    return { item_id: input.item_id, new_state: toState };
  });

export const resubmitProcedure = protectedProcedure
  .input(z.object({ item_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, input.item_id))
      .limit(1);
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
    if (item.status !== 'rejected') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `resubmit requires status=rejected; got ${item.status}`,
      });
    }
    const code_kind = inferCodeKind(item.item_type, item.item_category);

    await db
      .update(inventoryItems)
      .set({ status: 'draft', updated_at: new Date() })
      .where(eq(inventoryItems.id, input.item_id));

    await recordTransition({
      hospital_id: hospitalId,
      item_id: input.item_id,
      code_kind,
      from_state: 'rejected',
      to_state: 'draft',
      actor_user_id: ctx.user.sub,
      actor_role: ctx.user.role,
      sla_remaining_pct_at_action: null,
      feedback_note: null,
    });

    return { item_id: input.item_id, new_state: 'draft' as const };
  });

/**
 * listForStage — queue surface for a reviewer. Returns items in the state
 * the caller's role can act on. Computes SLA severity per row.
 */
export const listForStageProcedure = protectedProcedure
  .input(z.object({
    stage: z.enum(['pending_clinical_review', 'pending_master_data_review', 'pending_cms_gm_review', 'rejected']).optional(),
    code_kind: z.enum(CODE_KINDS as unknown as [CodeKind, ...CodeKind[]]).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }))
  .query(async ({ ctx, input }) => {
    const hospitalId = ctx.user.hospital_id;
    const callerRoles = await listUserCodesRoles(hospitalId, ctx.user.sub);
    const isAdmin = ctx.user.role === 'super_admin' || ctx.user.role === 'hospital_admin';

    // Default-stage filter: derive from caller's roles if not explicit.
    let stageFilter: ApprovalState[] = [];
    if (input.stage) {
      stageFilter = [input.stage as ApprovalState];
    } else if (isAdmin) {
      stageFilter = ['pending_clinical_review', 'pending_master_data_review', 'pending_cms_gm_review'];
    } else {
      // Map caller's codes_role → which stages they can act on
      if (callerRoles.includes('master_data_officer')) stageFilter.push('pending_master_data_review');
      if (callerRoles.includes('pharmacy_supervisor')) stageFilter.push('pending_clinical_review');
      if (callerRoles.includes('cath_lab_lead')) stageFilter.push('pending_clinical_review');
      if (callerRoles.includes('lab_lead')) stageFilter.push('pending_clinical_review');
      if (callerRoles.includes('radiology_lead')) stageFilter.push('pending_clinical_review');
      if (callerRoles.includes('cms_gm_approver')) stageFilter.push('pending_cms_gm_review');
    }
    if (stageFilter.length === 0) {
      return { items: [], count: 0 };
    }

    const items = await db
      .select()
      .from(inventoryItems)
      .where(inArray(inventoryItems.status, stageFilter as string[]))
      .orderBy(desc(inventoryItems.updated_at))
      .limit(input.limit);

    // Decorate each item with last-history + SLA
    const itemIds = items.map((i) => i.id);
    const history = itemIds.length
      ? await db
          .select()
          .from(codesApprovalHistory)
          .where(inArray(codesApprovalHistory.item_id, itemIds))
          .orderBy(desc(codesApprovalHistory.created_at))
      : [];

    // For each item find the entry into its CURRENT state (latest to_state == current status)
    const lastByItem = new Map<string, typeof history[number]>();
    for (const h of history) {
      const prev = lastByItem.get(h.item_id);
      if (!prev || new Date(h.created_at) > new Date(prev.created_at)) {
        lastByItem.set(h.item_id, h);
      }
    }

    const decorated = items.map((it) => {
      const lh = lastByItem.get(it.id);
      const codeKind = inferCodeKind(it.item_type, it.item_category);
      // Decorate with SLA only if we know the routing AND there's an entry-point timestamp
      let sla = null;
      if (lh) {
        // Best-effort: use 2 working days (MDO default) for SLA chip if we can't
        // load routing here (we'd issue N+1 queries otherwise). Refinement candidate.
        const slaDays = it.status === 'pending_clinical_review' ? 3
          : it.status === 'pending_master_data_review' ? 2
          : it.status === 'pending_cms_gm_review' ? 2
          : 0;
        if (slaDays > 0) {
          sla = describeSla(new Date(lh.created_at), slaDays);
        }
      }
      return {
        item: it,
        code_kind: codeKind,
        last_transition: lh,
        sla,
      };
    });

    return { items: decorated, count: decorated.length };
  });

/** listMyHistory — actions performed by caller across all items */
export const listMyHistoryProcedure = protectedProcedure
  .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
  .query(async ({ ctx, input }) => {
    const rows = await db
      .select()
      .from(codesApprovalHistory)
      .where(and(
        eq(codesApprovalHistory.hospital_id, ctx.user.hospital_id),
        eq(codesApprovalHistory.actor_user_id, ctx.user.sub),
      ))
      .orderBy(desc(codesApprovalHistory.created_at))
      .limit(input.limit);
    return { history: rows, count: rows.length };
  });

/** getDetail — one item + full history */
export const getDetailProcedure = protectedProcedure
  .input(z.object({ item_id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const [item] = await db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, input.item_id))
      .limit(1);
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found' });
    const history = await db
      .select()
      .from(codesApprovalHistory)
      .where(eq(codesApprovalHistory.item_id, input.item_id))
      .orderBy(desc(codesApprovalHistory.created_at));
    return {
      item,
      history,
      code_kind: inferCodeKind(item.item_type, item.item_category),
    };
  });

// ─── RBAC management ───────────────────────────────────────────────────────

export const assignRoleProcedure = protectedProcedure
  .input(z.object({
    user_id: z.string().uuid(),
    codes_role: z.enum(CODES_ROLES as unknown as [CodesRole, ...CodesRole[]]),
    notes: z.string().optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (!['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only super_admin / hospital_admin may assign codes roles' });
    }
    const inserted = await db.insert(codesRoleAssignments).values({
      hospital_id: ctx.user.hospital_id,
      user_id: input.user_id,
      codes_role: input.codes_role,
      assigned_by: ctx.user.sub,
      notes: input.notes ?? null,
    }).returning();
    await writeAuditLog({
      action: 'INSERT',
      table: 'codes_role_assignments',
      row_id: inserted[0].id,
      actor_id: ctx.user.sub,
      hospital_id: ctx.user.hospital_id,
      new_values: { user_id: input.user_id, codes_role: input.codes_role },
    });
    return inserted[0];
  });

export const revokeRoleProcedure = protectedProcedure
  .input(z.object({ assignment_id: z.string().uuid(), notes: z.string().optional() }))
  .mutation(async ({ ctx, input }) => {
    if (!['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only super_admin / hospital_admin may revoke codes roles' });
    }
    const [updated] = await db
      .update(codesRoleAssignments)
      .set({
        revoked_at: new Date(),
        revoked_by: ctx.user.sub,
        notes: input.notes ?? null,
      })
      .where(and(
        eq(codesRoleAssignments.id, input.assignment_id),
        eq(codesRoleAssignments.hospital_id, ctx.user.hospital_id),
        isNull(codesRoleAssignments.revoked_at),
      ))
      .returning();
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Active assignment not found' });
    await writeAuditLog({
      action: 'UPDATE',
      table: 'codes_role_assignments',
      row_id: input.assignment_id,
      actor_id: ctx.user.sub,
      hospital_id: ctx.user.hospital_id,
      new_values: { revoked_at: updated.revoked_at },
    });
    return updated;
  });

export const listRolesProcedure = protectedProcedure
  .input(z.object({ active_only: z.boolean().default(true) }).optional())
  .query(async ({ ctx, input }) => {
    const where = input?.active_only ?? true
      ? and(
          eq(codesRoleAssignments.hospital_id, ctx.user.hospital_id),
          isNull(codesRoleAssignments.revoked_at),
        )
      : eq(codesRoleAssignments.hospital_id, ctx.user.hospital_id);
    const rows = await db.select().from(codesRoleAssignments).where(where);
    return { assignments: rows, role_labels: CODES_ROLE_LABELS, count: rows.length };
  });

export const listMyRolesProcedure = protectedProcedure.query(async ({ ctx }) => {
  const roles = await listUserCodesRoles(ctx.user.hospital_id, ctx.user.sub);
  return { roles, role_labels: CODES_ROLE_LABELS };
});

// ─── bootstrapHistorical (one-time, super_admin only) ──────────────────────

/**
 * Walk all inventory_items in a hospital that have status='active' but no
 * codes_approval_history rows, and write a single 'system_bootstrap' history
 * entry for each. Idempotent — items that already have at least one history
 * row are skipped.
 *
 * Called once after Phase 2 migration applies; existing 1,762 EHRC items
 * each get one anchor row labeled actor_role='system'.
 */
export const bootstrapHistoricalProcedure = protectedProcedure
  .input(z.object({}).optional())
  .mutation(async ({ ctx }) => {
    if (ctx.user.role !== 'super_admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only super_admin may bootstrap historical approval rows' });
    }
    const hospitalId = ctx.user.hospital_id;
    // Find items that don't yet have a history row (LEFT JOIN approach).
    // For simplicity issue 2 queries: (1) items at hospital, (2) item_ids with history.
    const items = await db
      .select({
        id: inventoryItems.id,
        item_type: inventoryItems.item_type,
        item_category: inventoryItems.item_category,
        status: inventoryItems.status,
      })
      .from(inventoryItems);
    const ids = items.map((i) => i.id);
    const seenIds = new Set<string>();
    if (ids.length) {
      const seen = await db
        .select({ item_id: codesApprovalHistory.item_id })
        .from(codesApprovalHistory)
        .where(inArray(codesApprovalHistory.item_id, ids));
      for (const r of seen) seenIds.add(r.item_id);
    }

    const toInsert = items
      .filter((it) => !seenIds.has(it.id))
      .map((it) => ({
        hospital_id: hospitalId,
        item_id: it.id,
        code_kind: inferCodeKind(it.item_type, it.item_category) as string,
        from_state: '__bootstrap',
        to_state: it.status, // matches whatever the row currently is
        actor_user_id: null,
        actor_role: 'system',
        sla_remaining_pct_at_action: null,
        feedback_note: 'Phase 2 historical bootstrap — pre-approval-flow item, anchored at current status',
      }));

    if (toInsert.length === 0) {
      return { inserted: 0, already_anchored: items.length };
    }
    // Batch insert (Drizzle handles multi-row VALUES under the hood for us)
    await db.insert(codesApprovalHistory).values(toInsert);
    return { inserted: toInsert.length, already_anchored: items.length - toInsert.length };
  });

// ─── Composed router ───────────────────────────────────────────────────────

export const codesApprovalsRouter = router({
  submit: submitProcedure,
  clinicalApprove: clinicalApproveProcedure,
  mdoApprove: mdoApproveProcedure,
  cmsGmApprove: cmsGmApproveProcedure,
  reject: rejectProcedure,
  resubmit: resubmitProcedure,
  listForStage: listForStageProcedure,
  listMyHistory: listMyHistoryProcedure,
  getDetail: getDetailProcedure,
  assignRole: assignRoleProcedure,
  revokeRole: revokeRoleProcedure,
  listRoles: listRolesProcedure,
  listMyRoles: listMyRolesProcedure,
  bootstrapHistorical: bootstrapHistoricalProcedure,
});
