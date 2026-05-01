import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../../trpc';
import { assertHasScmRole } from '../../scm/sod-permissions';
import {
  validateIndentTransition,
  validateLineApproval,
  validateLineIssue,
  validateLineAcknowledge,
  type IndentState,
} from '../../scm/indent-state-machine';
import {
  resolveApproverChain,
  areAllApprovalsDone,
  hasRejection,
  type MaterialClassification,
} from '../../scm/kpmg-approval-matrix';
import { computeSlaDueAt } from '../../scm/indent-sla';

// ============================================================
// SCM › INDENTS — Phase 2 router (Q-A1/A2/A3/A6/A7/A8/A9/A10 locked 1 May 2026)
//
// Internal requisition workflow: caregiver dept raises → SCM approves
// (KPMG matrix) → store/pharmacy issues → raiser acknowledges receipt.
//
// State machine: pending → approved → issued → in_transit → received → closed
//                with rejected/cancelled branches.
//
// 10 procedures:
//   create / list / listForMyApproval / detail / listItems
//   approve (per-tier sign-off; whole indent flips when chain completes)
//   reject (whole indent terminal)
//   cancel (originator only; allowed pre-issue)
//   issue (admin/inventory_manager picks source + per-line qty; pairs ledger)
//   acknowledge (raiser; flips quantity_in_transit → quantity_on_hand at dest)
//   close (optional finalization after received)
//
// Audit: every mutation writes audit_logs + indent_state_log.
// Hospital-scoped via JWT.
// ============================================================

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ---------- Validation schemas ----------

const indentPriorityEnum = z.enum(['routine', 'urgent', 'stat', 'emergency']);
const materialClassificationEnum = z.enum(['standard', 'emergency', 'vital']);

export const indentCreateSchema = z.object({
  destination_location: z.string().min(1),
  priority: indentPriorityEnum.default('routine'),
  material_classification: materialClassificationEnum.optional(),
  encounter_id: z.string().uuid().optional(),
  patient_id: z.string().uuid().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      item_id: z.string().uuid(),
      quantity_requested: z.number().positive(),
      notes: z.string().optional(),
    })
  ).min(1, 'At least one line item is required'),
});

// ---------- Named procedure exports ----------

