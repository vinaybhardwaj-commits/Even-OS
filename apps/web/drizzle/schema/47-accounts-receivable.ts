import { pgTable, text, uuid, timestamp, numeric, boolean, date, integer, pgEnum, index } from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────
export const arTypeEnum = pgEnum('ar_type', ['patient', 'insurance']);
export const arStatusEnum = pgEnum('ar_status', ['open', 'partially_paid', 'paid', 'written_off', 'disputed']);
export const arAgingBucketEnum = pgEnum('ar_aging_bucket', ['current', '1_30', '31_60', '61_90', '91_plus']);
export const collectionActionTypeEnum = pgEnum('collection_action_type', [
  'phone_call', 'sms', 'email', 'letter', 'dunning_notice', 'legal_notice', 'write_off_request', 'escalation', 'note',
]);
export const paymentMatchStatusEnum = pgEnum('payment_match_status', ['matched', 'partial', 'unidentified', 'overpayment']);

// ── AR Ledger ──────────────────────────────────────
// One row per receivable (patient invoice or insurance claim).
// Auto-created from billing or claims; updated as payments arrive.
export const arLedger = pgTable('ar_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull(),

  ar_type: arTypeEnum('ar_type').notNull(),
  ar_number: text('ar_number').notNull(),               // AR-YYYYMMDD-NNNN

  // Patient AR fields
  patient_id: uuid('patient_id'),
  patient_name: text('patient_name'),
  encounter_id: uuid('encounter_id'),
  billing_account_id: uuid('billing_account_id'),
  invoice_number: text('invoice_number'),

  // Insurance AR fields
  insurance_claim_id: uuid('insurance_claim_id'),
  tpa_name: text('tpa_name'),
  policy_number: text('policy_number'),
  claim_number: text('claim_number'),

  // Amounts
  original_amount: numeric('original_amount', { precision: 14, scale: 2 }).notNull(),
  paid_amount: numeric('paid_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  adjusted_amount: numeric('adjusted_amount', { precision: 14, scale: 2 }).notNull().default('0'),  // write-offs, discounts
  outstanding_amount: numeric('outstanding_amount', { precision: 14, scale: 2 }).notNull(),

  // Dates
  invoice_date: text('invoice_date').notNull(),          // YYYY-MM-DD
  due_date: text('due_date').notNull(),
  last_payment_date: text('last_payment_date'),

  // Aging
  aging_bucket: arAgingBucketEnum('aging_bucket').notNull().default('current'),
  days_outstanding: integer('days_outstanding').notNull().default(0),

  // Status
  status: arStatusEnum('status').notNull().default('open'),

  // GL link
  gl_account_id: uuid('gl_account_id'),                 // FK to chartOfAccounts
  journal_entry_id: uuid('journal_entry_id'),            // FK to journalEntries

  // Collection
  last_collection_date: text('last_collection_date'),
  collection_attempts: integer('collection_attempts').notNull().default(0),
  assigned_collector: uuid('assigned_collector'),

  notes: text('notes'),
  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('ar_ledger_hospital_idx').on(table.hospital_id),
  typeIdx: index('ar_ledger_type_idx').on(table.hospital_id, table.ar_type),
  statusIdx: index('ar_ledger_status_idx').on(table.hospital_id, table.status),
  agingIdx: index('ar_ledger_aging_idx').on(table.hospital_id, table.aging_bucket),
  patientIdx: index('ar_ledger_patient_idx').on(table.patient_id),
  claimIdx: index('ar_ledger_claim_idx').on(table.insurance_claim_id),
  dueDateIdx: index('ar_ledger_due_date_idx').on(table.due_date),
}));

// ── Collection Follow-ups ──────────────────────────
export const arCollectionActions = pgTable('ar_collection_actions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull(),
  ar_ledger_id: uuid('ar_ledger_id').notNull(),          // FK to arLedger

  action_type: collectionActionTypeEnum('action_type').notNull(),
  action_date: text('action_date').notNull(),             // YYYY-MM-DD
  scheduled_date: text('scheduled_date'),                 // follow-up date
  completed: boolean('completed').notNull().default(false),
  outcome: text('outcome'),
  notes: text('notes'),

  performed_by: uuid('performed_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  arIdIdx: index('ar_collection_ar_id_idx').on(table.ar_ledger_id),
  scheduledIdx: index('ar_collection_scheduled_idx').on(table.hospital_id, table.scheduled_date),
}));

// ── Payment Matching ───────────────────────────────
// When payments arrive, match them to AR entries.
// Supports partial payments, overpayments, unidentified payments.
export const arPaymentMatches = pgTable('ar_payment_matches', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull(),

  ar_ledger_id: uuid('ar_ledger_id'),                    // nullable for unidentified
  payment_reference: text('payment_reference').notNull(), // UTR / cheque / receipt
  payment_date: text('payment_date').notNull(),
  payment_method: text('payment_method'),                 // neft, rtgs, cheque, upi, cash, dd
  payer_name: text('payer_name'),

  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  matched_amount: numeric('matched_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  unmatched_amount: numeric('unmatched_amount', { precision: 14, scale: 2 }).notNull().default('0'),

  match_status: paymentMatchStatusEnum('match_status').notNull().default('unidentified'),

  journal_entry_id: uuid('journal_entry_id'),            // FK to journalEntries

  matched_by: uuid('matched_by'),
  matched_at: timestamp('matched_at', { withTimezone: true }),
  notes: text('notes'),
  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('ar_payment_hospital_idx').on(table.hospital_id),
  arIdIdx: index('ar_payment_ar_id_idx').on(table.ar_ledger_id),
  statusIdx: index('ar_payment_status_idx').on(table.hospital_id, table.match_status),
  dateIdx: index('ar_payment_date_idx').on(table.payment_date),
}));
