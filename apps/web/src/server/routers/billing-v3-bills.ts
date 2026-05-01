import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import {
  bills, billStateHistory, billLines, billingAccounts, encounters, patients,
  chargeMasterHospitalSetting, BILL_STATES, BILL_TRANSITION_ACTIONS,
  type Bill,
} from '@db/schema';
import { and, desc, eq, sql as drizzleSql } from 'drizzle-orm';
import { writeAuditLog } from '@/lib/audit/logger';
import { assertCanTransition, concessionApprovalLevel } from '@/server/billing-v3/bill-state-machine';
import { buildBillFromEncounter } from '@/server/billing-v3/bill-builder';

// =============================================================================
// billingV3.bills.* — Phase 4 router
// =============================================================================

let _sql: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

/** Allocate next bill_number for a hospital + year. */
async function allocateBillNumber(hospital_id: string): Promise<string> {
  const sql = getSql();
  const year = new Date().getFullYear();
  const rows = (await sql`
    INSERT INTO bill_sequences (hospital_id, year, prefix, next_value)
    VALUES (${hospital_id}, ${year}, 'BILL', 2)
    ON CONFLICT (hospital_id, year) DO UPDATE
      SET next_value = bill_sequences.next_value + 1,
          updated_at = NOW()
    RETURNING next_value, prefix
  `) as Array<{ next_value: number; prefix: string }>;
  const next = rows[0].next_value - 1;
  const padded = String(next).padStart(6, '0');
  return `${rows[0].prefix}-${hospital_id}-${year}-${padded}`;
}

async function logTransition(args: {
  bill_id: string;
  hospital_id: string;
  from_state: string;
  to_state: string;
  action: string;
  actor_user_id: string;
  actor_role: string;
  reason?: string | null;
  snapshot?: Record<string, unknown> | null;
}) {
  await db.insert(billStateHistory).values({
    bill_id: args.bill_id,
    hospital_id: args.hospital_id,
    from_state: args.from_state,
    to_state: args.to_state,
    action: args.action,
    actor_user_id: args.actor_user_id,
    actor_role: args.actor_role,
    reason: args.reason ?? null,
    snapshot: (args.snapshot ?? null) as any,
  });
}

// ─── bills.build — create draft from encounter ─────────────────────────────

export const billsBuildProcedure = protectedProcedure
  .input(z.object({ encounter_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const hospital_id = ctx.user.hospital_id;
    assertCanTransition({
      action: 'create',
      fromState: '__new',
      callerSystemRole: ctx.user.role,
    });

    // Pull encounter + billing_account for context
    const [enc] = await db
      .select({
        id: encounters.id,
        patient_id: encounters.patient_id,
        hospital_id: encounters.hospital_id,
      })
      .from(encounters)
      .where(eq(encounters.id, input.encounter_id))
      .limit(1);
    if (!enc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found' });

    const [account] = await db
      .select({ id: billingAccounts.id })
      .from(billingAccounts)
      .where(and(
        eq(billingAccounts.hospital_id, hospital_id),
        eq(billingAccounts.encounter_id, input.encounter_id),
      ))
      .limit(1);
    if (!account) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'No billing_account for this encounter — register one before building bill',
      });
    }

    // Aggregate charge_items
    const built = await buildBillFromEncounter({
      hospital_id,
      encounter_id: input.encounter_id,
      billing_account_id: account.id,
      patient_id: enc.patient_id,
    });

    if (built.charge_items_count === 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'No charge_items posted for this encounter — nothing to bill yet',
      });
    }

    const billNumber = await allocateBillNumber(hospital_id);

    const [created] = await db.insert(bills).values({
      hospital_id,
      bill_number: billNumber,
      encounter_id: input.encounter_id,
      billing_account_id: account.id,
      patient_id: enc.patient_id,
      state: 'draft',
      subtotal_inr: built.subtotal_inr.toFixed(2) as any,
      gst_amount_inr: built.gst_amount_inr.toFixed(2) as any,
      total_amount_inr: built.total_amount_inr.toFixed(2) as any,
      created_by: ctx.user.sub,
    }).returning();

    // Insert bill_lines snapshot
    let displayOrder = 0;
    for (const cat of built.categories) {
      for (const line of cat.lines) {
        await db.insert(billLines).values({
          bill_id: created.id,
          hospital_id,
          charge_item_id: line.charge_item_id,
          category: cat.category,
          display_name: line.display_name,
          charge_code: line.charge_code,
          quantity: line.quantity.toFixed(2) as any,
          unit_price_inr: line.unit_price_inr.toFixed(2) as any,
          line_total_inr: line.line_total_inr.toFixed(2) as any,
          gst_percentage: line.gst_percentage.toFixed(2) as any,
          gst_amount_inr: line.gst_amount_inr.toFixed(2) as any,
          display_order: displayOrder++,
        });
      }
    }

    await logTransition({
      bill_id: created.id,
      hospital_id,
      from_state: '__new',
      to_state: 'draft',
      action: 'create',
      actor_user_id: ctx.user.sub,
      actor_role: ctx.user.role,
      snapshot: { total: built.total_amount_inr, charge_items_count: built.charge_items_count },
    });

    await writeAuditLog({
      action: 'INSERT',
      table: 'bills',
      row_id: created.id,
      actor_id: ctx.user.sub,
      hospital_id,
      new_values: { bill_number: billNumber, total: built.total_amount_inr },
    });

    return { bill: created, aggregator: built };
  });