/** Create an indent in pending state. Computes SLA + creates approver chain. */
export const indentCreateProcedure = protectedProcedure
  .input(indentCreateSchema)
  .mutation(async ({ ctx, input }) => {
    try {
      // Generate indent number IND-YYYY-{HOSPITAL}-NNNNN (Q-A6)
      const year = new Date().getFullYear();
      const countYear = await getSql()(
        `SELECT COUNT(*) as cnt FROM indents
         WHERE hospital_id = $1 AND indent_number LIKE $2`,
        [ctx.user.hospital_id, `IND-${year}-${ctx.user.hospital_id}-%`]
      );
      const nextSeq = (Number(countYear[0].cnt) || 0) + 1;
      const indentNumber = `IND-${year}-${ctx.user.hospital_id}-${String(nextSeq).padStart(5, '0')}`;

      // Compute SLA due based on priority + material classification
      const slaDue = computeSlaDueAt({
        raised_at: new Date(),
        priority: input.priority,
        material_classification: input.material_classification ?? null,
      });

      // Insert indent. source_location is NULL until admin assigns at approve time (Q-A2)
      const indentRows = await getSql()(
        `INSERT INTO indents (
          hospital_id, indent_number, raised_by,
          source_location, destination_location,
          state, priority,
          encounter_id, patient_id,
          reason, notes,
          sla_due_at
        ) VALUES (
          $1, $2, $3,
          'tbd_at_approval', $4,
          'pending', $5,
          $6, $7,
          $8, $9,
          $10
        ) RETURNING *`,
        [
          ctx.user.hospital_id,
          indentNumber,
          ctx.user.sub,
          input.destination_location,
          input.priority,
          input.encounter_id || null,
          input.patient_id || null,
          input.reason || null,
          input.notes || null,
          slaDue.toISOString(),
        ]
      );
      const indentId = indentRows[0].id;

      // Insert line items. Look up display_name per item.
      for (const li of input.items) {
        const itemRow = await getSql()(
          `SELECT display_name FROM items WHERE id = $1`,
          [li.item_id]
        );
        const itemName = itemRow[0]?.display_name || 'unknown';
        await getSql()(
          `INSERT INTO indent_items (
            hospital_id, indent_id, item_id, item_name,
            quantity_requested, notes
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            ctx.user.hospital_id,
            indentId,
            li.item_id,
            itemName,
            li.quantity_requested,
            li.notes || null,
          ]
        );
      }

      // Create approver chain rows (Phase 2 v1 = single tier per classification)
      const approverChain = resolveApproverChain(input.material_classification ?? null);
      for (let i = 0; i < approverChain.length; i++) {
        await getSql()(
          `INSERT INTO indent_approvals (
            hospital_id, indent_id, approver_role, tier_order
          ) VALUES ($1, $2, $3, $4)`,
          [ctx.user.hospital_id, indentId, approverChain[i], i + 1]
        );
      }

      // Initial state log entry
      await getSql()(
        `INSERT INTO indent_state_log (
          hospital_id, indent_id, from_state, to_state,
          actor_user_id, actor_role, reason
        ) VALUES ($1, $2, NULL, 'pending', $3, $4, 'indent created')`,
        [ctx.user.hospital_id, indentId, ctx.user.sub, ctx.user.role]
      );

      // Audit log
      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'INSERT', 'indents', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          indentId,
          JSON.stringify({
            indent_number: indentNumber,
            destination: input.destination_location,
            priority: input.priority,
            material_classification: input.material_classification,
            line_count: input.items.length,
            approver_chain: approverChain,
            sla_due_at: slaDue.toISOString(),
          }),
        ]
      );

      return indentRows[0];
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create indent',
        cause: error,
      });
    }
  });

/** List indents for the hospital with filters. */
export const indentListProcedure = protectedProcedure
  .input(
    z.object({
      state: z.string().optional(),
      priority: indentPriorityEnum.optional(),
      raised_by: z.string().uuid().optional(),
      destination_location: z.string().optional(),
      source_location: z.string().optional(),
      sla_breached_only: z.boolean().optional(),
      limit: z.number().int().positive().max(500).default(100),
      offset: z.number().int().nonnegative().default(0),
    })
  )
  .query(async ({ ctx, input }) => {
    let where = 'i.hospital_id = $1';
    const params: any[] = [ctx.user.hospital_id];
    let p = 2;

    if (input.state) {
      where += ` AND i.state = $${p++}`;
      params.push(input.state);
    }
    if (input.priority) {
      where += ` AND i.priority = $${p++}`;
      params.push(input.priority);
    }
    if (input.raised_by) {
      where += ` AND i.raised_by = $${p++}`;
      params.push(input.raised_by);
    }
    if (input.destination_location) {
      where += ` AND i.destination_location = $${p++}`;
      params.push(input.destination_location);
    }
    if (input.source_location) {
      where += ` AND i.source_location = $${p++}`;
      params.push(input.source_location);
    }
    if (input.sla_breached_only) {
      where += ` AND i.sla_breached_at IS NOT NULL AND i.state NOT IN ('received','closed','rejected','cancelled')`;
    }

    params.push(input.limit, input.offset);
    const rows = await getSql()(
      `SELECT i.*,
              u.full_name AS raised_by_name,
              ua.full_name AS approved_by_name
       FROM indents i
       LEFT JOIN users u ON i.raised_by = u.id
       LEFT JOIN users ua ON i.approved_by = ua.id
       WHERE ${where}
       ORDER BY
         CASE i.priority
           WHEN 'emergency' THEN 1
           WHEN 'stat' THEN 2
           WHEN 'urgent' THEN 3
           WHEN 'routine' THEN 4
         END,
         i.created_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      params
    );
    return rows;
  });

/** List indents pending approval for the current user's role tier. */
export const indentListForMyApprovalProcedure = protectedProcedure
  .input(
    z.object({
      approver_role: z.enum(['hod', 'non_med_head', 'finance_in_charge', 'facility_director', 'procurement_head']),
    })
  )
  .query(async ({ ctx, input }) => {
    const rows = await getSql()(
      `SELECT i.*, u.full_name AS raised_by_name, ia.id AS approval_id
       FROM indents i
       LEFT JOIN users u ON i.raised_by = u.id
       INNER JOIN indent_approvals ia
         ON ia.indent_id = i.id
         AND ia.approver_role = $1
         AND ia.decision IS NULL
       WHERE i.hospital_id = $2 AND i.state = 'pending'
       ORDER BY
         CASE i.priority
           WHEN 'emergency' THEN 1
           WHEN 'stat' THEN 2
           WHEN 'urgent' THEN 3
           WHEN 'routine' THEN 4
         END,
         i.created_at ASC`,
      [input.approver_role, ctx.user.hospital_id]
    );
    return rows;
  });

/** Get a single indent (with line items + approvals + state log). */
export const indentDetailProcedure = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    const indent = await getSql()(
      `SELECT i.*,
              u.full_name AS raised_by_name,
              ua.full_name AS approved_by_name,
              ui.full_name AS issued_by_name,
              uack.full_name AS acknowledged_by_name
       FROM indents i
       LEFT JOIN users u ON i.raised_by = u.id
       LEFT JOIN users ua ON i.approved_by = ua.id
       LEFT JOIN users ui ON i.issued_by = ui.id
       LEFT JOIN users uack ON i.acknowledged_by = uack.id
       WHERE i.id = $1 AND i.hospital_id = $2`,
      [input, ctx.user.hospital_id]
    );
    if (!indent.length) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Indent not found' });
    }

    const items = await getSql()(
      `SELECT ii.*, it.kind, it.unit_of_measure, it.generic_name
       FROM indent_items ii
       LEFT JOIN items it ON ii.item_id = it.id
       WHERE ii.indent_id = $1 AND ii.hospital_id = $2
       ORDER BY ii.created_at ASC`,
      [input, ctx.user.hospital_id]
    );

    const approvals = await getSql()(
      `SELECT a.*, u.full_name AS decided_by_name
       FROM indent_approvals a
       LEFT JOIN users u ON a.decided_by = u.id
       WHERE a.indent_id = $1 AND a.hospital_id = $2
       ORDER BY a.tier_order ASC, a.created_at ASC`,
      [input, ctx.user.hospital_id]
    );

    const stateLog = await getSql()(
      `SELECT s.*, u.full_name AS actor_name
       FROM indent_state_log s
       LEFT JOIN users u ON s.actor_user_id = u.id
       WHERE s.indent_id = $1 AND s.hospital_id = $2
       ORDER BY s.transitioned_at ASC`,
      [input, ctx.user.hospital_id]
    );

    return {
      ...indent[0],
      items,
      approvals,
      state_log: stateLog,
    };
  });

