import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex, date,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hospitals, users } from './00-foundations';

// ============================================================
// ENUMS — Accounting Periods (Finance Module C.7)
// ============================================================

export const accountingPeriodStatusEnum = pgEnum('accounting_period_status', [
  'open',
  'soft_closed',
  'hard_closed',
]);

// ============================================================
// ACCOUNTING_PERIODS — Monthly fiscal periods with close workflow
// ============================================================

export const accountingPeriods = pgTable('accounting_periods', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  period_name: varchar('period_name', { length: 50 }).notNull(), // "April 2026"
  period_code: varchar('period_code', { length: 10 }).notNull(), // "2026-04"
  fiscal_year: integer('fiscal_year').notNull(), // 2026
  period_month: integer('period_month').notNull(), // 4
  period_year: integer('period_year').notNull(), // 2026

  start_date: date('start_date').notNull(),
  end_date: date('end_date').notNull(),

  status: text('status').notNull().default('open'), // open, soft_closed, hard_closed

  // Soft close: blocks auto-JEs. Manual adjustments still allowed.
  soft_closed_by: uuid('soft_closed_by'),
  soft_closed_at: timestamp('soft_closed_at'),
  soft_close_notes: text('soft_close_notes'),

  // Hard close: blocks ALL entries. Period fully locked.
  hard_closed_by: uuid('hard_closed_by'),
  hard_closed_at: timestamp('hard_closed_at'),
  hard_close_notes: text('hard_close_notes'),

  // Reopened tracking
  reopened_by: uuid('reopened_by'),
  reopened_at: timestamp('reopened_at'),
  reopen_reason: text('reopen_reason'),

  // Summary snapshot at close time
  close_summary: jsonb('close_summary'), // { total_je, total_debit, total_credit, revenue, expense, net_income }

  created_by: uuid('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_acct_period_hospital').on(t.hospital_id),
  statusIdx: index('idx_acct_period_status').on(t.hospital_id, t.status),
  yearIdx: index('idx_acct_period_year').on(t.hospital_id, t.fiscal_year),
  codeUnique: uniqueIndex('idx_acct_period_code_unique').on(t.hospital_id, t.period_code),
}));
