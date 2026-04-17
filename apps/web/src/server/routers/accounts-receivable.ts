import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { arLedger, arCollectionActions, arPaymentMatches } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, ilike, or, gte, lte, inArray } from 'drizzle-orm';

const arTypes = ['patient', 'insurance'] as const;
const arStatuses = ['open', 'partially_paid', 'paid', 'written_off', 'disputed'] as const;
const agingBuckets = ['current', '1_30', '31_60', '61_90', '91_plus'] as const;
const actionTypes = ['phone_call', 'sms', 'email', 'letter', 'dunning_notice', 'legal_notice', 'write_off_request', 'escalation', 'note'] as const;
const matchStatuses = ['matched', 'partial', 'unidentified', 'overpayment'] as const;

function computeAging(dueDate: string): { bucket: typeof agingBuckets[number]; days: number } {
  const due = new Date(dueDate);
  const now = new Date();
  const days = Math.max(0, Math.ceil((now.getTime() - due.getTime()) / (1000 * 86400)));
  if (days <= 0) return { bucket: 'current', days: 0 };
  if (days <= 30) return { bucket: '1_30', days };
  if (days <= 60) return { bucket: '31_60', days };
  if (days <= 90) return { bucket: '61_90', days };
  return { bucket: '91_plus', days };
}

function generateArNumber(): string {
  const d = new Date();
  const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
  return `AR-${dateStr}-${seq}`;
}