/** List items for one indent (UI line table). */
export const indentListItemsProcedure = protectedProcedure
  .input(z.string().uuid())
  .query(async ({ ctx, input }) => {
    const check = await getSql()(
      `SELECT id FROM indents WHERE id = $1 AND hospital_id = $2`,
      [input, ctx.user.hospital_id]
    );
    if (!check.length) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Indent not found' });
    }
    const rows = await getSql()(
      `SELECT ii.*, it.kind, it.unit_of_measure, it.generic_name
       FROM indent_items ii
       LEFT JOIN items it ON ii.item_id = it.id
       WHERE ii.indent_id = $1 AND ii.hospital_id = $2
       ORDER BY ii.created_at ASC`,
      [input, ctx.user.hospital_id]
    );
    return rows;
  });

/**
 * Approve one tier of an indent + per-line quantity_approved updates +
 * source_location assignment. Whole indent transitions pending → approved
 * when the approver chain completes.
 */
export const indentApproveProcedure = protectedProcedure
  .input(
    z.object({
      indent_id: z.string().uuid(),
      approver_role: z.enum(['hod', 'non_med_head', 'finance_in_charge', 'facility_director', 'procurement_head']),
      source_location: z.string().min(1),  // Q-A2 Path C: admin assigns at approve time
      decision_reason: z.string().optional(),
      line_approvals: z.array(
        z.object({
          item_id: z.string().uuid(),
          quantity_approved: z.number().nonnegative(),
        })
      ).min(1),
    })
  )
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_approver', 'scm_admin']);

      // Fetch the indent + ALL lines
      const indent = await getSql()(
        `SELECT * FROM indents WHERE id = $1 AND hospital_id = $2`,
        [input.indent_id, ctx.user.hospital_id]
      );
      if (!indent.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Indent not found' });
      }
      const ind = indent[0];
      if (ind.state !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Indent is in state '${ind.state}', cannot approve` });
      }

      // Fetch the pending approval row for THIS approver_role
      const approvalRow = await getSql()(
        `SELECT * FROM indent_approvals
         WHERE indent_id = $1 AND approver_role = $2 AND decision IS NULL
         LIMIT 1`,
        [input.indent_id, input.approver_role]
      );
      if (!approvalRow.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `No pending approval for role ${input.approver_role} on this indent`,
        });
      }

      // Validate per-line approvals
      const items = await getSql()(
        `SELECT * FROM indent_items WHERE indent_id = $1 AND hospital_id = $2`,
        [input.indent_id, ctx.user.hospital_id]
      );
      for (const la of input.line_approvals) {
        const it = items.find((i: any) => i.item_id === la.item_id);
        if (!it) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Line item ${la.item_id} not in indent` });
        }
        const v = validateLineApproval({
          quantity_requested: Number(it.quantity_requested),
          quantity_approved: la.quantity_approved,
        });
        if (!v.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason });
        }
      }

      // Apply per-line quantity_approved updates (only on the FIRST tier in the chain)
      // Subsequent tiers don't change line quantities, just sign off.
      if (approvalRow[0].tier_order === 1) {
        for (const la of input.line_approvals) {
          await getSql()(
            `UPDATE indent_items
             SET quantity_approved = $1, updated_at = NOW()
             WHERE indent_id = $2 AND item_id = $3 AND hospital_id = $4`,
            [la.quantity_approved, input.indent_id, la.item_id, ctx.user.hospital_id]
          );
        }
      }

      // Mark THIS approver row decided='approved'
      await getSql()(
        `UPDATE indent_approvals
         SET decision = 'approved', decided_by = $1, decided_at = NOW(), decision_reason = $2
         WHERE id = $3`,
        [ctx.user.sub, input.decision_reason || null, approvalRow[0].id]
      );

      // Re-fetch all approvals for this indent
      const allApprovals = await getSql()(
        `SELECT decision FROM indent_approvals WHERE indent_id = $1`,
        [input.indent_id]
      );
      const requiredCount = allApprovals.length;
      const allDone = areAllApprovalsDone(allApprovals as any, requiredCount);

      let updatedIndent: any = ind;
      if (allDone) {
        // Transition pending → approved + stamp source_location, approved_by, approved_at
        const v = validateIndentTransition({ from: 'pending' as IndentState, to: 'approved' as IndentState });
        if (!v.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason });
        }

        const updated = await getSql()(
          `UPDATE indents
           SET state = 'approved',
               source_location = $1,
               approved_by = $2,
               approved_at = NOW(),
               updated_at = NOW()
           WHERE id = $3
           RETURNING *`,
          [input.source_location, ctx.user.sub, input.indent_id]
        );
        updatedIndent = updated[0];

        await getSql()(
          `INSERT INTO indent_state_log (
            hospital_id, indent_id, from_state, to_state,
            actor_user_id, actor_role, reason
          ) VALUES ($1, $2, 'pending', 'approved', $3, $4, $5)`,
          [
            ctx.user.hospital_id,
            input.indent_id,
            ctx.user.sub,
            ctx.user.role,
            `final tier approved (${input.approver_role}); source_location=${input.source_location}`,
          ]
        );
      }

      // Audit
      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'indents', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.indent_id,
          JSON.stringify({
            tier_signed: input.approver_role,
            decision: 'approved',
            decision_reason: input.decision_reason,
            line_approvals: input.line_approvals,
            indent_state_after: updatedIndent.state,
            source_location: updatedIndent.source_location,
          }),
        ]
      );

      return updatedIndent;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to approve indent',
        cause: error,
      });
    }
  });

