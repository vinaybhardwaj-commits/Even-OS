import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients } from './03-registration';
import { labOrders } from './13-lab-radiology';

// ============================================================
// ENUMS — Lab Reports & Outsourced Labs (Module 8 — L.4)
// ============================================================

export const labReportStatusEnum = pgEnum('lab_report_status', [
  'draft', 'generated', 'verified', 'amended', 'cancelled',
]);

export const outsourcedDocStatusEnum = pgEnum('outsourced_doc_status', [
  'uploaded', 'pending_entry', 'results_entered', 'verified', 'rejected',
]);

// ============================================================
// LAB REPORTS — Generated diagnostic reports from verified results
// ============================================================

export const labReports = pgTable('lab_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  order_id: uuid('lrp_order_id').notNull().references(() => labOrders.id, { onDelete: 'cascade' }),
  patient_id: uuid('lrp_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  report_number: varchar('lrp_report_number', { length: 50 }).notNull(),
  status: labReportStatusEnum('lrp_status').default('draft').notNull(),

  // Report content
  panel_name: text('lrp_panel_name'),
  results_snapshot: jsonb('lrp_results_snapshot'),  // Array of { test_code, test_name, value, unit, ref_range, flag, is_critical }
  clinical_notes: text('lrp_clinical_notes'),
  interpretation: text('lrp_interpretation'),  // Pathologist/lab director interpretation

  // Critical flags summary
  has_critical: boolean('lrp_has_critical').default(false),
  critical_count: integer('lrp_critical_count').default(0),
  abnormal_count: integer('lrp_abnormal_count').default(0),

  // PDF generation
  pdf_generated: boolean('lrp_pdf_generated').default(false),
  pdf_url: text('lrp_pdf_url'),  // Storage path for generated PDF
  pdf_generated_at: timestamp('lrp_pdf_generated_at'),

  // Signatures
  generated_by: uuid('lrp_generated_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  generated_at: timestamp('lrp_generated_at').defaultNow().notNull(),
  verified_by: uuid('lrp_verified_by').references(() => users.id, { onDelete: 'set null' }),
  verified_at: timestamp('lrp_verified_at'),

  // Amendments
  amendment_reason: text('lrp_amendment_reason'),
  amended_by: uuid('lrp_amended_by').references(() => users.id, { onDelete: 'set null' }),
  amended_at: timestamp('lrp_amended_at'),
  previous_version_id: uuid('lrp_previous_version_id'),  // Self-reference for amendment chain

  created_at: timestamp('lrp_created_at').defaultNow().notNull(),
  updated_at: timestamp('lrp_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_lrp_hospital').on(t.hospital_id),
  orderIdx: index('idx_lrp_order').on(t.order_id),
  patientIdx: index('idx_lrp_patient').on(t.patient_id),
  statusIdx: index('idx_lrp_status').on(t.status),
  reportNumberIdx: index('idx_lrp_report_number').on(t.hospital_id, t.report_number),
  criticalIdx: index('idx_lrp_critical').on(t.has_critical),
}));

// ============================================================
// OUTSOURCED LAB DOCUMENTS — External lab PDF uploads
// ============================================================

export const outsourcedLabDocs = pgTable('outsourced_lab_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('old_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  order_id: uuid('old_order_id').references(() => labOrders.id, { onDelete: 'set null' }),

  // External lab info
  external_lab_name: text('old_lab_name').notNull(),
  external_report_number: varchar('old_ext_report_number', { length: 100 }),
  external_report_date: timestamp('old_ext_report_date'),

  // Document
  file_name: text('old_file_name').notNull(),
  file_url: text('old_file_url').notNull(),  // Storage path
  file_size_bytes: integer('old_file_size'),
  mime_type: varchar('old_mime_type', { length: 100 }).default('application/pdf'),

  // Status
  status: outsourcedDocStatusEnum('old_status').default('uploaded').notNull(),

  // Manual result entry (from PDF)
  extracted_results: jsonb('old_extracted_results'),  // Array of { test_name, value, unit, ref_range, flag }
  entry_notes: text('old_entry_notes'),

  // Workflow
  uploaded_by: uuid('old_uploaded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  uploaded_at: timestamp('old_uploaded_at').defaultNow().notNull(),
  entered_by: uuid('old_entered_by').references(() => users.id, { onDelete: 'set null' }),
  entered_at: timestamp('old_entered_at'),
  verified_by: uuid('old_verified_by').references(() => users.id, { onDelete: 'set null' }),
  verified_at: timestamp('old_verified_at'),
  rejection_reason: text('old_rejection_reason'),

  created_at: timestamp('old_created_at').defaultNow().notNull(),
  updated_at: timestamp('old_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_old_hospital').on(t.hospital_id),
  patientIdx: index('idx_old_patient').on(t.patient_id),
  orderIdx: index('idx_old_order').on(t.order_id),
  statusIdx: index('idx_old_status').on(t.status),
  labNameIdx: index('idx_old_lab_name').on(t.external_lab_name),
}));