export const accountsReceivableRouter = router({

  // ═══════════════════════════════════════════════
  // AR LEDGER
  // ═══════════════════════════════════════════════

  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      ar_type: z.enum(arTypes).optional(),
      status: z.enum(arStatuses).optional(),
      aging_bucket: z.enum(agingBuckets).optional(),
      overdue_only: z.boolean().default(false),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { search, ar_type, status, aging_bucket, overdue_only, page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [eq(arLedger.hospital_id, ctx.user.hospital_id)];
      if (ar_type) conditions.push(eq(arLedger.ar_type, ar_type));
      if (status) conditions.push(eq(arLedger.status, status));
      if (aging_bucket) conditions.push(eq(arLedger.aging_bucket, aging_bucket));
      if (overdue_only) {
        const today = new Date().toISOString().split('T')[0];
        conditions.push(lte(arLedger.due_date, today));
        conditions.push(sql`${arLedger.status} NOT IN ('paid','written_off')`);
      }
      if (search) {
        conditions.push(or(
          ilike(arLedger.patient_name, `%${search}%`),
          ilike(arLedger.ar_number, `%${search}%`),
          ilike(arLedger.invoice_number, `%${search}%`),
          ilike(arLedger.tpa_name, `%${search}%`),
          ilike(arLedger.claim_number, `%${search}%`),
        )!);
      }

      const where = and(...conditions);

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(arLedger).where(where);
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select()
        .from(arLedger)
        .where(where)
        .orderBy(desc(arLedger.days_outstanding), desc(arLedger.outstanding_amount))
        .limit(pageSize)
        .offset(offset);

      return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select()
        .from(arLedger)
        .where(and(eq(arLedger.id, input.id), eq(arLedger.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'AR entry not found' });

      // Get collection history
      const actions = await db.select()
        .from(arCollectionActions)
        .where(eq(arCollectionActions.ar_ledger_id, input.id))
        .orderBy(desc(arCollectionActions.created_at));

      // Get payment matches
      const payments = await db.select()
        .from(arPaymentMatches)
        .where(eq(arPaymentMatches.ar_ledger_id, input.id))
        .orderBy(desc(arPaymentMatches.created_at));

      return { ...rows[0], collection_actions: actions, payment_matches: payments };
    }),

  create: adminProcedure
    .input(z.object({
      ar_type: z.enum(arTypes),
      patient_id: z.string().uuid().optional(),
      patient_name: z.string().optional(),
      encounter_id: z.string().uuid().optional(),
      billing_account_id: z.string().uuid().optional(),
      invoice_number: z.string().optional(),
      insurance_claim_id: z.string().uuid().optional(),
      tpa_name: z.string().optional(),
      policy_number: z.string().optional(),
      claim_number: z.string().optional(),
      original_amount: z.number().min(0),
      invoice_date: z.string(),
      due_date: z.string(),
      gl_account_id: z.string().uuid().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const aging = computeAging(input.due_date);

      const inserted = await db.insert(arLedger).values({
        hospital_id: ctx.user.hospital_id,
        ar_type: input.ar_type,
        ar_number: generateArNumber(),
        patient_id: input.patient_id || null,
        patient_name: input.patient_name || null,
        encounter_id: input.encounter_id || null,
        billing_account_id: input.billing_account_id || null,
        invoice_number: input.invoice_number || null,
        insurance_claim_id: input.insurance_claim_id || null,
        tpa_name: input.tpa_name || null,
        policy_number: input.policy_number || null,
        claim_number: input.claim_number || null,
        original_amount: String(input.original_amount),
        outstanding_amount: String(input.original_amount),
        invoice_date: input.invoice_date,
        due_date: input.due_date,
        aging_bucket: aging.bucket,
        days_outstanding: aging.days,
        gl_account_id: input.gl_account_id || null,
        notes: input.notes || null,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'ar_ledger', row_id: inserted[0].id,
        new_values: { ar_type: input.ar_type, original_amount: input.original_amount },
        reason: 'AR entry created',
      });

      return inserted[0];
    }),

  // Record a payment against an AR entry
  recordPayment: adminProcedure
    .input(z.object({
      ar_ledger_id: z.string().uuid(),
      amount: z.number().min(0.01),
      payment_reference: z.string().min(1),
      payment_date: z.string(),
      payment_method: z.string().optional(),
      payer_name: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const ar = await db.select().from(arLedger)
        .where(and(eq(arLedger.id, input.ar_ledger_id), eq(arLedger.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!ar.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'AR entry not found' });

      const outstanding = Number(ar[0].outstanding_amount);
      const matchedAmount = Math.min(input.amount, outstanding);
      const unmatchedAmount = input.amount - matchedAmount;
      const newPaid = Number(ar[0].paid_amount) + matchedAmount;
      const newOutstanding = outstanding - matchedAmount;
      const matchStatus = unmatchedAmount > 0 ? 'overpayment' : (newOutstanding > 0 ? 'partial' : 'matched');
      const arStatus = newOutstanding <= 0 ? 'paid' : 'partially_paid';

      // Create payment match record
      const pmInserted = await db.insert(arPaymentMatches).values({
        hospital_id: ctx.user.hospital_id,
        ar_ledger_id: input.ar_ledger_id,
        payment_reference: input.payment_reference,
        payment_date: input.payment_date,
        payment_method: input.payment_method || null,
        payer_name: input.payer_name || null,
        amount: String(input.amount),
        matched_amount: String(matchedAmount),
        unmatched_amount: String(unmatchedAmount),
        match_status: matchStatus,
        matched_by: ctx.user.sub,
        matched_at: new Date(),
        notes: input.notes || null,
        created_by: ctx.user.sub,
      } as any).returning();

      // Update AR ledger
      await db.update(arLedger).set({
        paid_amount: String(newPaid),
        outstanding_amount: String(newOutstanding),
        status: arStatus,
        last_payment_date: input.payment_date,
        updated_at: new Date(),
      }).where(eq(arLedger.id, input.ar_ledger_id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'ar_ledger', row_id: input.ar_ledger_id,
        new_values: { paid_amount: newPaid, outstanding_amount: newOutstanding, status: arStatus },
        reason: `Payment of ${input.amount} recorded via ${input.payment_method || 'unknown'}`,
      });

      return pmInserted[0];
    }),

  // Write off an AR entry (partial or full)
  writeOff: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      amount: z.number().min(0.01),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const ar = await db.select().from(arLedger)
        .where(and(eq(arLedger.id, input.id), eq(arLedger.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!ar.length) throw new TRPCError({ code: 'NOT_FOUND' });
      if (['paid', 'written_off'].includes(ar[0].status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot write off a ${ar[0].status} entry` });
      }

      const outstanding = Number(ar[0].outstanding_amount);
      const writeOffAmt = Math.min(input.amount, outstanding);
      const newAdj = Number(ar[0].adjusted_amount) + writeOffAmt;
      const newOutstanding = outstanding - writeOffAmt;
      const newStatus = newOutstanding <= 0 ? 'written_off' : ar[0].status;

      const updated = await db.update(arLedger).set({
        adjusted_amount: String(newAdj),
        outstanding_amount: String(newOutstanding),
        status: newStatus,
        notes: `Write-off: ${input.reason}`,
        updated_at: new Date(),
      }).where(eq(arLedger.id, input.id)).returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'ar_ledger', row_id: input.id,
        new_values: { adjusted_amount: newAdj, outstanding_amount: newOutstanding, status: newStatus },
        reason: `Write-off of ${writeOffAmt}: ${input.reason}`,
      });

      return updated[0];
    }),

  // Dispute an AR entry
  dispute: adminProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await db.update(arLedger).set({
        status: 'disputed',
        notes: `Disputed: ${input.reason}`,
        updated_at: new Date(),
      }).where(and(eq(arLedger.id, input.id), eq(arLedger.hospital_id, ctx.user.hospital_id))).returning();
      if (!updated.length) throw new TRPCError({ code: 'NOT_FOUND' });

      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'ar_ledger', row_id: input.id, new_values: { status: 'disputed' }, reason: input.reason });
      return updated[0];
    }),

  // Refresh aging buckets for all open AR entries
  refreshAging: adminProcedure
    .mutation(async ({ ctx }) => {
      const openEntries = await db.select({ id: arLedger.id, due_date: arLedger.due_date })
        .from(arLedger)
        .where(and(
          eq(arLedger.hospital_id, ctx.user.hospital_id),
          sql`${arLedger.status} NOT IN ('paid','written_off')`,
        ));

      let updated = 0;
      for (const entry of openEntries) {
        const aging = computeAging(entry.due_date);
        await db.update(arLedger).set({
          aging_bucket: aging.bucket,
          days_outstanding: aging.days,
          updated_at: new Date(),
        }).where(eq(arLedger.id, entry.id));
        updated++;
      }

      return { updated };
    }),

  // ═══════════════════════════════════════════════
  // COLLECTION ACTIONS
  // ═══════════════════════════════════════════════

  addCollectionAction: adminProcedure
    .input(z.object({
      ar_ledger_id: z.string().uuid(),
      action_type: z.enum(actionTypes),
      action_date: z.string(),
      scheduled_date: z.string().optional(),
      outcome: z.string().optional(),
      notes: z.string().optional(),
      completed: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const inserted = await db.insert(arCollectionActions).values({
        hospital_id: ctx.user.hospital_id,
        ar_ledger_id: input.ar_ledger_id,
        action_type: input.action_type,
        action_date: input.action_date,
        scheduled_date: input.scheduled_date || null,
        completed: input.completed,
        outcome: input.outcome || null,
        notes: input.notes || null,
        performed_by: ctx.user.sub,
      } as any).returning();

      // Update collection tracking on AR
      await db.update(arLedger).set({
        last_collection_date: input.action_date,
        collection_attempts: sql`${arLedger.collection_attempts} + 1`,
        updated_at: new Date(),
      }).where(eq(arLedger.id, input.ar_ledger_id));

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'ar_collection_actions', row_id: inserted[0].id,
        new_values: { action_type: input.action_type, ar_ledger_id: input.ar_ledger_id },
        reason: `Collection action: ${input.action_type}`,
      });

      return inserted[0];
    }),

  completeAction: adminProcedure
    .input(z.object({ id: z.string().uuid(), outcome: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await db.update(arCollectionActions).set({
        completed: true,
        outcome: input.outcome || null,
      }).where(eq(arCollectionActions.id, input.id)).returning();
      if (!updated.length) throw new TRPCError({ code: 'NOT_FOUND' });
      return updated[0];
    }),

  pendingFollowUps: protectedProcedure
    .query(async ({ ctx }) => {
      const today = new Date().toISOString().split('T')[0];
      const rows = await db.select()
        .from(arCollectionActions)
        .where(and(
          eq(arCollectionActions.hospital_id, ctx.user.hospital_id),
          eq(arCollectionActions.completed, false),
          lte(arCollectionActions.scheduled_date, today),
        ))
        .orderBy(asc(arCollectionActions.scheduled_date))
        .limit(100);
      return rows;
    }),

  // ═══════════════════════════════════════════════
  // UNIDENTIFIED PAYMENTS
  // ═══════════════════════════════════════════════

  recordUnidentifiedPayment: adminProcedure
    .input(z.object({
      payment_reference: z.string().min(1),
      payment_date: z.string(),
      payment_method: z.string().optional(),
      payer_name: z.string().optional(),
      amount: z.number().min(0.01),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inserted = await db.insert(arPaymentMatches).values({
        hospital_id: ctx.user.hospital_id,
        ar_ledger_id: null,
        payment_reference: input.payment_reference,
        payment_date: input.payment_date,
        payment_method: input.payment_method || null,
        payer_name: input.payer_name || null,
        amount: String(input.amount),
        unmatched_amount: String(input.amount),
        match_status: 'unidentified',
        notes: input.notes || null,
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'ar_payment_matches', row_id: inserted[0].id,
        new_values: { amount: input.amount, payment_reference: input.payment_reference },
        reason: 'Unidentified payment recorded',
      });

      return inserted[0];
    }),

  listUnidentifiedPayments: protectedProcedure
    .query(async ({ ctx }) => {
      const rows = await db.select()
        .from(arPaymentMatches)
        .where(and(
          eq(arPaymentMatches.hospital_id, ctx.user.hospital_id),
          eq(arPaymentMatches.match_status, 'unidentified'),
        ))
        .orderBy(desc(arPaymentMatches.created_at))
        .limit(100);
      return rows;
    }),

  matchPayment: adminProcedure
    .input(z.object({
      payment_id: z.string().uuid(),
      ar_ledger_id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const pm = await db.select().from(arPaymentMatches)
        .where(and(eq(arPaymentMatches.id, input.payment_id), eq(arPaymentMatches.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!pm.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Payment not found' });
      if (pm[0].match_status !== 'unidentified') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payment already matched' });

      const ar = await db.select().from(arLedger)
        .where(and(eq(arLedger.id, input.ar_ledger_id), eq(arLedger.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!ar.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'AR entry not found' });

      const paymentAmt = Number(pm[0].amount);
      const outstanding = Number(ar[0].outstanding_amount);
      const matchedAmt = Math.min(paymentAmt, outstanding);
      const unmatchedAmt = paymentAmt - matchedAmt;
      const matchStatus = unmatchedAmt > 0 ? 'overpayment' : (matchedAmt < outstanding ? 'partial' : 'matched');

      // Update payment match
      await db.update(arPaymentMatches).set({
        ar_ledger_id: input.ar_ledger_id,
        matched_amount: String(matchedAmt),
        unmatched_amount: String(unmatchedAmt),
        match_status: matchStatus,
        matched_by: ctx.user.sub,
        matched_at: new Date(),
      }).where(eq(arPaymentMatches.id, input.payment_id));

      // Update AR ledger
      const newPaid = Number(ar[0].paid_amount) + matchedAmt;
      const newOutstanding = outstanding - matchedAmt;
      const arStatus = newOutstanding <= 0 ? 'paid' : 'partially_paid';

      await db.update(arLedger).set({
        paid_amount: String(newPaid),
        outstanding_amount: String(newOutstanding),
        status: arStatus,
        last_payment_date: pm[0].payment_date,
        updated_at: new Date(),
      }).where(eq(arLedger.id, input.ar_ledger_id));

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'ar_payment_matches', row_id: input.payment_id,
        new_values: { ar_ledger_id: input.ar_ledger_id, match_status: matchStatus },
        reason: `Payment matched to AR ${ar[0].ar_number}`,
      });

      return { match_status: matchStatus, matched_amount: matchedAmt, unmatched_amount: unmatchedAmt };
    }),

  // ═══════════════════════════════════════════════
  // DASHBOARDS & AGING
  // ═══════════════════════════════════════════════

  agingSummary: protectedProcedure
    .input(z.object({
      ar_type: z.enum(arTypes).optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [
        eq(arLedger.hospital_id, ctx.user.hospital_id),
        sql`${arLedger.status} NOT IN ('paid','written_off')`,
      ];
      if (input.ar_type) conditions.push(eq(arLedger.ar_type, input.ar_type));

      const buckets = await db.select({
        aging_bucket: arLedger.aging_bucket,
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(SUM(${arLedger.outstanding_amount}), 0)`,
      })
        .from(arLedger)
        .where(and(...conditions))
        .groupBy(arLedger.aging_bucket);

      // Top overdue by amount
      const topOverdue = await db.select()
        .from(arLedger)
        .where(and(
          eq(arLedger.hospital_id, ctx.user.hospital_id),
          sql`${arLedger.status} NOT IN ('paid','written_off')`,
          sql`${arLedger.days_outstanding} > 0`,
          ...(input.ar_type ? [eq(arLedger.ar_type, input.ar_type)] : []),
        ))
        .orderBy(desc(arLedger.outstanding_amount))
        .limit(10);

      // Totals
      const totals = await db.select({
        total_receivable: sql<number>`COALESCE(SUM(${arLedger.outstanding_amount}), 0)`,
        total_entries: sql<number>`count(*)`,
      })
        .from(arLedger)
        .where(and(...conditions));

      return {
        buckets: buckets.map(b => ({ bucket: b.aging_bucket, count: Number(b.count), total: Number(b.total) })),
        top_overdue: topOverdue,
        total_receivable: Number(totals[0]?.total_receivable ?? 0),
        total_entries: Number(totals[0]?.total_entries ?? 0),
      };
    }),

  // Insurance AR by TPA
  tpaAgingSummary: protectedProcedure
    .query(async ({ ctx }) => {
      const rows = await db.select({
        tpa_name: arLedger.tpa_name,
        count: sql<number>`count(*)`,
        total_outstanding: sql<number>`COALESCE(SUM(${arLedger.outstanding_amount}), 0)`,
        avg_days: sql<number>`COALESCE(AVG(${arLedger.days_outstanding}), 0)`,
      })
        .from(arLedger)
        .where(and(
          eq(arLedger.hospital_id, ctx.user.hospital_id),
          eq(arLedger.ar_type, 'insurance'),
          sql`${arLedger.status} NOT IN ('paid','written_off')`,
        ))
        .groupBy(arLedger.tpa_name)
        .orderBy(desc(sql`SUM(${arLedger.outstanding_amount})`));

      return rows.map(r => ({
        tpa_name: r.tpa_name || 'Unknown',
        count: Number(r.count),
        total_outstanding: Number(r.total_outstanding),
        avg_days: Math.round(Number(r.avg_days)),
      }));
    }),

  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const statusCounts = await db.select({
        status: arLedger.status,
        ar_type: arLedger.ar_type,
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(SUM(${arLedger.outstanding_amount}), 0)`,
      })
        .from(arLedger)
        .where(eq(arLedger.hospital_id, ctx.user.hospital_id))
        .groupBy(arLedger.status, arLedger.ar_type);

      const unidentified = await db.select({ count: sql<number>`count(*)`, total: sql<number>`COALESCE(SUM(${arPaymentMatches.amount}), 0)` })
        .from(arPaymentMatches)
        .where(and(eq(arPaymentMatches.hospital_id, ctx.user.hospital_id), eq(arPaymentMatches.match_status, 'unidentified')));

      return {
        by_status_type: statusCounts.map(s => ({
          status: s.status, ar_type: s.ar_type,
          count: Number(s.count), total: Number(s.total),
        })),
        unidentified_payments: { count: Number(unidentified[0]?.count ?? 0), total: Number(unidentified[0]?.total ?? 0) },
      };
    }),
});
