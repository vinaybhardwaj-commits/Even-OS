import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex, date, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hospitals, users } from './00-foundations';
import { chartOfAccounts } from './44-chart-of-accounts';
import { patients, encounters } from './03-registration';

// ============================================================
// ENUMS — Journal Entries & GL (Finance Module C.2)
// ============================================================

export const jeEntryTypeEnum = pgEnum('je_entry_type', [
  'auto_billing',
  'auto_collection',
  'auto_deposit',
  'auto_refund',
  'auto_waiver',
  'auto_pharmacy',
  'auto_payroll',
  'auto_vendor',
  'manual',
  'adjustment',
  'opening_balance',
  'closing',
]);

export const jeStatusEnum = pgEnum('je_status', [
  'draft',
  'posted',
  'reversed',
  'voided',
]);

export const jeReferenceTypeEnum = pgEnum('je_reference_type', [
  'invoice',
  'payment',
  'deposit',
  'refund',
  'waiver',
  'purchase_order',
  'vendor_invoice',
  'payroll_run',
  'insurance_settlement',
  'claim',
  'other',
]);

export const depositTxnTypeEnum = pgEnum('deposit_txn_type', [
  'collection',
  'application',
  'refund',
  'adjustment',
]);

// ============================================================
// JOURNAL_ENTRIES — Double-entry ledger header
// ============================================================

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  entry_number: varchar('entry_number', { length: 30 }).notNull(), // JE-YYYYMMDD-NNNN
  entry_date: date('entry_date').notNull(),
  entry_type: text('entry_type').notNull(), // auto_billing, manual, etc.

  period_id: uuid('period_id'), // FK to accounting_periods — added in C.7

  narration: text('narration').notNull(),

  reference_type: text('reference_type'), // invoice, payment, deposit, etc.
  reference_id: uuid('reference_id'),     // Link to source document

  total_debit: numeric('total_debit', { precision: 15, scale: 2 }).notNull(),
  total_credit: numeric('total_credit', { precision: 15, scale: 2 }).notNull(),

  status: text('status').notNull().default('draft'), // draft, posted, reversed, voided

  posted_by: uuid('posted_by'),
  posted_at: timestamp('posted_at'),

  reversed_by: uuid('reversed_by'),
  reversed_at: timestamp('reversed_at'),
  reversal_entry_id: uuid('reversal_entry_id'), // Self-referencing — points to the reversing JE

  data_hash: varchar('data_hash', { length: 64 }), // SHA-256 tamper detection

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_je_hospital').on(t.hospital_id),
  dateIdx: index('idx_je_date').on(t.entry_date),
  statusIdx: index('idx_je_status').on(t.status),
  typeIdx: index('idx_je_type').on(t.entry_type),
  refIdx: index('idx_je_reference').on(t.reference_type, t.reference_id),
  numberUnique: uniqueIndex('idx_je_number_unique').on(t.hospital_id, t.entry_number),
  periodIdx: index('idx_je_period').on(t.period_id),
  // Balanced constraint enforced at DB level via migration script
}));

// ============================================================
// JOURNAL_ENTRY_LINES — Individual debit/credit lines
// ============================================================

export const journalEntryLines = pgTable('journal_entry_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  journal_entry_id: uuid('journal_entry_id').notNull().references(() => journalEntries.id, { onDelete: 'restrict' }),
  account_id: uuid('account_id').notNull().references(() => chartOfAccounts.id, { onDelete: 'restrict' }),

  debit_amount: numeric('debit_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  credit_amount: numeric('credit_amount', { precision: 15, scale: 2 }).notNull().default('0'),

  narration: text('narration'),
  cost_center: text('cost_center'), // department, ward, project

  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  entryIdx: index('idx_je_lines_entry').on(t.journal_entry_id),
  accountIdx: index('idx_je_lines_account').on(t.account_id),
  hospitalIdx: index('idx_je_lines_hospital').on(t.hospital_id),
}));

// ============================================================
// DEPOSIT_TRANSACTIONS — Individual deposit records with JE FK
// ============================================================

export const depositTransactions = pgTable('deposit_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'restrict' }),

  txn_type: text('txn_type').notNull(), // collection, application, refund, adjustment
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  payment_method: text('payment_method'), // cash, card, upi, neft, cheque
  payment_reference: text('payment_reference'), // transaction ID, cheque number

  narration: text('narration'),

  journal_entry_id: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_dep_txn_patient').on(t.patient_id),
  encounterIdx: index('idx_dep_txn_encounter').on(t.encounter_id),
  hospitalIdx: index('idx_dep_txn_hospital').on(t.hospital_id),
  jeIdx: index('idx_dep_txn_je').on(t.journal_entry_id),
  typeIdx: index('idx_dep_txn_type').on(t.txn_type),
}));
