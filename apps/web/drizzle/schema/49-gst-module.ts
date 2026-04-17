import { pgTable, text, uuid, timestamp, numeric, boolean, jsonb, pgEnum, index, integer } from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────
export const gstReturnTypeEnum = pgEnum('gst_return_type', ['gstr_1', 'gstr_3b']);
export const gstReturnStatusEnum = pgEnum('gst_return_status', ['draft', 'generated', 'reviewed', 'filed', 'revised']);
export const itcStatusEnum = pgEnum('itc_status', ['available', 'claimed', 'reversed', 'ineligible']);
export const gstReconStatusEnum = pgEnum('gst_recon_status', ['matched', 'mismatch', 'pending', 'resolved']);

// ── GST Returns ────────────────────────────────────
// Saved GSTR-1 / GSTR-3B snapshots with full data as JSONB
export const gstReturns = pgTable('gst_returns', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull(),

  return_type: gstReturnTypeEnum('return_type').notNull(),
  period_month: integer('period_month').notNull(),         // 1-12
  period_year: integer('period_year').notNull(),           // 2026
  period_label: text('period_label').notNull(),            // 'April 2026'

  // GSTR-1 sections stored in data JSONB
  // { b2b: [...], b2c: [...], hsn_summary: [...], totals: {...} }
  // GSTR-3B sections stored in data JSONB
  // { outward_taxable: {...}, itc_available: {...}, net_payable: {...}, interest: 0 }
  data: jsonb('data').notNull(),

  // Summary amounts
  total_taxable_value: numeric('total_taxable_value', { precision: 16, scale: 2 }),
  total_cgst: numeric('total_cgst', { precision: 14, scale: 2 }),
  total_sgst: numeric('total_sgst', { precision: 14, scale: 2 }),
  total_igst: numeric('total_igst', { precision: 14, scale: 2 }),
  total_cess: numeric('total_cess', { precision: 14, scale: 2 }),
  total_tax: numeric('total_tax', { precision: 14, scale: 2 }),

  status: gstReturnStatusEnum('status').notNull().default('draft'),
  filed_date: text('filed_date'),
  filed_arn: text('filed_arn'),                            // Acknowledgement Reference Number

  notes: text('notes'),
  generated_by: uuid('generated_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('gst_ret_hospital_idx').on(t.hospital_id),
  typeIdx: index('gst_ret_type_idx').on(t.hospital_id, t.return_type),
  periodIdx: index('gst_ret_period_idx').on(t.period_year, t.period_month),
  statusIdx: index('gst_ret_status_idx').on(t.status),
}));

// ── ITC (Input Tax Credit) Ledger ──────────────────
// One row per vendor invoice with GST claimed as ITC
export const itcLedger = pgTable('itc_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull(),

  vendor_invoice_id: uuid('vendor_invoice_id'),            // FK to vendorInvoices
  vendor_name: text('vendor_name').notNull(),
  vendor_gstin: text('vendor_gstin'),
  invoice_number: text('invoice_number').notNull(),
  invoice_date: text('invoice_date').notNull(),

  // Tax breakup
  taxable_value: numeric('taxable_value', { precision: 14, scale: 2 }).notNull(),
  cgst: numeric('cgst', { precision: 14, scale: 2 }).notNull().default('0'),
  sgst: numeric('sgst', { precision: 14, scale: 2 }).notNull().default('0'),
  igst: numeric('igst', { precision: 14, scale: 2 }).notNull().default('0'),
  cess: numeric('cess', { precision: 14, scale: 2 }).notNull().default('0'),
  total_itc: numeric('total_itc', { precision: 14, scale: 2 }).notNull(),

  // HSN/SAC
  hsn_code: text('hsn_code'),
  gst_rate: numeric('gst_rate', { precision: 5, scale: 2 }),

  // Period
  claim_month: integer('claim_month').notNull(),
  claim_year: integer('claim_year').notNull(),

  status: itcStatusEnum('status').notNull().default('available'),
  reversal_reason: text('reversal_reason'),

  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('itc_hospital_idx').on(t.hospital_id),
  vendorIdx: index('itc_vendor_inv_idx').on(t.vendor_invoice_id),
  periodIdx: index('itc_period_idx').on(t.claim_year, t.claim_month),
  statusIdx: index('itc_status_idx').on(t.hospital_id, t.status),
  gstinIdx: index('itc_gstin_idx').on(t.vendor_gstin),
}));

// ── GST Reconciliation ─────────────────────────────
// Outward supplies vs filed return reconciliation
export const gstReconciliation = pgTable('gst_reconciliation', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull(),

  period_month: integer('period_month').notNull(),
  period_year: integer('period_year').notNull(),

  // Books vs Return comparison
  books_taxable: numeric('books_taxable', { precision: 16, scale: 2 }).notNull(),
  books_tax: numeric('books_tax', { precision: 14, scale: 2 }).notNull(),
  return_taxable: numeric('return_taxable', { precision: 16, scale: 2 }),
  return_tax: numeric('return_tax', { precision: 14, scale: 2 }),

  taxable_diff: numeric('taxable_diff', { precision: 16, scale: 2 }),
  tax_diff: numeric('tax_diff', { precision: 14, scale: 2 }),

  status: gstReconStatusEnum('status').notNull().default('pending'),
  resolution_notes: text('resolution_notes'),

  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('gst_recon_hospital_idx').on(t.hospital_id),
  periodIdx: index('gst_recon_period_idx').on(t.period_year, t.period_month),
}));