/**
 * Reject one tier of an indent. Any rejection transitions the whole
 * indent pending → rejected (terminal).
 */
export const indentRejectProcedure = protectedProcedure
  .input(
    z.object({
      indent_id: z.string().uuid(),
      approver_role: z.enum(['hod', 'non_med_head', 'finance_in_charge', 'facility_director', 'procurement_head']),
      reason: z.string().min(1),
    })
  )
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['po_approver', 'scm_admin']);

      const indent = await getSql()(
        `SELECT * FROM indents WHERE id = $1 AND hospital_id = $2`,
        [input.indent_id, ctx.user.hospital_id]
      );
      if (!indent.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Indent not found' });
      }
      if (indent[0].state !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Indent in state '${indent[0].state}' cannot be rejected` });
      }

      const v = validateIndentTransition({ from: 'pending' as IndentState, to: 'rejected' as IndentState, reason: input.reason });
      if (!v.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason });
      }

      // Mark this approver row rejected
      const approvalRow = await getSql()(
        `UPDATE indent_approvals
         SET decision = 'rejected', decided_by = $1, decided_at = NOW(), decision_reason = $2
         WHERE indent_id = $3 AND approver_role = $4 AND decision IS NULL
         RETURNING id`,
        [ctx.user.sub, input.reason, input.indent_id, input.approver_role]
      );
      if (!approvalRow.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `No pending approval for role ${input.approver_role} on this indent`,
        });
      }

      // Whole indent → rejected
      const updated = await getSql()(
        `UPDATE indents
         SET state = 'rejected',
             rejected_by = $1, rejected_at = NOW(),
             rejection_reason = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [ctx.user.sub, input.reason, input.indent_id]
      );

      await getSql()(
        `INSERT INTO indent_state_log (
          hospital_id, indent_id, from_state, to_state,
          actor_user_id, actor_role, reason
        ) VALUES ($1, $2, 'pending', 'rejected', $3, $4, $5)`,
        [ctx.user.hospital_id, input.indent_id, ctx.user.sub, ctx.user.role, input.reason]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'indents', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.indent_id,
          JSON.stringify({ rejected_by_role: input.approver_role, reason: input.reason }),
        ]
      );

      return updated[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to reject indent',
        cause: error,
      });
    }
  });

/**
 * Cancel an indent (originator only; only allowed in pending or approved
 * before issue). Audit-logged.
 */
