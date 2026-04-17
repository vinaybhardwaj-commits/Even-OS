import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { accountingPeriods, journalEntries, journalEntryLines, chartOfAccounts, arLedger, vendorInvoices } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, gte, lte } from 'drizzle-orm';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const accountingPeriodsRouter = router({

  // ═══════════════════════════════════════════════
  // LIST / GET PERIODS
  // ═══════════════════════════════════════════════

  list: protectedProcedure
    .input(z.object({ fiscal_year: z.number().optional() }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [eq(accountingPeriods.hospital_id, ctx.user.hospital_id)];
      if (input.fiscal_year) conditions.push(eq(accountingPeriods.fiscal_year, input.fiscal_year));

      const rows = await db.select()
        .from(accountingPeriods)
        .where(and(...conditions))
        .orderBy(asc(accountingPeriods.period_year), asc(accountingPeriods.period_month));
      return rows;
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select()
        .from(accountingPeriods)
        .where(and(eq(accountingPeriods.id, input.id), eq(accountingPeriods.hospital_id, ctx.user.hospital_id)));
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND' });
      return rows[0];
    }),

  // ═══════════════════════════════════════════════
  // CREATE PERIOD
  // ═══════════════════════════════════════════════

  create: adminProcedure
    .input(z.object({
      month: z.number().min(1).max(12),
      year: z.number().min(2020),
    }))
    .mutation(async ({ ctx, input }) => {
      const periodCode = `${input.year}-${String(input.month).padStart(2, '0')}`;
      const periodName = `${MONTHS[input.month]} ${input.year}`;
      const startDate = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
      const lastDay = new Date(input.year, input.month, 0).getDate();
      const endDate = `${input.year}-${String(input.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // Indian fiscal year: Apr-Mar
      const fiscalYear = input.month >= 4 ? input.year : input.year - 1;

      // Check duplicate
      const existing = await db.select({ id: accountingPeriods.id })
        .from(accountingPeriods)
        .where(and(
          eq(accountingPeriods.hospital_id, ctx.user.hospital_id),
          eq(accountingPeriods.period_code, periodCode),
        ));
      if (existing.length) throw new TRPCError({ code: 'CONFLICT', message: `Period ${periodName} already exists` });

      const inserted = await db.insert(accountingPeriods).values({
        hospital_id: ctx.user.hospital_id,
        period_name: periodName,
        period_code: periodCode,
        fiscal_year: fiscalYear,
        period_month: input.month,
        period_year: input.year,
        start_date: startDate,
        end_date: endDate,
        status: 'open',
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'accounting_periods', row_id: inserted[0].id,
        new_values: { period_code: periodCode, status: 'open' },
        reason: `Period ${periodName} created`,
      });
      return inserted[0];
    }),

  // ═══════════════════════════════════════════════
  // SOFT CLOSE — blocks auto-JEs, manual adjustments still allowed
  // ═══════════════════════════════════════════════

  softClose: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify period is open
      const periods = await db.select()
        .from(accountingPeriods)
        .where(and(eq(accountingPeriods.id, input.id), eq(accountingPeriods.hospital_id, ctx.user.hospital_id)));
      if (!periods.length) throw new TRPCError({ code: 'NOT_FOUND' });
      if (periods[0].status !== 'open') throw new TRPCError({ code: 'BAD_REQUEST', message: `Period is already ${periods[0].status}` });

      // Generate close summary
      const summary = await generateCloseSummary(ctx.user.hospital_id, periods[0].start_date, periods[0].end_date);

      const updated = await db.update(accountingPeriods).set({
        status: 'soft_closed',
        soft_closed_by: ctx.user.sub,
        soft_closed_at: new Date(),
        soft_close_notes: input.notes || null,
        close_summary: summary,
        updated_at: new Date(),
      }).where(eq(accountingPeriods.id, input.id)).returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'accounting_periods', row_id: input.id,
        new_values: { status: 'soft_closed' },
        reason: `Period soft-closed: ${input.notes || 'no notes'}`,
      });
      return updated[0];
    }),

  // ═══════════════════════════════════════════════
  // HARD CLOSE — fully locked, no entries of any kind
  // ═══════════════════════════════════════════════

  hardClose: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const periods = await db.select()
        .from(accountingPeriods)
        .where(and(eq(accountingPeriods.id, input.id), eq(accountingPeriods.hospital_id, ctx.user.hospital_id)));
      if (!periods.length) throw new TRPCError({ code: 'NOT_FOUND' });
      if (periods[0].status === 'hard_closed') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Period already hard-closed' });

      const summary = await generateCloseSummary(ctx.user.hospital_id, periods[0].start_date, periods[0].end_date);

      const updated = await db.update(accountingPeriods).set({
        status: 'hard_closed',
        hard_closed_by: ctx.user.sub,
        hard_closed_at: new Date(),
        hard_close_notes: input.notes || null,
        close_summary: summary,
        updated_at: new Date(),
      }).where(eq(accountingPeriods.id, input.id)).returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'accounting_periods', row_id: input.id,
        new_values: { status: 'hard_closed' },
        reason: `Period hard-closed: ${input.notes || 'no notes'}`,
      });
      return updated[0];
    }),

  // ═══════════════════════════════════════════════
  // REOPEN — returns period to open status (with audit)
  // ═══════════════════════════════════════════════

  reopen: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const periods = await db.select()
        .from(accountingPeriods)
        .where(and(eq(accountingPeriods.id, input.id), eq(accountingPeriods.hospital_id, ctx.user.hospital_id)));
      if (!periods.length) throw new TRPCError({ code: 'NOT_FOUND' });
      if (periods[0].status === 'open') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Period is already open' });

      const updated = await db.update(accountingPeriods).set({
        status: 'open',
        reopened_by: ctx.user.sub,
        reopened_at: new Date(),
        reopen_reason: input.reason,
        updated_at: new Date(),
      }).where(eq(accountingPeriods.id, input.id)).returning();

      await writeAuditLog(ctx.user, {
        action: 'UPDATE', table_name: 'accounting_periods', row_id: input.id,
        new_values: { status: 'open', reopen_reason: input.reason },
        reason: `Period reopened: ${input.reason}`,
      });
      return updated[0];
    }),

  // ═══════════════════════════════════════════════
  // CHECK PERIOD STATUS (for JE validation)
  // ═══════════════════════════════════════════════

  checkPeriodForDate: protectedProcedure
    .input(z.object({ entry_date: z.string(), entry_type: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // Find period containing this date
      const periods = await db.select()
        .from(accountingPeriods)
        .where(and(
          eq(accountingPeriods.hospital_id, ctx.user.hospital_id),
          lte(accountingPeriods.start_date, input.entry_date),
          gte(accountingPeriods.end_date, input.entry_date),
        ));

      if (!periods.length) return { allowed: true, period: null, reason: 'No period defined — entries allowed' };

      const period = periods[0];
      if (period.status === 'open') return { allowed: true, period, reason: 'Period is open' };
      if (period.status === 'soft_closed') {
        // Soft close: block auto-JEs, allow manual
        const isAuto = input.entry_type?.startsWith('auto_');
        if (isAuto) return { allowed: false, period, reason: `Period ${period.period_name} is soft-closed. Auto-JEs blocked.` };
        return { allowed: true, period, reason: 'Period soft-closed — manual entries allowed' };
      }
      if (period.status === 'hard_closed') {
        return { allowed: false, period, reason: `Period ${period.period_name} is hard-closed. No entries allowed.` };
      }

      return { allowed: true, period, reason: 'Unknown status' };
    }),

  // ═══════════════════════════════════════════════
  // FINANCE DASHBOARD
  // ═══════════════════════════════════════════════

  financeDashboard: protectedProcedure
    .input(z.object({
      month: z.number().min(1).max(12).optional(),
      year: z.number().optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const month = input.month || (now.getMonth() + 1);
      const year = input.year || now.getFullYear();
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const hid = ctx.user.hospital_id;

      // Revenue this month (credit to revenue accounts)
      const revenueResult = await db.select({
        total: sql<number>`COALESCE(SUM(${journalEntryLines.credit_amount}), 0)`,
      })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
        .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
        .where(and(
          eq(journalEntries.hospital_id, hid),
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entry_date, start),
          lte(journalEntries.entry_date, end),
          eq(chartOfAccounts.account_type, 'revenue'),
        ));

      // Expenses this month (debit to expense accounts)
      const expenseResult = await db.select({
        total: sql<number>`COALESCE(SUM(${journalEntryLines.debit_amount}), 0)`,
      })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
        .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
        .where(and(
          eq(journalEntries.hospital_id, hid),
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entry_date, start),
          lte(journalEntries.entry_date, end),
          eq(chartOfAccounts.account_type, 'expense'),
        ));

      // Cash balance (bank/cash asset accounts)
      const cashResult = await db.select({
        total_debit: sql<number>`COALESCE(SUM(${journalEntryLines.debit_amount}), 0)`,
        total_credit: sql<number>`COALESCE(SUM(${journalEntryLines.credit_amount}), 0)`,
      })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
        .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
        .where(and(
          eq(journalEntries.hospital_id, hid),
          eq(journalEntries.status, 'posted'),
          eq(chartOfAccounts.account_type, 'asset'),
          sql`(${chartOfAccounts.account_name} ILIKE '%bank%' OR ${chartOfAccounts.account_name} ILIKE '%cash%')`,
        ));

      // AR aging summary
      const arResult = await db.select({
        total_outstanding: sql<number>`COALESCE(SUM(${arLedger.outstanding_amount}), 0)`,
        count: sql<number>`count(*)`,
      })
        .from(arLedger)
        .where(and(
          eq(arLedger.hospital_id, hid),
          sql`${arLedger.status} NOT IN ('paid', 'written_off')`,
        ));

      // AP due (unpaid vendor invoices)
      const apResult = await db.select({
        total_due: sql<number>`COALESCE(SUM(${vendorInvoices.net_payable}), 0)`,
        count: sql<number>`count(*)`,
      })
        .from(vendorInvoices)
        .where(and(
          eq(vendorInvoices.hospital_id, hid),
          sql`${vendorInvoices.status} NOT IN ('paid', 'disputed')`,
        ));

      // JE stats this month
      const jeStats = await db.select({
        total_je: sql<number>`count(*)`,
        total_debit: sql<number>`COALESCE(SUM(${journalEntries.total_debit}), 0)`,
      })
        .from(journalEntries)
        .where(and(
          eq(journalEntries.hospital_id, hid),
          eq(journalEntries.status, 'posted'),
          gte(journalEntries.entry_date, start),
          lte(journalEntries.entry_date, end),
        ));

      // Current period
      const periodRows = await db.select()
        .from(accountingPeriods)
        .where(and(
          eq(accountingPeriods.hospital_id, hid),
          eq(accountingPeriods.period_month, month),
          eq(accountingPeriods.period_year, year),
        ));

      const revenue = Number(revenueResult[0]?.total ?? 0);
      const expense = Number(expenseResult[0]?.total ?? 0);
      const cashDebit = Number(cashResult[0]?.total_debit ?? 0);
      const cashCredit = Number(cashResult[0]?.total_credit ?? 0);

      return {
        period: { month, year, label: `${MONTHS[month]} ${year}` },
        current_period: periodRows[0] || null,
        pnl: { revenue, expense, net_income: revenue - expense },
        cash_position: cashDebit - cashCredit,
        ar: { outstanding: Number(arResult[0]?.total_outstanding ?? 0), count: Number(arResult[0]?.count ?? 0) },
        ap: { due: Number(apResult[0]?.total_due ?? 0), count: Number(apResult[0]?.count ?? 0) },
        je_stats: {
          count: Number(jeStats[0]?.total_je ?? 0),
          volume: Number(jeStats[0]?.total_debit ?? 0),
        },
      };
    }),
});

// ── Helper: generate close summary ───────────────
async function generateCloseSummary(hospitalId: string, startDate: string, endDate: string) {
  const jeStats = await db.select({
    total_je: sql<number>`count(*)`,
    total_debit: sql<number>`COALESCE(SUM(${journalEntries.total_debit}), 0)`,
    total_credit: sql<number>`COALESCE(SUM(${journalEntries.total_credit}), 0)`,
  })
    .from(journalEntries)
    .where(and(
      eq(journalEntries.hospital_id, hospitalId),
      eq(journalEntries.status, 'posted'),
      gte(journalEntries.entry_date, startDate),
      lte(journalEntries.entry_date, endDate),
    ));

  const revenueResult = await db.select({
    total: sql<number>`COALESCE(SUM(${journalEntryLines.credit_amount}), 0)`,
  })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
    .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
    .where(and(
      eq(journalEntries.hospital_id, hospitalId),
      eq(journalEntries.status, 'posted'),
      gte(journalEntries.entry_date, startDate),
      lte(journalEntries.entry_date, endDate),
      eq(chartOfAccounts.account_type, 'revenue'),
    ));

  const expenseResult = await db.select({
    total: sql<number>`COALESCE(SUM(${journalEntryLines.debit_amount}), 0)`,
  })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
    .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
    .where(and(
      eq(journalEntries.hospital_id, hospitalId),
      eq(journalEntries.status, 'posted'),
      gte(journalEntries.entry_date, startDate),
      lte(journalEntries.entry_date, endDate),
      eq(chartOfAccounts.account_type, 'expense'),
    ));

  const revenue = Number(revenueResult[0]?.total ?? 0);
  const expense = Number(expenseResult[0]?.total ?? 0);

  return {
    total_je: Number(jeStats[0]?.total_je ?? 0),
    total_debit: Number(jeStats[0]?.total_debit ?? 0),
    total_credit: Number(jeStats[0]?.total_credit ?? 0),
    revenue,
    expense,
    net_income: revenue - expense,
  };
}
