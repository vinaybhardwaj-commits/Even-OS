import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, real,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters, locations } from './03-registration';

// ============================================================
// ENUMS — Clinical Notes & Documents (Module 04 Phase 2)
// ============================================================

export const noteTypeEnum = pgEnum('note_type', [
  'nursing_note', 'soap_note', 'operative_note', 'anaesthesia_record',
  'discharge_summary', 'death_summary', 'shift_handover', 'mlc_form', 'referral_letter',
]);

export const noteStatusEnum = pgEnum('note_status', [
  'draft', 'ready_for_review', 'signed', 'amended', 'entered_in_error',
]);

export const procedureStatusEnum = pgEnum('procedure_status', [
  'preparation', 'in_progress', 'not_done', 'on_hold', 'stopped', 'completed', 'entered_in_error',
]);

export const cosignStatusEnum = pgEnum('cosign_status', [
  'pending', 'signed', 'expired', 'cancelled',
]);

export const docStatusEnum = pgEnum('doc_status', [
  'current', 'superseded', 'entered_in_error',
]);

export const docTypeEnum = pgEnum('doc_type', [
  'discharge_summary', 'consent_form', 'operative_note', 'lab_report',
  'imaging_report', 'referral_letter', 'scanned_record', 'other',
]);

export const mlcInjuryTypeEnum = pgEnum('mlc_injury_type', [
  'burn', 'cut', 'blunt_trauma', 'gunshot', 'stab', 'poison', 'sexual_assault', 'other',
]);

export const mlcStatusEnum = pgEnum('mlc_status', [
  'draft', 'completed', 'signed', 'locked',
]);

// ============================================================
// CLINICAL IMPRESSIONS (FHIR ClinicalImpression — All Notes)
// ============================================================

export const clinicalImpressions = pgTable('clinical_impressions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  note_type: noteTypeEnum('note_type').notNull(),
  status: noteStatusEnum('status').default('draft').notNull(),

  // SOAP fields
  subjective: text('subjective'),
  objective: text('objective'),
  assessment: text('assessment'),
  plan: text('plan'),

  // Nursing fields
  shift_summary: text('shift_summary'),
  pain_assessment: text('pain_assessment'),
  wound_assessment: text('wound_assessment'),
  fall_risk_assessment: text('fall_risk_assessment'),
  skin_integrity_assessment: text('skin_integrity_assessment'),

  // Operative fields
  procedure_name: text('procedure_name'),
  surgeon_id: uuid('surgeon_id').references(() => users.id),
  co_surgeon_ids: jsonb('co_surgeon_ids'),     // UUID[]
  assistant_ids: jsonb('assistant_ids'),         // UUID[]
  anesthesia_type: varchar('anesthesia_type', { length: 50 }),
  operative_findings: text('operative_findings'),
  specimens_list: jsonb('specimens_list'),       // [{name, quantity, storage_location}]
  implants_list: jsonb('implants_list'),         // [{name, type, serial_number}]
  blood_loss_ml: integer('blood_loss_ml'),
  complications: text('complications'),
  operation_start_datetime: timestamp('operation_start_datetime'),
  operation_end_datetime: timestamp('operation_end_datetime'),
  operation_duration_minutes: integer('operation_duration_minutes'),

  // Discharge fields
  admission_details: text('admission_details'),
  diagnosis_list: jsonb('diagnosis_list'),       // [{icd10, name, type: primary|secondary}]
  procedures_performed: jsonb('procedures_performed'), // [{name, date, surgeon}]
  course_in_hospital: text('course_in_hospital'),
  condition_at_discharge: text('condition_at_discharge'),
  medications_at_discharge: jsonb('medications_at_discharge'), // [{drug, dose, frequency, duration}]
  followup_instructions: text('followup_instructions'),
  discharge_destination: varchar('discharge_destination', { length: 30 }),

  // Death summary fields
  death_datetime: timestamp('death_datetime'),
  immediate_cause_icd10: varchar('immediate_cause_icd10', { length: 20 }),
  antecedent_cause_icd10: varchar('antecedent_cause_icd10', { length: 20 }),
  underlying_cause_icd10: varchar('underlying_cause_icd10', { length: 20 }),
  postmortem_requested: boolean('postmortem_requested'),
  organ_donation_discussed: boolean('organ_donation_discussed'),
  organ_donation_decision: varchar('organ_donation_decision', { length: 30 }),

  // Free text for search
  free_text_content: text('free_text_content'),

  // Digital signature
  signed_by_user_id: uuid('signed_by_user_id').references(() => users.id),
  signature_data: jsonb('signature_data'),
  signed_at: timestamp('signed_at'),
  signature_hash: varchar('signature_hash', { length: 128 }),

  // Event sourcing
  version: integer('version').default(1).notNull(),
  previous_version_id: uuid('previous_version_id'),

  author_id: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_ci_patient').on(t.patient_id),
  hospitalIdx: index('idx_ci_hospital').on(t.hospital_id),
  encounterIdx: index('idx_ci_encounter').on(t.encounter_id),
  noteTypeIdx: index('idx_ci_note_type').on(t.note_type),
  statusIdx: index('idx_ci_status').on(t.status),
  signedByIdx: index('idx_ci_signed_by').on(t.signed_by_user_id),
  signedAtIdx: index('idx_ci_signed_at').on(t.signed_at),
}));

// ============================================================
// CO-SIGNATURE QUEUE (Pending VC signatures on notes)
// ============================================================