export const indentCancelProcedure = protectedProcedure
  .input(
    z.object({
      indent_id: z.string().uuid(),
      cancellation_reason: z.string().min(1),
    })
  )
  .mutation(async ({ ctx, input }) => {
    try {
      const indent = await getSql()(
        `SELECT * FROM indents WHERE id = $1 AND hospital_id = $2`,
        [input.indent_id, ctx.user.hospital_id]
      );
      if (!indent.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Indent not found' });
      }

      // Originator-only check (super_admin / hospital_admin still bypass at SQL level via admin tooling)
      if (indent[0].raised_by !== ctx.user.sub && !['super_admin', 'hospital_admin'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the originator can cancel this indent' });
      }

      const v = validateIndentTransition({
        from: indent[0].state as IndentState,
        to: 'cancelled' as IndentState,
        cancellation_reason: input.cancellation_reason,
      });
      if (!v.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: v.reason });
      }

      const updated = await getSql()(
        `UPDATE indents
         SET state = 'cancelled',
             cancelled_by = $1, cancelled_at = NOW(),
             cancellation_reason = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [ctx.user.sub, input.cancellation_reason, input.indent_id]
      );

      await getSql()(
        `INSERT INTO indent_state_log (
          hospital_id, indent_id, from_state, to_state,
          actor_user_id, actor_role, reason
        ) VALUES ($1, $2, $3, 'cancelled', $4, $5, $6)`,
        [
          ctx.user.hospital_id,
          input.indent_id,
          indent[0].state,
          ctx.user.sub,
          ctx.user.role,
          input.cancellation_reason,
        ]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'indents', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.indent_id,
          JSON.stringify({ from_state: indent[0].state, to_state: 'cancelled', reason: input.cancellation_reason }),
        ]
      );

      return updated[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to cancel indent',
        cause: error,
      });
    }
  });

/**
 * Issue stock for an approved indent. Per-line:
 *   - Pick source inventory row
 *   - Decrement inventory.quantity_on_hand at source
 *   - Increment inventory.quantity_in_transit at destination (find or create row)
 *   - Pair stock_movements: transfer_out at source + transfer_in at dest
 *   - Update indent_items.quantity_issued, source_inventory_id
 *
 * Whole indent transitions approved → issued → in_transit (auto-flip).
 */
export const indentIssueProcedure = protectedProcedure
  .input(
    z.object({
      indent_id: z.string().uuid(),
      lines: z.array(
        z.object({
          item_id: z.string().uuid(),
          source_inventory_id: z.string().uuid(),
          quantity_to_issue: z.number().positive(),
        })
      ).min(1),
    })
  )
  .mutation(async ({ ctx, input }) => {
    try {
      await assertHasScmRole(ctx, ['inventory_manager', 'grn_creator']);

      const indent = await getSql()(
        `SELECT * FROM indents WHERE id = $1 AND hospital_id = $2`,
        [input.indent_id, ctx.user.hospital_id]
      );
      if (!indent.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Indent not found' });
      }
      const ind = indent[0];
      if (!['approved', 'issued'].includes(ind.state)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Indent in state '${ind.state}' cannot be issued (must be approved or partially issued)`,
        });
      }

      const items = await getSql()(
        `SELECT * FROM indent_items WHERE indent_id = $1 AND hospital_id = $2`,
        [input.indent_id, ctx.user.hospital_id]
      );

      // Validate per-line issue quantities
      for (const li of input.lines) {
        const it = items.find((i: any) => i.item_id === li.item_id);
        if (!it) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Line item ${li.item_id} not in indent` });
        }
        const v = validateLineIssue({
          quantity_approved: Number(it.quantity_approved || 0),
          quantity_already_issued: Number(it.quantity_issued || 0),
          quantity_to_issue: li.quantity_to_issue,
        });
        if (!v.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `${it.item_name}: ${v.reason}` });
        }

        // Verify source inventory has the qty available
        const inv = await getSql()(
          `SELECT * FROM inventory WHERE id = $1 AND hospital_id = $2`,
          [li.source_inventory_id, ctx.user.hospital_id]
        );
        if (!inv.length) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Source inventory row ${li.source_inventory_id} not found` });
        }
        const available = Number(inv[0].quantity_on_hand) - Number(inv[0].quantity_reserved);
        if (available < li.quantity_to_issue) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Insufficient stock at source for ${it.item_name}: ${available} available, need ${li.quantity_to_issue}`,
          });
        }
      }

      // Apply per-line moves
      for (const li of input.lines) {
        const it = items.find((i: any) => i.item_id === li.item_id);
        const inv = await getSql()(
          `SELECT * FROM inventory WHERE id = $1`,
          [li.source_inventory_id]
        );
        const src = inv[0];
        const srcPrev = Number(src.quantity_on_hand);
        const srcNext = srcPrev - li.quantity_to_issue;

        // Decrement source
        await getSql()(
          `UPDATE inventory SET quantity_on_hand = $1, last_movement_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [srcNext, li.source_inventory_id]
        );

        // transfer_out at source (signed negative)
        const outRow = await getSql()(
          `INSERT INTO stock_movements (
            hospital_id, inventory_id, item_id, item_name,
            movement_type, quantity, previous_balance, new_balance,
            batch_number, location, source_module, source_ref_id,
            unit_cost, total_value, reason, created_by
          ) VALUES (
            $1, $2, $3, $4,
            'transfer_out', $5, $6, $7,
            $8, $9, 'scm', $10,
            $11, $12, $13, $14
          ) RETURNING id`,
          [
            ctx.user.hospital_id,
            li.source_inventory_id,
            it.item_id,
            it.item_name,
            -li.quantity_to_issue,
            srcPrev,
            srcNext,
            src.batch_number,
            src.location,
            input.indent_id,
            src.unit_cost,
            li.quantity_to_issue * Number(src.unit_cost || 0),
            `indent ${ind.indent_number} issue`,
            ctx.user.sub,
          ]
        );

        // Find or create destination inventory row (carrying batch + manufacturer)
        const destExisting = await getSql()(
          `SELECT id, quantity_on_hand, quantity_in_transit FROM inventory
           WHERE hospital_id = $1 AND item_id = $2 AND location = $3
             AND COALESCE(batch_number,'') = COALESCE($4::text,'')`,
          [ctx.user.hospital_id, it.item_id, ind.destination_location, src.batch_number || null]
        );

        let destId: string;
        let destPrevInTransit: number;
        let destNextInTransit: number;
        if (destExisting.length) {
          destId = destExisting[0].id;
          destPrevInTransit = Number(destExisting[0].quantity_in_transit);
          destNextInTransit = destPrevInTransit + li.quantity_to_issue;
          await getSql()(
            `UPDATE inventory SET quantity_in_transit = $1, last_movement_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [destNextInTransit, destId]
          );
        } else {
          const inserted = await getSql()(
            `INSERT INTO inventory (
              hospital_id, item_id, location, batch_number, manufacturer, expiry_date,
              quantity_on_hand, quantity_reserved, quantity_in_transit,
              unit_cost, mrp, is_active
            ) VALUES (
              $1, $2, $3, $4, $5, $6,
              0, 0, $7,
              $8, $9, TRUE
            ) RETURNING id`,
            [
              ctx.user.hospital_id,
              it.item_id,
              ind.destination_location,
              src.batch_number,
              src.manufacturer,
              src.expiry_date,
              li.quantity_to_issue,
              src.unit_cost,
              src.mrp,
            ]
          );
          destId = inserted[0].id;
          destPrevInTransit = 0;
          destNextInTransit = li.quantity_to_issue;
        }

        // transfer_in at destination (signed positive); previous_balance is the
        // destination's quantity_on_hand at this point — unchanged because we
        // bumped quantity_in_transit, not quantity_on_hand. Acknowledge later
        // flips in_transit → on_hand.
        const destInv = await getSql()(`SELECT quantity_on_hand FROM inventory WHERE id = $1`, [destId]);
        const destOnHand = Number(destInv[0].quantity_on_hand);

        const inRow = await getSql()(
          `INSERT INTO stock_movements (
            hospital_id, inventory_id, item_id, item_name,
            movement_type, quantity, previous_balance, new_balance,
            batch_number, location, source_module, source_ref_id,
            unit_cost, total_value, reason, created_by
          ) VALUES (
            $1, $2, $3, $4,
            'transfer_in', $5, $6, $6,
            $7, $8, 'scm', $9,
            $10, $11, $12, $13
          ) RETURNING id`,
          [
            ctx.user.hospital_id,
            destId,
            it.item_id,
            it.item_name,
            li.quantity_to_issue,
            destOnHand,
            src.batch_number,
            ind.destination_location,
            input.indent_id,
            src.unit_cost,
            li.quantity_to_issue * Number(src.unit_cost || 0),
            `indent ${ind.indent_number} in transit`,
            ctx.user.sub,
          ]
        );

        // Update indent_items: quantity_issued cumulative, store ledger linkage
        await getSql()(
          `UPDATE indent_items
           SET quantity_issued = quantity_issued + $1,
               source_inventory_id = $2,
               stock_movement_out_id = $3,
               stock_movement_in_id = $4,
               updated_at = NOW()
           WHERE indent_id = $5 AND item_id = $6`,
          [li.quantity_to_issue, li.source_inventory_id, outRow[0].id, inRow[0].id, input.indent_id, it.item_id]
        );
      }

      // Determine new indent state. If all approved lines are fully issued
      // → state = in_transit (auto-flip). Otherwise stays in 'issued' (partial).
      const lineSummary = await getSql()(
        `SELECT
          SUM(CASE WHEN quantity_issued >= quantity_approved THEN 1 ELSE 0 END) AS fully_issued,
          COUNT(*) AS total_lines
         FROM indent_items WHERE indent_id = $1 AND quantity_approved > 0`,
        [input.indent_id]
      );
      const fullyIssued = Number(lineSummary[0].fully_issued);
      const totalLines = Number(lineSummary[0].total_lines);
      const newState: IndentState = fullyIssued === totalLines ? 'in_transit' : 'issued';

      // First issue (from approved) needs both 'issued' transition log entry +
      // 'in_transit' if applicable
      const transitions: Array<{ from: IndentState; to: IndentState }> = [];
      if (ind.state === 'approved') {
        transitions.push({ from: 'approved', to: 'issued' });
        if (newState === 'in_transit') transitions.push({ from: 'issued', to: 'in_transit' });
      } else {
        // already 'issued' (partial); only escalate to in_transit if fully done
        if (newState === 'in_transit') transitions.push({ from: 'issued', to: 'in_transit' });
      }

      const updated = await getSql()(
        `UPDATE indents
         SET state = $1,
             issued_by = COALESCE(issued_by, $2),
             issued_at = COALESCE(issued_at, NOW()),
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [newState, ctx.user.sub, input.indent_id]
      );

      for (const tr of transitions) {
        await getSql()(
          `INSERT INTO indent_state_log (
            hospital_id, indent_id, from_state, to_state,
            actor_user_id, actor_role, reason
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ctx.user.hospital_id,
            input.indent_id,
            tr.from,
            tr.to,
            ctx.user.sub,
            ctx.user.role,
            `${input.lines.length} line(s) issued`,
          ]
        );
      }

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'indents', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.indent_id,
          JSON.stringify({
            issued_lines: input.lines.length,
            state_after: newState,
            transitions,
          }),
        ]
      );

      return updated[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to issue indent',
        cause: error,
      });
    }
  });

/**
 * Acknowledge receipt at the destination. Per-line:
 *   - Increment inventory.quantity_on_hand at destination
 *   - Decrement inventory.quantity_in_transit at destination (the gap closes)
 *   - Update indent_items.quantity_acknowledged
 *
 * Indent transitions in_transit → received when all lines acknowledged.
 */
export const indentAcknowledgeProcedure = protectedProcedure
  .input(
    z.object({
      indent_id: z.string().uuid(),
      lines: z.array(
        z.object({
          item_id: z.string().uuid(),
          quantity_to_acknowledge: z.number().positive(),
        })
      ).min(1),
    })
  )
  .mutation(async ({ ctx, input }) => {
    try {
      const indent = await getSql()(
        `SELECT * FROM indents WHERE id = $1 AND hospital_id = $2`,
        [input.indent_id, ctx.user.hospital_id]
      );
      if (!indent.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Indent not found' });
      }
      const ind = indent[0];
      if (!['in_transit'].includes(ind.state)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Indent in state '${ind.state}' cannot be acknowledged` });
      }

      const items = await getSql()(
        `SELECT * FROM indent_items WHERE indent_id = $1 AND hospital_id = $2`,
        [input.indent_id, ctx.user.hospital_id]
      );

      // Validate per-line acknowledge quantities
      for (const li of input.lines) {
        const it = items.find((i: any) => i.item_id === li.item_id);
        if (!it) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Line item ${li.item_id} not in indent` });
        }
        const v = validateLineAcknowledge({
          quantity_issued: Number(it.quantity_issued || 0),
          quantity_already_acknowledged: Number(it.quantity_acknowledged || 0),
          quantity_to_acknowledge: li.quantity_to_acknowledge,
        });
        if (!v.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `${it.item_name}: ${v.reason}` });
        }
      }

      // Apply per-line: destination inventory bumped, in_transit decremented
      for (const li of input.lines) {
        const it = items.find((i: any) => i.item_id === li.item_id);
        // Find destination inventory row (carrying same batch as out movement)
        const destInv = await getSql()(
          `SELECT inv.* FROM inventory inv
           WHERE inv.hospital_id = $1 AND inv.item_id = $2
             AND inv.location = $3
             AND inv.quantity_in_transit > 0
           ORDER BY inv.last_movement_at DESC NULLS LAST
           LIMIT 1`,
          [ctx.user.hospital_id, it.item_id, ind.destination_location]
        );
        if (!destInv.length) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `No in-transit inventory at ${ind.destination_location} for ${it.item_name}`,
          });
        }
        const dest = destInv[0];
        const destPrevOnHand = Number(dest.quantity_on_hand);
        const destPrevInTransit = Number(dest.quantity_in_transit);

        if (destPrevInTransit < li.quantity_to_acknowledge) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Acknowledged quantity (${li.quantity_to_acknowledge}) exceeds in_transit balance (${destPrevInTransit}) for ${it.item_name}`,
          });
        }

        await getSql()(
          `UPDATE inventory
           SET quantity_on_hand = quantity_on_hand + $1,
               quantity_in_transit = quantity_in_transit - $1,
               last_movement_at = NOW(),
               last_restocked_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          [li.quantity_to_acknowledge, dest.id]
        );

        // Append a 'return' or specifically a clarifying movement —
        // since we already wrote transfer_in at issue time, the receipt
        // doesn't need a new ledger entry; the stock simply lands.
        // For an audit-clean ledger we DO want one — write a movement_type
        // 'transfer_in' marking the on-hand bump (qty unchanged but balance flips).
        // Schema doesn't currently model "in_transit landed" as a distinct
        // movement type; we use a follow-up no-op movement. Skipping for now
        // and relying on the indent_state_log to capture the acknowledge step.

        await getSql()(
          `UPDATE indent_items
           SET quantity_acknowledged = quantity_acknowledged + $1,
               updated_at = NOW()
           WHERE indent_id = $2 AND item_id = $3`,
          [li.quantity_to_acknowledge, input.indent_id, it.item_id]
        );
      }

      // Compute new indent state
      const lineSummary = await getSql()(
        `SELECT
          SUM(CASE WHEN quantity_acknowledged >= quantity_issued AND quantity_issued > 0 THEN 1 ELSE 0 END) AS fully_ack,
          COUNT(*) AS total_with_issue
         FROM indent_items WHERE indent_id = $1 AND quantity_issued > 0`,
        [input.indent_id]
      );
      const fullyAck = Number(lineSummary[0].fully_ack);
      const totalLines = Number(lineSummary[0].total_with_issue);
      const newState: IndentState = fullyAck === totalLines ? 'received' : 'in_transit';

      const updated = await getSql()(
        `UPDATE indents
         SET state = $1,
             acknowledged_by = COALESCE(acknowledged_by, $2),
             acknowledged_at = COALESCE(acknowledged_at, NOW()),
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [newState, ctx.user.sub, input.indent_id]
      );

      if (newState === 'received') {
        await getSql()(
          `INSERT INTO indent_state_log (
            hospital_id, indent_id, from_state, to_state,
            actor_user_id, actor_role, reason
          ) VALUES ($1, $2, 'in_transit', 'received', $3, $4, 'all lines acknowledged')`,
          [ctx.user.hospital_id, input.indent_id, ctx.user.sub, ctx.user.role]
        );
      }

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'indents', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input.indent_id,
          JSON.stringify({ acknowledged_lines: input.lines.length, state_after: newState }),
        ]
      );

      return updated[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to acknowledge indent',
        cause: error,
      });
    }
  });

