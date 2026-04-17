import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { financialStatements, budgetEntries, chartOfAccounts, journalEntries, journalEntryLines } from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, desc, asc, gte, lte, inArray } from 'drizzle-orm';

const statementTypes = ['income_statement', 'balance_sheet', 'cash_flow', 'trial_balance'] as const;
const statementStatuses = ['draft', 'reviewed', 'approved', 'published'] as const;

// Helper: get posted JE line balances by account type for a period
async function getGLBalances(hospitalId: string, periodStart: string, periodEnd: string) {
  const rows = await db.select({
    account_id: journalEntryLines.account_id,
    account_code: chartOfAccounts.account_code,
    account_name: chartOfAccounts.account_name,
    account_type: chartOfAccounts.account_type,
    account_sub_type: chartOfAccounts.account_sub_type,
    normal_balance: chartOfAccounts.normal_balance,
    total_debit: sql<number>`COALESCE(SUM(${journalEntryLines.debit_amount}), 0)`,
    total_credit: sql<number>`COALESCE(SUM(${journalEntryLines.credit_amount}), 0)`,
  })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
    .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
    .where(and(
      eq(journalEntries.hospital_id, hospitalId),
      eq(journalEntries.status, 'posted'),
      gte(journalEntries.entry_date, periodStart),
      lte(journalEntries.entry_date, periodEnd),
    ))
    .groupBy(
      journalEntryLines.account_id,
      chartOfAccounts.account_code,
      chartOfAccounts.account_name,
      chartOfAccounts.account_type,
      chartOfAccounts.account_sub_type,
      chartOfAccounts.normal_balance,
    )
    .orderBy(asc(chartOfAccounts.account_code));

  return rows.map(r => ({
    account_id: r.account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    account_type: r.account_type,
    account_sub_type: r.account_sub_type,
    normal_balance: r.normal_balance,
    total_debit: Number(r.total_debit),
    total_credit: Number(r.total_credit),
    balance: r.normal_balance === 'debit'
      ? Number(r.total_debit) - Number(r.total_credit)
      : Number(r.total_credit) - Number(r.total_debit),
  }));
}

// Helper: cumulative balances up to a date (for balance sheet)
async function getCumulativeBalances(hospitalId: string, asOfDate: string) {
  const rows = await db.select({
    account_id: journalEntryLines.account_id,
    account_code: chartOfAccounts.account_code,
    account_name: chartOfAccounts.account_name,
    account_type: chartOfAccounts.account_type,
    account_sub_type: chartOfAccounts.account_sub_type,
    normal_balance: chartOfAccounts.normal_balance,
    total_debit: sql<number>`COALESCE(SUM(${journalEntryLines.debit_amount}), 0)`,
    total_credit: sql<number>`COALESCE(SUM(${journalEntryLines.credit_amount}), 0)`,
  })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journal_entry_id, journalEntries.id))
    .innerJoin(chartOfAccounts, eq(journalEntryLines.account_id, chartOfAccounts.id))
    .where(and(
      eq(journalEntries.hospital_id, hospitalId),
      eq(journalEntries.status, 'posted'),
      lte(journalEntries.entry_date, asOfDate),
    ))
    .groupBy(
      journalEntryLines.account_id,
      chartOfAccounts.account_code,
      chartOfAccounts.account_name,
      chartOfAccounts.account_type,
      chartOfAccounts.account_sub_type,
      chartOfAccounts.normal_balance,
    )
    .orderBy(asc(chartOfAccounts.account_code));

  return rows.map(r => ({
    account_id: r.account_id,
    account_code: r.account_code,
    account_name: r.account_name,
    account_type: r.account_type,
    account_sub_type: r.account_sub_type,
    normal_balance: r.normal_balance,
    total_debit: Number(r.total_debit),
    total_credit: Number(r.total_credit),
    balance: r.normal_balance === 'debit'
      ? Number(r.total_debit) - Number(r.total_credit)
      : Number(r.total_credit) - Number(r.total_debit),
  }));
}