export const coSignatureQueue = pgTable('co_signature_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  clinical_impression_id: uuid('clinical_impression_id').notNull().references(() => clinicalImpressions.id, { onDelete: 'cascade' }),

  note_type: noteTypeEnum('cosign_note_type').notNull(),
  author_id: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  author_name: text('author_name').notNull(),
  required_signer_id: uuid('required_signer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  required_signer_name: text('required_signer_name').notNull(),

  status: cosignStatusEnum('cosign_status').default('pending').notNull(),

  created_at: timestamp('created_at').defaultNow().notNull(),
  signed_at: timestamp('signed_at'),
  first_escalation_at: timestamp('first_escalation_at'),
  last_escalation_at: timestamp('last_escalation_at'),
  escalation_count: integer('escalation_count').default(0).notNull(),
}, (t) => ({
  hospitalIdx: index('idx_cosign_hospital').on(t.hospital_id),
  patientIdx: index('idx_cosign_patient').on(t.patient_id),
  signerIdx: index('idx_cosign_signer').on(t.required_signer_id),
  statusIdx: index('idx_cosign_status').on(t.status),
  createdIdx: index('idx_cosign_created').on(t.created_at),
}));

// ============================================================
// PROCEDURES (FHIR Procedure — Surgical procedures)
// ============================================================

export const procedures = pgTable('procedures', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  procedure_code: varchar('procedure_code', { length: 20 }),   // ICD-10-PCS
  procedure_name: text('procedure_name').notNull(),
  status: procedureStatusEnum('procedure_status').default('preparation').notNull(),

  performed_datetime: timestamp('performed_datetime'),
  performer_id: uuid('performer_id').references(() => users.id),
  performer_role: varchar('performer_role', { length: 50 }),

  clinical_impression_id: uuid('clinical_impression_id').references(() => clinicalImpressions.id),
  location_id: uuid('location_id'),
  reason_code: varchar('reason_code', { length: 20 }),
  used_resource_ids: jsonb('used_resource_ids'),   // FK to implants/resources

  // Event sourcing
  version: integer('version').default(1).notNull(),
  previous_version_id: uuid('previous_version_id'),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_proc_patient').on(t.patient_id),
  hospitalIdx: index('idx_proc_hospital').on(t.hospital_id),
  encounterIdx: index('idx_proc_encounter').on(t.encounter_id),
  statusIdx: index('idx_proc_status').on(t.status),
  performerIdx: index('idx_proc_performer').on(t.performer_id),
}));

// ============================================================
// DOCUMENT REFERENCES (FHIR DocumentReference — PDFs, scans)
// ============================================================

export const documentReferences = pgTable('document_references', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  document_type: docTypeEnum('document_type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: docStatusEnum('document_status').default('current').notNull(),

  author_id: uuid('author_id').references(() => users.id),
  clinical_impression_id: uuid('clinical_impression_id').references(() => clinicalImpressions.id),

  // Attachment
  attachment_url: text('attachment_url'),
  attachment_filename: text('attachment_filename'),
  attachment_mimetype: varchar('attachment_mimetype', { length: 100 }),
  attachment_hash: varchar('attachment_hash', { length: 128 }),
  attachment_size_bytes: integer('attachment_size_bytes'),

  // Signature
  signature_data: jsonb('signature_data'),
  signature_hash: varchar('signature_hash', { length: 128 }),
  signed_at: timestamp('signed_at'),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_docref_patient').on(t.patient_id),
  hospitalIdx: index('idx_docref_hospital').on(t.hospital_id),
  encounterIdx: index('idx_docref_encounter').on(t.encounter_id),
  typeIdx: index('idx_docref_type').on(t.document_type),
  statusIdx: index('idx_docref_status').on(t.status),
}));

// ============================================================
// MLC FORMS (Medico-Legal Case — immutable after signature)
// ============================================================

export const mlcForms = pgTable('mlc_forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  // Age estimation
  age_estimation: varchar('age_estimation', { length: 50 }),
  estimated_age_years: integer('estimated_age_years'),

  // Injury details
  injury_description: text('injury_description').notNull(),
  injury_type: mlcInjuryTypeEnum('injury_type').notNull(),
  injury_datetime: timestamp('injury_datetime'),
  injury_location_on_body: text('injury_location_on_body'),

  // Documentation
  wound_diagrams_urls: jsonb('wound_diagrams_urls'),   // string[]
  wound_photos_urls: jsonb('wound_photos_urls'),       // string[]

  // Specimens
  specimens_collected: jsonb('specimens_collected'),   // [{name, quantity, storage_location, collected_datetime}]

  // Police notification
  police_notified: boolean('police_notified').default(false),
  police_officer_name: text('police_officer_name'),
  police_officer_badge: varchar('police_officer_badge', { length: 50 }),
  police_station: text('police_station'),
  case_number: varchar('case_number', { length: 50 }),
  notification_datetime: timestamp('notification_datetime'),

  // Status & Signature
  status: mlcStatusEnum('mlc_status').default('draft').notNull(),
  signed_by_user_id: uuid('signed_by_user_id').references(() => users.id),
  signed_at: timestamp('signed_at'),
  signature_hash: varchar('signature_hash', { length: 128 }),
  locked_at: timestamp('locked_at'),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_mlc_patient').on(t.patient_id),
  hospitalIdx: index('idx_mlc_hospital').on(t.hospital_id),
  statusIdx: index('idx_mlc_status').on(t.status),
}));