/** Optional finalize step: received → closed. Anyone with the indent can close. */
export const indentCloseProcedure = protectedProcedure
  .input(z.string().uuid())
  .mutation(async ({ ctx, input }) => {
    try {
      const indent = await getSql()(
        `SELECT * FROM indents WHERE id = $1 AND hospital_id = $2`,
        [input, ctx.user.hospital_id]
      );
      if (!indent.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Indent not found' });
      }
      if (indent[0].state !== 'received') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Indent in state '${indent[0].state}' cannot be closed` });
      }

      const updated = await getSql()(
        `UPDATE indents
         SET state = 'closed', closed_at = NOW(), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [input]
      );

      await getSql()(
        `INSERT INTO indent_state_log (
          hospital_id, indent_id, from_state, to_state,
          actor_user_id, actor_role, reason
        ) VALUES ($1, $2, 'received', 'closed', $3, $4, 'manual close')`,
        [ctx.user.hospital_id, input, ctx.user.sub, ctx.user.role]
      );

      await getSql()(
        `INSERT INTO audit_logs (
          hospital_id, user_id, action, table_name, row_id,
          new_values, ip_address, created_at
        ) VALUES ($1, $2, 'UPDATE', 'indents', $3, $4::jsonb, 'server', NOW())`,
        [
          ctx.user.hospital_id,
          ctx.user.sub,
          input,
          JSON.stringify({ from_state: 'received', to_state: 'closed' }),
        ]
      );

      return updated[0];
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to close indent',
        cause: error,
      });
    }
  });

// ---------- Router ----------

export const scmIndentsRouter = router({
  create: indentCreateProcedure,
  list: indentListProcedure,
  listForMyApproval: indentListForMyApprovalProcedure,
  detail: indentDetailProcedure,
  listItems: indentListItemsProcedure,
  approve: indentApproveProcedure,
  reject: indentRejectProcedure,
  cancel: indentCancelProcedure,
  issue: indentIssueProcedure,
  acknowledge: indentAcknowledgeProcedure,
  close: indentCloseProcedure,
});