// ─── bills.list / bills.get ────────────────────────────────────────────────

export const billsListProcedure = protectedProcedure
  .input(z.object({
    state: z.enum(BILL_STATES).optional(),
    encounter_id: z.string().uuid().optional(),
    patient_id: z.string().uuid().optional(),
    limit: z.number().int().positive().max(500).default(100),
    offset: z.number().int().nonnegative().default(0),
  }))
  .query(async ({ ctx, input }) => {
    const conds: any[] = [eq(bills.hospital_id, ctx.user.hospital_id)];
    if (input.state) conds.push(eq(bills.state, input.state));
    if (input.encounter_id) conds.push(eq(bills.encounter_id, input.encounter_id));
    if (input.patient_id) conds.push(eq(bills.patient_id, input.patient_id));
    const rows = await db.select().from(bills)
      .where(and(...conds))
      .orderBy(desc(bills.created_at))
      .limit(input.limit)
      .offset(input.offset);
    return { bills: rows, count: rows.length };
  });

export const billsGetProcedure = protectedProcedure
  .input(z.object({ bill_id: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    const [bill] = await db.select().from(bills)
      .where(and(eq(bills.id, input.bill_id), eq(bills.hospital_id, ctx.user.hospital_id)))
      .limit(1);
    if (!bill) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bill not found' });
    const lines = await db.select().from(billLines)
      .where(eq(billLines.bill_id, input.bill_id))
      .orderBy(billLines.display_order);
    const history = await db.select().from(billStateHistory)
      .where(eq(billStateHistory.bill_id, input.bill_id))
      .orderBy(desc(billStateHistory.created_at));
    return { bill, lines, history };
  });

// ─── State transitions: sendForReview / finalize / settlePayment / close / archive ──

async function performTransition(args: {
  bill: Bill;
  action: 'send_for_review' | 'finalize' | 'settle_payment' | 'close' | 'archive';
  ctx: any;
  reason?: string;
}) {
  const rule = assertCanTransition({
    action: args.action,
    fromState: args.bill.state as any,
    callerSystemRole: args.ctx.user.role,
    reason: args.reason,
  });

  // For finalize: check approval_required + approved_by
  if (args.action === 'finalize' && args.bill.approval_required && !args.bill.approved_by) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Bill requires ${args.bill.concession_approval_level ?? 'GM'} approval before finalize`,
    });
  }

  const now = new Date();
  const updateFields: any = {
    state: rule.to,
    updated_at: now,
  };
  if (rule.to === 'finalized') updateFields.finalized_at = now;
  if (rule.to === 'settled') updateFields.settled_at = now;
  if (rule.to === 'closed') updateFields.closed_at = now;
  if (rule.to === 'archived') updateFields.archived_at = now;

  const [updated] = await db.update(bills)
    .set(updateFields)
    .where(eq(bills.id, args.bill.id))
    .returning();

  await logTransition({
    bill_id: args.bill.id,
    hospital_id: args.bill.hospital_id,
    from_state: args.bill.state,
    to_state: rule.to,
    action: args.action,
    actor_user_id: args.ctx.user.sub,
    actor_role: args.ctx.user.role,
    reason: args.reason ?? null,
  });

  return updated;
}

export const billsSendForReviewProcedure = protectedProcedure
  .input(z.object({ bill_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const [bill] = await db.select().from(bills)
      .where(and(eq(bills.id, input.bill_id), eq(bills.hospital_id, ctx.user.hospital_id)))
      .limit(1);
    if (!bill) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bill not found' });
    return performTransition({ bill, action: 'send_for_review', ctx });
  });

export const billsFinalizeProcedure = protectedProcedure
  .input(z.object({ bill_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const [bill] = await db.select().from(bills)
      .where(and(eq(bills.id, input.bill_id), eq(bills.hospital_id, ctx.user.hospital_id)))
      .limit(1);
    if (!bill) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bill not found' });
    return performTransition({ bill, action: 'finalize', ctx });
  });

export const billsSettlePaymentProcedure = protectedProcedure
  .input(z.object({ bill_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const [bill] = await db.select().from(bills)
      .where(and(eq(bills.id, input.bill_id), eq(bills.hospital_id, ctx.user.hospital_id)))
      .limit(1);
    if (!bill) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bill not found' });
    return performTransition({ bill, action: 'settle_payment', ctx });
  });

export const billsCloseProcedure = protectedProcedure
  .input(z.object({ bill_id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const [bill] = await db.select().from(bills)
      .where(and(eq(bills.id, input.bill_id), eq(bills.hospital_id, ctx.user.hospital_id)))
      .limit(1);
    if (!bill) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bill not found' });
    return performTransition({ bill, action: 'close', ctx });
  });

// ─── bills.applyConcession — Q8 threshold gate ────────────────────────────

export const billsApplyConcessionProcedure = protectedProcedure
  .input(z.object({
    bill_id: z.string().uuid(),
    concession_amount_inr: z.number().nonnegative(),
    reason: z.string().min(1),
  }))
  .mutation(async ({ ctx, input }) => {
    const hospital_id = ctx.user.hospital_id;
    const [bill] = await db.select().from(bills)
      .where(and(eq(bills.id, input.bill_id), eq(bills.hospital_id, hospital_id)))
      .limit(1);
    if (!bill) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bill not found' });
    if (bill.state !== 'draft' && bill.state !== 'pending_review') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Concessions can only be applied in draft/pending_review (got ${bill.state})`,
      });
    }

    // Pull thresholds from charge_master_hospital_setting
    const [settings] = await db.select().from(chargeMasterHospitalSetting)
      .where(eq(chargeMasterHospitalSetting.hospital_id, hospital_id))
      .limit(1);
    if (!settings) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'No hospital settings — run BV3 bootstrap first' });
    }

    const subtotalBefore =
      parseFloat(String(bill.subtotal_inr)) + parseFloat(String(bill.gst_amount_inr));

    if (input.concession_amount_inr > subtotalBefore) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Concession ₹${input.concession_amount_inr} exceeds bill total ₹${subtotalBefore}`,
      });
    }

    const approvalLevel = concessionApprovalLevel({
      concession_amount: input.concession_amount_inr,
      bill_total_before_concession: subtotalBefore,
      self_limit_percent: settings.cashier_waiver_self_limit_percent,
      gm_limit_percent: settings.cashier_waiver_gm_limit_percent,
    });

    const newTotal = subtotalBefore - input.concession_amount_inr;

    const [updated] = await db.update(bills)
      .set({
        concession_amount_inr: input.concession_amount_inr.toFixed(2) as any,
        concession_reason: input.reason,
        concession_approval_level: approvalLevel,
        // approval_required = TRUE iff caller's role doesn't already cover the level
        approval_required: approvalLevel !== 'self' && !['super_admin', 'hospital_admin', 'gm', 'cfo'].includes(ctx.user.role),
        total_amount_inr: newTotal.toFixed(2) as any,
        updated_at: new Date(),
      })
      .where(eq(bills.id, input.bill_id))
      .returning();

    await writeAuditLog({
      action: 'UPDATE',
      table: 'bills',
      row_id: input.bill_id,
      actor_id: ctx.user.sub,
      hospital_id,
      new_values: {
        concession_amount: input.concession_amount_inr,
        approval_level: approvalLevel,
        new_total: newTotal,
        reason: input.reason,
      },
    });

    return updated;
  });

// ─── bills.reverseAndReissue — amendment branch ───────────────────────────

export const billsReverseAndReissueProcedure = protectedProcedure
  .input(z.object({
    bill_id: z.string().uuid(),
    reason: z.string().min(1),
  }))
  .mutation(async ({ ctx, input }) => {
    const hospital_id = ctx.user.hospital_id;
    const [original] = await db.select().from(bills)
      .where(and(eq(bills.id, input.bill_id), eq(bills.hospital_id, hospital_id)))
      .limit(1);
    if (!original) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bill not found' });
    if (original.state !== 'finalized' && original.state !== 'settled') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Can only reverse finalized/settled bills (got ${original.state})`,
      });
    }

    assertCanTransition({
      action: 'reverse',
      fromState: original.state as any,
      callerSystemRole: ctx.user.role,
      reason: input.reason,
    });

    // Mark original amended (the only allowed update on a finalized bill).
    await db.update(bills)
      .set({
        amended: true,
        amended_count: original.amended_count + 1,
        updated_at: new Date(),
      })
      .where(eq(bills.id, original.id));

    await logTransition({
      bill_id: original.id,
      hospital_id,
      from_state: original.state,
      to_state: original.state,  // state unchanged; flag flipped
      action: 'reverse',
      actor_user_id: ctx.user.sub,
      actor_role: ctx.user.role,
      reason: input.reason,
      snapshot: { amended: true, amended_count: original.amended_count + 1 },
    });

    // Create new draft bill with replaces_bill_id
    if (!original.encounter_id) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Original bill has no encounter_id — cannot rebuild',
      });
    }

    const billNumber = await allocateBillNumber(hospital_id);
    const built = await buildBillFromEncounter({
      hospital_id,
      encounter_id: original.encounter_id,
      billing_account_id: original.billing_account_id,
      patient_id: original.patient_id,
    });

    const [reissued] = await db.insert(bills).values({
      hospital_id,
      bill_number: billNumber,
      encounter_id: original.encounter_id,
      billing_account_id: original.billing_account_id,
      patient_id: original.patient_id,
      state: 'draft',
      subtotal_inr: built.subtotal_inr.toFixed(2) as any,
      gst_amount_inr: built.gst_amount_inr.toFixed(2) as any,
      total_amount_inr: built.total_amount_inr.toFixed(2) as any,
      replaces_bill_id: original.id,
      created_by: ctx.user.sub,
      notes: `Reissue of ${original.bill_number}: ${input.reason}`,
    }).returning();

    let displayOrder = 0;
    for (const cat of built.categories) {
      for (const line of cat.lines) {
        await db.insert(billLines).values({
          bill_id: reissued.id,
          hospital_id,
          charge_item_id: line.charge_item_id,
          category: cat.category,
          display_name: line.display_name,
          charge_code: line.charge_code,
          quantity: line.quantity.toFixed(2) as any,
          unit_price_inr: line.unit_price_inr.toFixed(2) as any,
          line_total_inr: line.line_total_inr.toFixed(2) as any,
          gst_percentage: line.gst_percentage.toFixed(2) as any,
          gst_amount_inr: line.gst_amount_inr.toFixed(2) as any,
          display_order: displayOrder++,
        });
      }
    }

    await logTransition({
      bill_id: reissued.id,
      hospital_id,
      from_state: '__new',
      to_state: 'draft',
      action: 'reissue',
      actor_user_id: ctx.user.sub,
      actor_role: ctx.user.role,
      reason: input.reason,
      snapshot: { replaces_bill_id: original.id, total: built.total_amount_inr },
    });

    return { original_bill_id: original.id, reissued_bill: reissued };
  });

// ─── Composed router ──────────────────────────────────────────────────────

export const billingV3BillsRouter = router({
  build: billsBuildProcedure,
  list: billsListProcedure,
  get: billsGetProcedure,
  sendForReview: billsSendForReviewProcedure,
  finalize: billsFinalizeProcedure,
  settlePayment: billsSettlePaymentProcedure,
  close: billsCloseProcedure,
  applyConcession: billsApplyConcessionProcedure,
  reverseAndReissue: billsReverseAndReissueProcedure,
});
