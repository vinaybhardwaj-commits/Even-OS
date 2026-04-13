import {
  pgTable, text, timestamp, uuid, index, jsonb, boolean,
} from 'drizzle-orm/pg-core';
import { users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// MRD DOCUMENT REFERENCES — Medical Records Document Ingestion
// ============================================================

export const mrdDocumentReferences = pgTable('mrd_document_references', {
  id: uuid('id').defaultRandom().primaryKey(),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  document_type: text('document_type').notNull(), // e.g., consent, lab_report, radiology_report, referral_letter, discharge_summary, id_document, insurance_card, prescription, old_chart, external_medical_record, other
  document_class_confidence: text('document_class_confidence'), // 'high', 'medium', 'low'
  blob_url: text('blob_url'), // URL to stored file
  blob_hash: text('blob_hash'), // SHA256 for integrity
  content_type: text('content_type'), // MIME type
  file_size_bytes: text('file_size_bytes'), // stored as text for large numbers
  ocr_text: text('ocr_text'), // extracted text
  ocr_confidence: text('ocr_confidence'), // average confidence score
  ocr_processed_at: timestamp('ocr_processed_at', { withTimezone: true }),
  fhir_resource: jsonb('fhir_resource'), // FHIR DocumentReference resource
  status: text('status').notNull().default('current'), // current, superseded, deleted
  scanned_at: timestamp('scanned_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  indexed_at: timestamp('indexed_at', { withTimezone: true }),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  uploaded_by: text('uploaded_by'), // user sub
  deleted_by: text('deleted_by'), // user sub
  deletion_reason: text('deletion_reason'),
  retention_expires: timestamp('retention_expires', { withTimezone: true }),
  deletion_pending_review: boolean('deletion_pending_review').default(false),
  contains_pii: boolean('contains_pii').default(false),
  contains_phi: boolean('contains_phi').default(false),
  patient_phone: text('patient_phone'), // extracted from OCR
  patient_name: text('patient_name'), // extracted from OCR
  patient_dob: text('patient_dob'), // extracted from OCR (YYYY-MM-DD)
}, (table) => ({
  patientIdIdx: index('idx_mrd_doc_ref_patient_id').on(table.patient_id),
  encounterIdIdx: index('idx_mrd_doc_ref_encounter_id').on(table.encounter_id),
  documentTypeIdx: index('idx_mrd_doc_ref_document_type').on(table.document_type),
  statusIdx: index('idx_mrd_doc_ref_status').on(table.status),
  createdAtIdx: index('idx_mrd_doc_ref_created_at').on(table.created_at),
  deletedAtIdx: index('idx_mrd_doc_ref_deleted_at').on(table.deleted_at),
  retentionExpiresIdx: index('idx_mrd_doc_ref_retention_expires').on(table.retention_expires),
  ocrProcessedIdx: index('idx_mrd_doc_ref_ocr_processed_at').on(table.ocr_processed_at),
}));

// ============================================================
// MRD DOCUMENT CLASSIFICATION QUEUE
// ============================================================

export const mrdDocumentClassificationQueue = pgTable('mrd_document_classification_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  document_reference_id: uuid('document_reference_id').notNull().references(() => mrdDocumentReferences.id, { onDelete: 'cascade' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  classification_reason: text('classification_reason'), // e.g., 'low_confidence', 'uhid_mismatch', 'manual_review_requested'
  detected_class: text('detected_class'), // LLM-predicted document type
  detected_class_confidence: text('detected_class_confidence'), // confidence score
  secondary_class: text('secondary_class'), // alternative prediction
  secondary_class_confidence: text('secondary_class_confidence'),
  uhid_match_confidence: text('uhid_match_confidence'), // how confident the UHID match is
  matched_uhid: text('matched_uhid'), // UHID extracted from document
  alternative_matches: jsonb('alternative_matches'), // array of other potential UHIDs with scores
  status: text('status').notNull().default('pending'), // pending, approved, rejected, escalated
  reviewed_by: text('reviewed_by'), // user sub
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  reviewer_notes: text('reviewer_notes'),
  approved_class: text('approved_class'), // final approved classification
  approved_uhid: text('approved_uhid'), // final approved UHID
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentIdIdx: index('idx_mrd_class_queue_doc_id').on(table.document_reference_id),
  patientIdIdx: index('idx_mrd_class_queue_patient_id').on(table.patient_id),
  statusIdx: index('idx_mrd_class_queue_status').on(table.status),
  createdAtIdx: index('idx_mrd_class_queue_created_at').on(table.created_at),
}));

// ============================================================
// MRD OCR RESULTS
// ============================================================