function groupByType(balances: any[]) {
  const groups: Record<string, any[]> = {};
  for (const b of balances) {
    const type = b.account_type || 'unknown';
    if (!groups[type]) groups[type] = [];
    groups[type].push(b);
  }
  return groups;
}

function sumBalances(items: any[]): number {
  return items.reduce((s, i) => s + i.balance, 0);
}

export const financialStatementsRouter = router({

  // ═══════════════════════════════════════════════
  // INCOME STATEMENT (P&L)
  // ═══════════════════════════════════════════════

  generateIncomeStatement: protectedProcedure
    .input(z.object({
      period_start: z.string(),
      period_end: z.string(),
      comparison_period_start: z.string().optional(),
      comparison_period_end: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const balances = await getGLBalances(ctx.user.hospital_id, input.period_start, input.period_end);
      const groups = groupByType(balances);

      // Revenue accounts
      const revenueItems = (groups['revenue'] || []).map(a => ({
        code: a.account_code, name: a.account_name, sub_type: a.account_sub_type, amount: a.balance,
      }));
      const totalRevenue = sumBalances(groups['revenue'] || []);

      // Expense accounts
      const expenseItems = (groups['expense'] || []).map(a => ({
        code: a.account_code, name: a.account_name, sub_type: a.account_sub_type, amount: a.balance,
      }));
      const totalExpenses = sumBalances(groups['expense'] || []);

      const netProfit = totalRevenue - totalExpenses;

      // Group expenses by sub_type for breakdown
      const expenseBySubType: Record<string, number> = {};
      for (const e of expenseItems) {
        const st = e.sub_type || 'other';
        expenseBySubType[st] = (expenseBySubType[st] || 0) + e.amount;
      }

      // Comparison period
      let comparison = null;
      if (input.comparison_period_start && input.comparison_period_end) {
        const compBalances = await getGLBalances(ctx.user.hospital_id, input.comparison_period_start, input.comparison_period_end);
        const compGroups = groupByType(compBalances);
        const compRevenue = sumBalances(compGroups['revenue'] || []);
        const compExpenses = sumBalances(compGroups['expense'] || []);
        const compNetProfit = compRevenue - compExpenses;
        comparison = {
          period_start: input.comparison_period_start,
          period_end: input.comparison_period_end,
          total_revenue: compRevenue,
          total_expenses: compExpenses,
          net_profit: compNetProfit,
          revenue_items: (compGroups['revenue'] || []).map(a => ({ code: a.account_code, name: a.account_name, amount: a.balance })),
          expense_items: (compGroups['expense'] || []).map(a => ({ code: a.account_code, name: a.account_name, amount: a.balance })),
        };
      }

      // Budget variance
      const budgets = await db.select()
        .from(budgetEntries)
        .where(and(
          eq(budgetEntries.hospital_id, ctx.user.hospital_id),
          gte(budgetEntries.period_start, input.period_start),
          lte(budgetEntries.period_end, input.period_end),
        ));

      const budgetMap: Record<string, number> = {};
      for (const b of budgets) {
        budgetMap[b.account_id] = Number(b.revised_amount || b.budget_amount);
      }

      const revenueWithBudget = revenueItems.map(r => ({
        ...r, budget: budgetMap[balances.find(b => b.account_code === r.code)?.account_id || ''] || 0,
        variance: r.amount - (budgetMap[balances.find(b => b.account_code === r.code)?.account_id || ''] || 0),
      }));
      const expenseWithBudget = expenseItems.map(e => ({
        ...e, budget: budgetMap[balances.find(b => b.account_code === e.code)?.account_id || ''] || 0,
        variance: e.amount - (budgetMap[balances.find(b => b.account_code === e.code)?.account_id || ''] || 0),
      }));

      return {
        period: { start: input.period_start, end: input.period_end },
        revenue: { items: revenueWithBudget, total: totalRevenue },
        expenses: { items: expenseWithBudget, total: totalExpenses, by_sub_type: expenseBySubType },
        net_profit: netProfit,
        comparison,
      };
    }),

  // ═══════════════════════════════════════════════
  // BALANCE SHEET
  // ═══════════════════════════════════════════════

  generateBalanceSheet: protectedProcedure
    .input(z.object({ as_of_date: z.string() }))
    .query(async ({ ctx, input }) => {
      const balances = await getCumulativeBalances(ctx.user.hospital_id, input.as_of_date);
      const groups = groupByType(balances);

      const assets = (groups['asset'] || []).map(a => ({ code: a.account_code, name: a.account_name, sub_type: a.account_sub_type, balance: a.balance }));
      const liabilities = (groups['liability'] || []).map(a => ({ code: a.account_code, name: a.account_name, sub_type: a.account_sub_type, balance: a.balance }));
      const equity = (groups['equity'] || []).map(a => ({ code: a.account_code, name: a.account_name, sub_type: a.account_sub_type, balance: a.balance }));

      // Retained earnings = cumulative revenue - cumulative expenses
      const revenueTotal = sumBalances(groups['revenue'] || []);
      const expenseTotal = sumBalances(groups['expense'] || []);
      const retainedEarnings = revenueTotal - expenseTotal;

      const totalAssets = sumBalances(groups['asset'] || []);
      const totalLiabilities = sumBalances(groups['liability'] || []);
      const totalEquity = sumBalances(groups['equity'] || []) + retainedEarnings;

      const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

      return {
        as_of_date: input.as_of_date,
        assets: { items: assets, total: totalAssets },
        liabilities: { items: liabilities, total: totalLiabilities },
        equity: {
          items: [...equity, { code: 'RE', name: 'Retained Earnings (Current Period)', sub_type: 'retained_earnings', balance: retainedEarnings }],
          total: totalEquity,
        },
        is_balanced: isBalanced,
        accounting_equation: { assets: totalAssets, liabilities_plus_equity: totalLiabilities + totalEquity, difference: totalAssets - (totalLiabilities + totalEquity) },
      };
    }),

  // ═══════════════════════════════════════════════
  // CASH FLOW STATEMENT
  // ═══════════════════════════════════════════════

  generateCashFlow: protectedProcedure
    .input(z.object({ period_start: z.string(), period_end: z.string() }))
    .query(async ({ ctx, input }) => {
      const balances = await getGLBalances(ctx.user.hospital_id, input.period_start, input.period_end);
      const groups = groupByType(balances);

      // Operating: revenue - expenses + changes in working capital
      const revenueTotal = sumBalances(groups['revenue'] || []);
      const expenseTotal = sumBalances(groups['expense'] || []);
      const operatingIncome = revenueTotal - expenseTotal;

      // Separate expense sub-types for depreciation/interest
      const depreciation = (groups['expense'] || [])
        .filter(e => e.account_sub_type === 'depreciation')
        .reduce((s: number, e: any) => s + e.balance, 0);
      const interest = (groups['expense'] || [])
        .filter(e => e.account_sub_type === 'interest')
        .reduce((s: number, e: any) => s + e.balance, 0);

      // EBITDA (add back depreciation + interest)
      const ebitda = operatingIncome + depreciation + interest;

      // Investing: changes in fixed assets
      const investingItems = (groups['asset'] || [])
        .filter(a => a.account_sub_type === 'fixed_asset')
        .map(a => ({ code: a.account_code, name: a.account_name, amount: -a.balance }));
      const investingTotal = investingItems.reduce((s, i) => s + i.amount, 0);

      // Financing: changes in long-term liabilities + equity
      const financingLiabilities = (groups['liability'] || [])
        .filter(l => l.account_sub_type === 'long_term')
        .map(l => ({ code: l.account_code, name: l.account_name, amount: l.balance }));
      const financingEquity = (groups['equity'] || [])
        .map(e => ({ code: e.account_code, name: e.account_name, amount: e.balance }));
      const financingItems = [...financingLiabilities, ...financingEquity];
      const financingTotal = financingItems.reduce((s, i) => s + i.amount, 0);

      const netCashChange = operatingIncome + investingTotal + financingTotal;

      return {
        period: { start: input.period_start, end: input.period_end },
        operating: {
          net_income: operatingIncome,
          add_back_depreciation: depreciation,
          add_back_interest: interest,
          ebitda,
          total: operatingIncome,
        },
        investing: { items: investingItems, total: investingTotal },
        financing: { items: financingItems, total: financingTotal },
        net_cash_change: netCashChange,
      };
    }),

  // ═══════════════════════════════════════════════
  // TRIAL BALANCE
  // ═══════════════════════════════════════════════

  generateTrialBalance: protectedProcedure
    .input(z.object({ period_start: z.string(), period_end: z.string() }))
    .query(async ({ ctx, input }) => {
      const balances = await getGLBalances(ctx.user.hospital_id, input.period_start, input.period_end);

      const items = balances.map(b => ({
        account_code: b.account_code,
        account_name: b.account_name,
        account_type: b.account_type,
        debit: b.total_debit,
        credit: b.total_credit,
        closing_balance: b.balance,
        normal_balance: b.normal_balance,
      }));

      const totalDebit = balances.reduce((s, b) => s + b.total_debit, 0);
      const totalCredit = balances.reduce((s, b) => s + b.total_credit, 0);
      const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

      return {
        period: { start: input.period_start, end: input.period_end },
        items,
        total_debit: totalDebit,
        total_credit: totalCredit,
        is_balanced: isBalanced,
        difference: totalDebit - totalCredit,
      };
    }),

  // ═══════════════════════════════════════════════
  // SAVE SNAPSHOT
  // ═══════════════════════════════════════════════

  saveSnapshot: adminProcedure
    .input(z.object({
      statement_type: z.enum(statementTypes),
      title: z.string().min(1),
      period_start: z.string(),
      period_end: z.string(),
      comparison_period_start: z.string().optional(),
      comparison_period_end: z.string().optional(),
      data: z.any(),
      is_balanced: z.boolean().default(true),
      total_debit: z.number().optional(),
      total_credit: z.number().optional(),
      net_profit: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inserted = await db.insert(financialStatements).values({
        hospital_id: ctx.user.hospital_id,
        statement_type: input.statement_type,
        title: input.title,
        period_start: input.period_start,
        period_end: input.period_end,
        comparison_period_start: input.comparison_period_start || null,
        comparison_period_end: input.comparison_period_end || null,
        data: input.data,
        is_balanced: input.is_balanced,
        total_debit: input.total_debit != null ? String(input.total_debit) : null,
        total_credit: input.total_credit != null ? String(input.total_credit) : null,
        net_profit: input.net_profit != null ? String(input.net_profit) : null,
        notes: input.notes || null,
        generated_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'financial_statements', row_id: inserted[0].id,
        new_values: { statement_type: input.statement_type, title: input.title },
        reason: 'Financial statement snapshot saved',
      });

      return inserted[0];
    }),

  listSnapshots: protectedProcedure
    .input(z.object({
      statement_type: z.enum(statementTypes).optional(),
      status: z.enum(statementStatuses).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(20),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const { statement_type, status, page, pageSize } = input;
      const conditions: any[] = [eq(financialStatements.hospital_id, ctx.user.hospital_id)];
      if (statement_type) conditions.push(eq(financialStatements.statement_type, statement_type));
      if (status) conditions.push(eq(financialStatements.status, status));

      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(financialStatements).where(and(...conditions));
      const total = Number(countResult[0]?.count ?? 0);

      const rows = await db.select({
        id: financialStatements.id,
        statement_type: financialStatements.statement_type,
        title: financialStatements.title,
        period_start: financialStatements.period_start,
        period_end: financialStatements.period_end,
        is_balanced: financialStatements.is_balanced,
        net_profit: financialStatements.net_profit,
        status: financialStatements.status,
        created_at: financialStatements.created_at,
      })
        .from(financialStatements)
        .where(and(...conditions))
        .orderBy(desc(financialStatements.created_at))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return { items: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  getSnapshot: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await db.select()
        .from(financialStatements)
        .where(and(eq(financialStatements.id, input.id), eq(financialStatements.hospital_id, ctx.user.hospital_id)))
        .limit(1);
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND' });
      return rows[0];
    }),

  updateSnapshotStatus: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(statementStatuses),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateObj: any = { status: input.status, updated_at: new Date() };
      if (input.status === 'reviewed') { updateObj.reviewed_by = ctx.user.sub; updateObj.reviewed_at = new Date(); }
      if (input.status === 'approved') { updateObj.approved_by = ctx.user.sub; updateObj.approved_at = new Date(); }

      const updated = await db.update(financialStatements).set(updateObj)
        .where(and(eq(financialStatements.id, input.id), eq(financialStatements.hospital_id, ctx.user.hospital_id)))
        .returning();
      if (!updated.length) throw new TRPCError({ code: 'NOT_FOUND' });

      await writeAuditLog(ctx.user, { action: 'UPDATE', table_name: 'financial_statements', row_id: input.id, new_values: { status: input.status }, reason: `Statement ${input.status}` });
      return updated[0];
    }),

  // ═══════════════════════════════════════════════
  // BUDGET ENTRIES
  // ═══════════════════════════════════════════════

  listBudgets: protectedProcedure
    .input(z.object({
      period_start: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(50),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const conditions: any[] = [eq(budgetEntries.hospital_id, ctx.user.hospital_id)];
      if (input.period_start) conditions.push(eq(budgetEntries.period_start, input.period_start));

      const rows = await db.select()
        .from(budgetEntries)
        .where(and(...conditions))
        .orderBy(asc(budgetEntries.account_code))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const countResult = await db.select({ count: sql<number>`count(*)` }).from(budgetEntries).where(and(...conditions));
      return { items: rows, total: Number(countResult[0]?.count ?? 0) };
    }),

  createBudget: adminProcedure
    .input(z.object({
      account_id: z.string().uuid(),
      account_code: z.string(),
      account_name: z.string(),
      period_start: z.string(),
      period_end: z.string(),
      budget_amount: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inserted = await db.insert(budgetEntries).values({
        hospital_id: ctx.user.hospital_id,
        account_id: input.account_id,
        account_code: input.account_code,
        account_name: input.account_name,
        period_start: input.period_start,
        period_end: input.period_end,
        budget_amount: String(input.budget_amount),
        created_by: ctx.user.sub,
      } as any).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT', table_name: 'budget_entries', row_id: inserted[0].id,
        new_values: { account_code: input.account_code, budget_amount: input.budget_amount },
        reason: 'Budget entry created',
      });
      return inserted[0];
    }),

  updateBudget: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      revised_amount: z.number().optional(),
      status: z.enum(['draft', 'approved', 'revised'] as const).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updateObj: any = { updated_at: new Date() };
      if (input.revised_amount != null) { updateObj.revised_amount = String(input.revised_amount); updateObj.status = 'revised'; }
      if (input.status) updateObj.status = input.status;
      if (input.notes !== undefined) updateObj.notes = input.notes;

      const updated = await db.update(budgetEntries).set(updateObj)
        .where(and(eq(budgetEntries.id, input.id), eq(budgetEntries.hospital_id, ctx.user.hospital_id)))
        .returning();
      if (!updated.length) throw new TRPCError({ code: 'NOT_FOUND' });
      return updated[0];
    }),
});
