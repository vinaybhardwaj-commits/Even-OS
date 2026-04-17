import { pgTable, text, uuid, timestamp, numeric, boolean, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────
export const finStatementTypeEnum = pgEnum('fin_statement_type', [
  'income_statement', 'balance_sheet', 'cash_flow', 'trial_balance',
]);
export const finStatementStatusEnum = pgEnum('fin_statement_status', [
  'draft', 'reviewed', 'approved', 'published',
]);
export const budgetStatusEnum = pgEnum('budget_status', ['draft', 'approved', 'revised']);

// ── Statement Snapshots ────────────────────────────
// Immutable snapshots of generated financial statements.
// The `data` JSONB column stores the full statement structure.
export const financialStatements = pgTable('financial_statements', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull(),

  statement_type: finStatementTypeEnum('statement_type').notNull(),
  title: text('title').notNull(),                         // 'P&L — April 2026'
  period_start: text('period_start').notNull(),           // YYYY-MM-DD
  period_end: text('period_end').notNull(),
  comparison_period_start: text('comparison_period_start'),
  comparison_period_end: text('comparison_period_end'),

  // Full statement data as JSON
  data: jsonb('data').notNull(),                          // structured rows: { sections: [...], totals: {...} }

  // Validation
  is_balanced: boolean('is_balanced').notNull().default(true),
  total_debit: numeric('total_debit', { precision: 16, scale: 2 }),
  total_credit: numeric('total_credit', { precision: 16, scale: 2 }),
  net_profit: numeric('net_profit', { precision: 16, scale: 2 }),

  status: finStatementStatusEnum('status').notNull().default('draft'),
  notes: text('notes'),

  generated_by: uuid('generated_by'),
  reviewed_by: uuid('reviewed_by'),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  approved_by: uuid('approved_by'),
  approved_at: timestamp('approved_at', { withTimezone: true }),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('fin_stmt_hospital_idx').on(t.hospital_id),
  typeIdx: index('fin_stmt_type_idx').on(t.hospital_id, t.statement_type),
  periodIdx: index('fin_stmt_period_idx').on(t.period_start, t.period_end),
  statusIdx: index('fin_stmt_status_idx').on(t.status),
}));

// ── Budget Line Items ──────────────────────────────
// Budget entries by GL account + period for variance analysis.
export const budgetEntries = pgTable('budget_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull(),

  account_id: uuid('account_id').notNull(),               // FK to chartOfAccounts
  account_code: text('account_code').notNull(),
  account_name: text('account_name').notNull(),

  period_start: text('period_start').notNull(),           // YYYY-MM-DD (month start)
  period_end: text('period_end').notNull(),

  budget_amount: numeric('budget_amount', { precision: 14, scale: 2 }).notNull(),
  revised_amount: numeric('revised_amount', { precision: 14, scale: 2 }),

  status: budgetStatusEnum('status').notNull().default('draft'),
  notes: text('notes'),

  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('budget_hospital_idx').on(t.hospital_id),
  accountIdx: index('budget_account_idx').on(t.account_id),
  periodIdx: index('budget_period_idx').on(t.hospital_id, t.period_start),
  accountPeriodIdx: index('budget_acct_period_idx').on(t.account_id, t.period_start),
}));
