import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex, date,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';

// ============================================================
// ENUMS — Chart of Accounts (Finance Module C.1)
// ============================================================

export const coaAccountTypeEnum = pgEnum('coa_account_type', [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
]);

export const coaAccountSubTypeEnum = pgEnum('coa_account_sub_type', [
  'current_asset',
  'fixed_asset',
  'current_liability',
  'long_term_liability',
  'operating_revenue',
  'other_income',
  'operating_expense',
  'cogs',
  'depreciation',
  'tax',
  'equity_capital',
  'equity_reserves',
]);

export const coaNormalBalanceEnum = pgEnum('coa_normal_balance', [
  'debit',
  'credit',
]);

// ============================================================
// CHART_OF_ACCOUNTS — Hierarchical GL account structure
// ============================================================

export const chartOfAccounts = pgTable('chart_of_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  account_code: varchar('account_code', { length: 20 }).notNull(),
  account_name: text('account_name').notNull(),
  account_type: text('account_type').notNull(), // asset, liability, equity, revenue, expense
  account_sub_type: text('account_sub_type'),   // current_asset, fixed_asset, etc.

  parent_account_id: uuid('parent_account_id'), // Self-referencing FK (handled at DB level)
  level: integer('level').notNull().default(1), // 1=group, 2=sub-group, 3=ledger, 4=sub-ledger

  is_group: boolean('is_group').notNull().default(false),
  normal_balance: text('normal_balance').notNull(), // debit or credit

  gst_applicable: boolean('gst_applicable').default(false),
  hsn_sac_code: varchar('hsn_sac_code', { length: 20 }),

  description: text('description'),

  is_active: boolean('is_active').notNull().default(true),
  is_system_account: boolean('is_system_account').notNull().default(false), // Prevent deletion of core accounts

  opening_balance: numeric('opening_balance', { precision: 15, scale: 2 }).default('0'),
  opening_balance_date: date('opening_balance_date'),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_coa_hospital').on(t.hospital_id),
  parentIdx: index('idx_coa_parent').on(t.parent_account_id),
  typeIdx: index('idx_coa_type').on(t.account_type),
  codeUnique: uniqueIndex('idx_coa_code_unique').on(t.hospital_id, t.account_code),
  levelIdx: index('idx_coa_level').on(t.level),
  systemIdx: index('idx_coa_system').on(t.is_system_account),
}));