export const mrdOcrResults = pgTable('mrd_ocr_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  document_reference_id: uuid('document_reference_id').notNull().references(() => mrdDocumentReferences.id, { onDelete: 'cascade' }),
  raw_ocr_text: text('raw_ocr_text'), // full OCR output
  ocr_confidence: text('ocr_confidence'), // average confidence
  detected_language: text('detected_language'), // e.g., 'en', 'hi', 'mixed'
  extracted_uhid: text('extracted_uhid'),
  extracted_patient_name: text('extracted_patient_name'),
  extracted_dob: text('extracted_dob'),
  extracted_phone: text('extracted_phone'),
  extracted_email: text('extracted_email'),
  extracted_fields: jsonb('extracted_fields'), // structured field extraction
  extraction_confidence: text('extraction_confidence'), // overall confidence for extractions
  processing_time_ms: text('processing_time_ms'), // OCR processing duration
  processed_at: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentIdIdx: index('idx_mrd_ocr_doc_id').on(table.document_reference_id),
}));

// ============================================================
// MRD DOCUMENT RETENTION RULES
// ============================================================

export const mrdDocumentRetentionRules = pgTable('mrd_document_retention_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  document_type: text('document_type').notNull().unique(), // must match document_type values in mrdDocumentReferences
  retention_days: text('retention_days'), // e.g., '3650' for 10 years
  rationale: text('rationale'), // why this retention period
  auto_delete: boolean('auto_delete').default(false),
  archive_before_delete: boolean('archive_before_delete').default(false),
  notification_days_before_deletion: text('notification_days_before_deletion').default('30'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updated_by: text('updated_by'), // user sub
}, (table) => ({
  documentTypeIdx: index('idx_mrd_retention_rules_type').on(table.document_type),
}));

// ============================================================
// MRD MEDIA OBJECTS — Blob Storage Metadata
// ============================================================

export const mrdMediaObjects = pgTable('mrd_media_objects', {
  id: uuid('id').defaultRandom().primaryKey(),
  blob_url: text('blob_url').notNull().unique(),
  blob_container: text('blob_container'), // e.g., 'documents', 'archives'
  blob_path: text('blob_path'), // path in blob storage
  filename: text('filename').notNull(),
  content_type: text('content_type'),
  file_size_bytes: text('file_size_bytes'),
  blob_hash: text('blob_hash'), // SHA256
  uploaded_by: text('uploaded_by'), // user sub
  uploaded_at: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  last_accessed_at: timestamp('last_accessed_at', { withTimezone: true }),
  access_count: text('access_count').default('0'),
  retention_policy: text('retention_policy'), // 'standard', 'archive', 'delete'
  deletion_scheduled_at: timestamp('deletion_scheduled_at', { withTimezone: true }),
  archived_at: timestamp('archived_at', { withTimezone: true }),
}, (table) => ({
  blobHashIdx: index('idx_mrd_media_blob_hash').on(table.blob_hash),
  uploadedAtIdx: index('idx_mrd_media_uploaded_at').on(table.uploaded_at),
  deletionScheduledIdx: index('idx_mrd_media_deletion_scheduled').on(table.deletion_scheduled_at),
}));

// ============================================================
// MRD DOCUMENT AUDIT LOG
// ============================================================

export const mrdDocumentAuditLog = pgTable('mrd_document_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  document_reference_id: uuid('document_reference_id').references(() => mrdDocumentReferences.id, { onDelete: 'set null' }),
  patient_id: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
  action: text('action').notNull(), // 'upload', 'classify', 'approve', 'reject', 'delete', 'access', 'export'
  action_detail: text('action_detail'),
  performed_by: text('performed_by'), // user sub
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  old_values: jsonb('old_values'), // previous state
  new_values: jsonb('new_values'), // new state
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  documentIdIdx: index('idx_mrd_audit_doc_id').on(table.document_reference_id),
  patientIdIdx: index('idx_mrd_audit_patient_id').on(table.patient_id),
  actionIdx: index('idx_mrd_audit_action').on(table.action),
  timestampIdx: index('idx_mrd_audit_timestamp').on(table.timestamp),
}));

// ============================================================
// MRD DOCUMENT EMBEDDINGS — Vector Search Prep
// ============================================================

export const mrdDocumentEmbeddings = pgTable('mrd_document_embeddings', {
  id: uuid('id').defaultRandom().primaryKey(),
  document_reference_id: uuid('document_reference_id').notNull().unique().references(() => mrdDocumentReferences.id, { onDelete: 'cascade' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  document_type: text('document_type'),
  embedding_text: text('embedding_text'), // text chunk for embedding (stored as text for now, can migrate to pgvector later)
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: index('idx_mrd_embeddings_patient_id').on(table.patient_id),
  documentIdIdx: index('idx_mrd_embeddings_doc_id').on(table.document_reference_id),
}));
