import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex, date,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { chartOfAccounts } from './44-chart-of-accounts';
import { journalEntries } from './45-journal-entries';

// ============================================================
// ENUMS — Accounts Payable (Finance Module C.3)
// ============================================================

export const vendorContractTypeEnum = pgEnum('vendor_contract_type', [
  'supply', 'service', 'lease', 'amc', 'consulting',
  'outsourced_lab', 'catering', 'housekeeping', 'laundry', 'other',
]);

export const vendorContractStatusEnum = pgEnum('vendor_contract_status', [
  'draft', 'active', 'expiring_soon', 'expired', 'terminated',
]);

export const vendorPaymentTermsEnum = pgEnum('vendor_payment_terms', [
  'net_15', 'net_30', 'net_45', 'net_60', 'advance', 'milestone',
]);

export const vendorPaymentFrequencyEnum = pgEnum('vendor_payment_frequency', [
  'one_time', 'monthly', 'quarterly', 'annual', 'per_invoice',
]);

export const vendorInvoiceStatusEnum = pgEnum('vendor_invoice_status', [
  'received', 'verified', 'approved', 'scheduled', 'paid', 'disputed', 'cancelled',
]);

// ============================================================
// VENDOR_CONTRACTS — Vendor/supplier contract management
// ============================================================

export const vendorContracts = pgTable('vendor_contracts', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  vendor_name: text('vendor_name').notNull(),
  vendor_code: varchar('vendor_code', { length: 30 }),
  vendor_gstin: varchar('vendor_gstin', { length: 20 }),
  vendor_pan: varchar('vendor_pan', { length: 15 }),
  vendor_contact: text('vendor_contact'),
  vendor_email: text('vendor_email'),
  vendor_phone: text('vendor_phone'),
  vendor_address: text('vendor_address'),

  contract_number: varchar('contract_number', { length: 40 }).notNull(),
  contract_type: text('contract_type').notNull(), // supply, service, amc, etc.
  description: text('description'),

  start_date: date('start_date').notNull(),
  end_date: date('end_date'),
  auto_renewal: boolean('auto_renewal').default(false),
  renewal_notice_days: integer('renewal_notice_days').default(30),

  payment_terms: text('payment_terms').notNull(), // net_15, net_30, etc.
  payment_frequency: text('payment_frequency'), // monthly, quarterly, etc.

  contract_value: numeric('contract_value', { precision: 15, scale: 2 }),
  monthly_value: numeric('monthly_value', { precision: 15, scale: 2 }),

  gst_percent: numeric('gst_percent', { precision: 5, scale: 2 }),

  tds_applicable: boolean('tds_applicable').default(false),
  tds_percent: numeric('tds_percent', { precision: 5, scale: 2 }),
  tds_section: varchar('tds_section', { length: 10 }), // 194C, 194J, etc.

  default_expense_account_id: uuid('default_expense_account_id').references(() => chartOfAccounts.id, { onDelete: 'restrict' }),

  status: text('status').notNull().default('active'),
  document_url: text('document_url'),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_vc_hospital').on(t.hospital_id),
  statusIdx: index('idx_vc_status').on(t.status),
  typeIdx: index('idx_vc_type').on(t.contract_type),
  endDateIdx: index('idx_vc_end_date').on(t.end_date),
  contractNumUnique: uniqueIndex('idx_vc_number_unique').on(t.hospital_id, t.contract_number),
}));

// ============================================================
// VENDOR_INVOICES — Invoice lifecycle with approval workflow
// ============================================================

export const vendorInvoices = pgTable('vendor_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  contract_id: uuid('contract_id').references(() => vendorContracts.id, { onDelete: 'restrict' }),
  vendor_name: text('vendor_name').notNull(), // Denormalized for quick display

  invoice_number: varchar('invoice_number', { length: 50 }).notNull(),
  our_reference: varchar('our_reference', { length: 50 }), // PO or GRN number

  invoice_date: date('invoice_date').notNull(),
  due_date: date('due_date').notNull(),

  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  gst_amount: numeric('gst_amount', { precision: 12, scale: 2 }).default('0'),
  tds_amount: numeric('tds_amount', { precision: 12, scale: 2 }).default('0'),
  net_payable: numeric('net_payable', { precision: 15, scale: 2 }).notNull(),

  status: text('status').notNull().default('received'),

  payment_scheduled_date: date('payment_scheduled_date'),
  paid_at: timestamp('paid_at'),
  payment_method: text('payment_method'), // neft, rtgs, cheque, upi
  payment_reference: text('payment_reference'),

  verified_by: uuid('verified_by'),
  verified_at: timestamp('verified_at'),
  approved_by: uuid('approved_by'),
  approved_at: timestamp('approved_at'),

  expense_account_id: uuid('expense_account_id').references(() => chartOfAccounts.id, { onDelete: 'restrict' }),
  journal_entry_id: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),

  document_url: text('document_url'),
  notes: text('notes'),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  hospitalStatusIdx: index('idx_vi_status').on(t.hospital_id, t.status, t.due_date),
  contractIdx: index('idx_vi_contract').on(t.contract_id),
  dueDateIdx: index('idx_vi_due_date').on(t.due_date),
  invoiceDateIdx: index('idx_vi_invoice_date').on(t.invoice_date),
}));
