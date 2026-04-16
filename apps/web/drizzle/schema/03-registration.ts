import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  uniqueIndex, index, uuid, pgEnum, numeric,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { hospitals, users } from './00-foundations';

// ============================================================
// ENUMS — Registration & Patient Management
// ============================================================

export const genderEnum = pgEnum('gender', ['male', 'female', 'other', 'unknown']);

export const bloodGroupEnum = pgEnum('blood_group', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown']);

export const patientCategoryEnum = pgEnum('patient_category', ['even_capitated', 'insured', 'cash']);

export const patientStatusEnum = pgEnum('patient_status', ['active', 'inactive', 'merged', 'archived']);

export const encounterClassEnum = pgEnum('encounter_class', ['IMP', 'AMB', 'ED', 'HH', 'OBSENC']);

export const encounterStatusEnum = pgEnum('encounter_status', ['planned', 'in-progress', 'finished', 'cancelled']);

export const admissionTypeEnum = pgEnum('admission_type', ['elective', 'emergency', 'day_care']);

export const referralSourceEnum = pgEnum('referral_source', ['self', 'doctor', 'lsq_lead', 'walk_in', 'b2b_referral']);

export const locationType = pgEnum('location_type', ['hospital', 'floor', 'ward', 'room', 'bed']);

export const locationStatusEnum = pgEnum('location_status', ['active', 'inactive']);

export const bedStatusEnum = pgEnum('bed_status', ['available', 'occupied', 'reserved', 'blocked', 'housekeeping', 'terminal_cleaning', 'maintenance']);

export const bedReleaseReasonEnum = pgEnum('bed_release_reason', ['discharge', 'transfer', 'death', 'lama']);

export const locationWardTypeEnum = pgEnum('ward_type', ['general', 'icu', 'nicu', 'pacu', 'dialysis', 'day_care', 'maternity', 'step_down']);

export const roomTypeEnum = pgEnum('room_type', ['private', 'semi_private', 'suite', 'icu_room', 'nicu_room', 'pacu_bay', 'dialysis_station', 'general']);

export const roomTagEnum = pgEnum('room_tag', ['none', 'day_care', 'maternity', 'isolation']);

export const coverageTypeEnum = pgEnum('coverage_type', ['capitated', 'insured', 'self_pay']);

export const planTypeEnum = pgEnum('plan_type', ['cashless', 'reimbursement', 'hybrid']);

export const relationshipEnum = pgEnum('relationship_type', ['emergency_contact', 'next_of_kin', 'parent', 'spouse', 'child', 'sibling', 'other']);

export const documentTypeEnum = pgEnum('document_type', ['aadhaar', 'pan', 'voter_id', 'driving_license', 'passport']);

export const mpiLinkMethodEnum = pgEnum('mpi_link_method', ['exact_phone', 'fuzzy_name_dob', 'manual_merge', 'abdm_link', 'initial_registration']);

export const mpiLinkStatusEnum = pgEnum('mpi_link_status', ['active', 'archived', 'rejected']);

export const mpiAuditOperationEnum = pgEnum('mpi_audit_operation', ['CREATE', 'MERGE', 'REJECT', 'ARCHIVE']);

export const patientAuditOperationEnum = pgEnum('patient_audit_operation', ['CREATE', 'UPDATE', 'MERGE', 'DELETE']);

export const wristbandStatusEnum = pgEnum('wristband_status', ['queued', 'printing', 'printed', 'failed']);

export const dedupStatusEnum = pgEnum('dedup_status', ['pending', 'merged', 'dismissed']);
export const dedupMatchMethodEnum = pgEnum('dedup_match_method', ['exact_phone', 'fuzzy_name_dob', 'exact_name_phone']);

export const lsqSyncStatusEnum = pgEnum('lsq_sync_status', ['success', 'partial', 'failed']);

export const checklistItemStatusEnum = pgEnum('checklist_item_status', ['pending', 'done', 'skipped', 'not_applicable']);
export const preAuthStatusEnum = pgEnum('pre_auth_status', ['not_required', 'pending', 'obtained', 'denied', 'override']);
export const dischargeMilestoneEnum = pgEnum('discharge_milestone', [
  'clinical_clearance', 'financial_settlement', 'discharge_summary',
  'medication_reconciliation', 'patient_education', 'documents_ready',
  'bed_cleaned', 'followup_scheduled',
]);

export const lsqLeadStatusEnum = pgEnum('lsq_lead_status', ['synced', 'processed', 'merged']);

// ============================================================
// PATIENTS (Master patient registry)
// ============================================================

export const patients = pgTable('patients', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  uhid: varchar('uhid', { length: 20 }).notNull(),
  fhir_resource: jsonb('fhir_resource'), // Full FHIR Patient resource (populated later)

  // Denormalized name fields for search + display
  name_given: text('name_given').notNull(),
  name_family: text('name_family').notNull(),
  name_full: text('name_full').notNull(),
  name_unaccent: text('name_unaccent'), // Accent-removed for fuzzy matching

  // Contact — plaintext for v1, encrypt in Phase 2
  phone: text('phone').notNull(),
  email: text('email'),

  // Address — denormalized for v1
  address_street: text('address_street'),
  address_city: text('address_city'),
  address_state: text('address_state'),
  address_pincode: text('address_pincode'),

  // Demographics
  dob: timestamp('dob', { withTimezone: true }),
  gender: genderEnum('gender'),
  blood_group: bloodGroupEnum('blood_group').default('unknown'),

  // Classification
  patient_category: patientCategoryEnum('patient_category').default('cash'),
  status: patientStatusEnum('status').default('active'),
  merged_to_patient_id: uuid('merged_to_patient_id'), // Self-ref to patients.id (for merged patients)
  source_type: referralSourceEnum('source_type'),
  lsq_lead_id: text('lsq_lead_id'),

  // Journey tracking (denormalized for fast queries)
  journey_current_phase: text('journey_current_phase'), // Current journey phase (nullable = no active journey)
  journey_current_step: text('journey_current_step'),   // Current step number (e.g., '2.5')

  // Audit
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  created_by_user_id: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updated_by_user_id: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  hospitalIdIdx: index('idx_patients_hospital_id').on(table.hospital_id),
  uhidIdx: uniqueIndex('idx_patients_uhid').on(table.uhid, table.hospital_id),
  phoneIdx: index('idx_patients_phone').on(table.phone),
  statusIdx: index('idx_patients_status').on(table.status),
  createdAtIdx: index('idx_patients_created_at_desc').on(table.created_at),
  lsqLeadIdx: index('idx_patients_lsq_lead_id').on(table.lsq_lead_id),
}));

// ============================================================
// PATIENTS AUDIT (Change log for patient records)
// ============================================================

export const patientsAudit = pgTable('patients_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  operation: patientAuditOperationEnum('operation').notNull(),
  field_name: text('field_name'),
  old_value: text('old_value'),
  new_value: text('new_value'),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  changed_at: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: index('idx_patients_audit_patient_id').on(table.patient_id),
  hospitalIdIdx: index('idx_patients_audit_hospital_id').on(table.hospital_id),
  changedAtIdx: index('idx_patients_audit_changed_at').on(table.changed_at),
}));

// ============================================================
// PATIENT DOCUMENTS (Identity documents: Aadhaar, PAN, etc.)
// ============================================================

export const patientDocuments = pgTable('patient_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  document_type: documentTypeEnum('document_type').notNull(),
  value_encrypted: text('value_encrypted').notNull(), // Encrypted document number
  value_hash: text('value_hash').notNull(), // Hash for quick matching
  verified: boolean('verified').notNull().default(false),
  uploaded_at: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  uploaded_by_user_id: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  patientIdIdx: index('idx_patient_documents_patient_id').on(table.patient_id),
  hashIdx: index('idx_patient_documents_value_hash').on(table.value_hash),
  typeIdx: index('idx_patient_documents_document_type').on(table.document_type),
  hospitalIdIdx: index('idx_patient_documents_hospital_id').on(table.hospital_id),
}));

// ============================================================
// COVERAGES (Insurance/payer information)
// ============================================================

export const coverages = pgTable('coverages', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  coverage_type: coverageTypeEnum('coverage_type').notNull(),
  policy_number: text('policy_number'),
  insurer_name: text('insurer_name'),
  tpa_name: text('tpa_name'),
  plan_type: planTypeEnum('plan_type'),
  coverage_limit_amount: numeric('coverage_limit_amount', { precision: 14, scale: 2 }),
  validity_start: timestamp('validity_start', { withTimezone: true }),
  validity_end: timestamp('validity_end', { withTimezone: true }),
  subscriber_type: text('subscriber_type'), // e.g., "self", "family_head"
  status: text('status').notNull().default('active'), // active, inactive, expired
  fhir_resource: jsonb('fhir_resource'), // Full FHIR Coverage resource
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  created_by_user_id: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  patientIdIdx: index('idx_coverages_patient_id').on(table.patient_id),
  hospitalIdIdx: index('idx_coverages_hospital_id').on(table.hospital_id),
  statusIdx: index('idx_coverages_status').on(table.status),
  policyIdIdx: index('idx_coverages_policy_number').on(table.policy_number),
}));

// ============================================================
// RELATED PERSONS (Emergency contacts, next of kin, caregivers)
// ============================================================

export const relatedPersons = pgTable('related_persons', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  relationship: relationshipEnum('relationship').notNull(),
  name_full: text('name_full').notNull(),
  telecom_phone: text('telecom_phone'),
  address: text('address'),
  fhir_resource: jsonb('fhir_resource'), // Full FHIR RelatedPerson resource
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  created_by_user_id: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  patientIdIdx: index('idx_related_persons_patient_id').on(table.patient_id),
  hospitalIdIdx: index('idx_related_persons_hospital_id').on(table.hospital_id),
}));

// ============================================================
// LOCATIONS (Hospital structure: floors, wards, rooms, beds)
// ============================================================

export const locations = pgTable('locations', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  location_type: locationType('location_type').notNull(),
  parent_location_id: uuid('parent_location_id'), // Self-ref to locations.id for hierarchical nesting
  code: text('code').notNull(), // e.g., 'ICU', '1-04', '1-01A'
  name: text('name').notNull(),
  capacity: integer('capacity'), // For wards/rooms (semi-private = 2, private/suite = 1)
  status: locationStatusEnum('status').default('active'),
  bed_status: bedStatusEnum('bed_status').default('available'), // Denormalized for beds; null for non-bed locations
  // BM.1 additions — Ward/Room/Bed management
  ward_type: locationWardTypeEnum('ward_type'), // For ward-type locations: general, icu, nicu, pacu, dialysis
  room_type: roomTypeEnum('room_type'), // For room-type locations: private, semi_private, suite, icu_room, etc.
  floor_number: integer('floor_number'), // Physical floor number (1-4 at EHRC)
  room_tag: roomTagEnum('room_tag').default('none'), // Temporary tag: day_care, maternity, isolation
  infrastructure_flags: jsonb('infrastructure_flags'), // e.g., { ventilator: true, cardiac_monitor: true }
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdIdx: index('idx_locations_hospital_id').on(table.hospital_id),
  typeIdx: index('idx_locations_location_type').on(table.location_type),
  parentIdx: index('idx_locations_parent_location_id').on(table.parent_location_id),
  codeIdx: uniqueIndex('idx_locations_code_hospital').on(table.code, table.hospital_id),
}));

// ============================================================
// BED STRUCTURE AUDIT (Tracks structural changes: room added, converted, decommissioned)
// ============================================================

export const bedStructureAudit = pgTable('bed_structure_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  action: text('action').notNull(), // e.g., 'room_added', 'room_converted', 'ward_created', 'bed_decommissioned'
  entity_type: text('entity_type').notNull(), // 'ward', 'room', 'bed'
  entity_id: uuid('entity_id').notNull(),
  old_values: jsonb('old_values'),
  new_values: jsonb('new_values'),
  performed_by_user_id: uuid('performed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  performed_at: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason'),
}, (table) => ({
  hospitalIdIdx: index('idx_bed_struct_audit_hospital').on(table.hospital_id),
  entityIdx: index('idx_bed_struct_audit_entity').on(table.entity_type, table.entity_id),
  performedAtIdx: index('idx_bed_struct_audit_at').on(table.performed_at),
}));

// ============================================================
// ENCOUNTERS (Hospital visits/admissions)
// ============================================================

export const encounters = pgTable('encounters', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  fhir_resource: jsonb('fhir_resource'), // Full FHIR Encounter resource
  encounter_class: encounterClassEnum('encounter_class').notNull(),
  status: encounterStatusEnum('status').default('planned'),
  admission_type: admissionTypeEnum('admission_type'),
  referral_source: referralSourceEnum('referral_source'),
  preliminary_diagnosis_icd10: text('preliminary_diagnosis_icd10'),
  chief_complaint: text('chief_complaint'),
  clinical_notes: text('clinical_notes'),
  diet_type: text('diet_type'), // e.g., 'regular', 'liquid', 'npk'
  expected_los_days: integer('expected_los_days'),
  current_location_id: uuid('current_location_id').references(() => locations.id, { onDelete: 'set null' }),
  attending_practitioner_id: uuid('attending_practitioner_id').references(() => users.id, { onDelete: 'set null' }),
  pre_auth_status: preAuthStatusEnum('pre_auth_status').default('not_required'),
  pre_auth_number: text('pre_auth_number'),
  pre_auth_override_reason: text('pre_auth_override_reason'),
  pre_auth_override_by: uuid('pre_auth_override_by').references(() => users.id, { onDelete: 'set null' }),
  journey_type: text('journey_type'),  // elective_surgical, emergency, day_care, medical
  admission_at: timestamp('admission_at', { withTimezone: true }),
  discharge_at: timestamp('discharge_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  created_by_user_id: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  hospitalIdIdx: index('idx_encounters_hospital_id').on(table.hospital_id),
  patientIdIdx: index('idx_encounters_patient_id').on(table.patient_id),
  statusIdx: index('idx_encounters_status').on(table.status),
  admissionAtIdx: index('idx_encounters_admission_at').on(table.admission_at),
}));

// ============================================================
// BED ASSIGNMENTS (Current bed allocation for encounters)
// ============================================================

export const bedAssignments = pgTable('bed_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  location_id: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }), // The bed
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'cascade' }),
  assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  assigned_by_user_id: uuid('assigned_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  released_at: timestamp('released_at', { withTimezone: true }),
  reason_released: bedReleaseReasonEnum('reason_released'),
  transfer_to_location_id: uuid('transfer_to_location_id').references(() => locations.id, { onDelete: 'set null' }),
}, (table) => ({
  hospitalIdIdx: index('idx_bed_assignments_hospital_id').on(table.hospital_id),
  locationIdIdx: index('idx_bed_assignments_location_id').on(table.location_id),
  encounterIdIdx: index('idx_bed_assignments_encounter_id').on(table.encounter_id),
  releasedAtIdx: index('idx_bed_assignments_released_at').on(table.released_at),
}));

// ============================================================
// BED STATUS HISTORY (Audit trail of bed availability changes)
// ============================================================

export const bedStatusHistory = pgTable('bed_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  location_id: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  status: bedStatusEnum('status').notNull(),
  reason: text('reason'),
  changed_at: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  changed_by_user_id: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  locationIdIdx: index('idx_bed_status_history_location_id').on(table.location_id),
  hospitalIdIdx: index('idx_bed_status_history_hospital_id').on(table.hospital_id),
  changedAtIdx: index('idx_bed_status_history_changed_at').on(table.changed_at),
}));

// ============================================================
// MPI RECORDS (Master Patient Index records, ABDM-ready)
// ============================================================

export const mpiRecords = pgTable('mpi_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  external_id: text('external_id'), // ABHA ID if linked to ABDM
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  externalIdIdx: uniqueIndex('idx_mpi_records_external_id').on(table.external_id),
}));

// ============================================================
// MPI LINKS (Junction between MPI record and patient in a hospital)
// ============================================================

export const mpiLinks = pgTable('mpi_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  mpi_record_id: uuid('mpi_record_id').notNull().references(() => mpiRecords.id, { onDelete: 'cascade' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  uhid: text('uhid').notNull(), // UHID within this hospital
  linked_at: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  linked_by_user_id: uuid('linked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  confidence: numeric('confidence', { precision: 3, scale: 2 }), // 0.0-1.0 match confidence
  method: mpiLinkMethodEnum('method').notNull(),
  status: mpiLinkStatusEnum('status').default('active'),
}, (table) => ({
  hospitalIdIdx: index('idx_mpi_links_hospital_id').on(table.hospital_id),
  mpiRecordIdIdx: index('idx_mpi_links_mpi_record_id').on(table.mpi_record_id),
  patientIdIdx: index('idx_mpi_links_patient_id').on(table.patient_id),
  uhidIdx: index('idx_mpi_links_uhid').on(table.uhid),
  statusIdx: index('idx_mpi_links_status').on(table.status),
}));

// ============================================================
// MPI LINKS AUDIT (Change log for MPI linking decisions)
// ============================================================

export const mpiLinksAudit = pgTable('mpi_links_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  mpi_link_id: uuid('mpi_link_id').notNull().references(() => mpiLinks.id, { onDelete: 'cascade' }),
  operation: mpiAuditOperationEnum('operation').notNull(),
  old_confidence: numeric('old_confidence', { precision: 3, scale: 2 }),
  new_confidence: numeric('new_confidence', { precision: 3, scale: 2 }),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  changed_at: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  reason: text('reason'),
}, (table) => ({
  mpiLinkIdIdx: index('idx_mpi_links_audit_mpi_link_id').on(table.mpi_link_id),
  changedAtIdx: index('idx_mpi_links_audit_changed_at').on(table.changed_at),
}));

// ============================================================
// POTENTIAL DUPLICATES (Dedup queue for admin review)
// ============================================================

export const potentialDuplicates = pgTable('potential_duplicates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_a_id: uuid('patient_a_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  patient_b_id: uuid('patient_b_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  match_method: dedupMatchMethodEnum('match_method').notNull(),
  match_score: numeric('match_score', { precision: 3, scale: 2 }).notNull(), // 0.00 – 1.00
  status: dedupStatusEnum('status').default('pending'),
  resolved_by_user_id: uuid('resolved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  resolution_note: text('resolution_note'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdIdx: index('idx_potential_duplicates_hospital_id').on(table.hospital_id),
  statusIdx: index('idx_potential_duplicates_status').on(table.status),
  patientAIdx: index('idx_potential_duplicates_patient_a').on(table.patient_a_id),
  patientBIdx: index('idx_potential_duplicates_patient_b').on(table.patient_b_id),
}));

// ============================================================
// UHID SEQUENCES (Per-site UHID generation state)
// ============================================================

export const uhidSequences = pgTable('uhid_sequences', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  site_code: varchar('site_code', { length: 5 }).notNull(), // e.g., 'INR', 'RCR'
  next_value: integer('next_value').notNull().default(1),
}, (table) => ({
  siteCodeIdx: uniqueIndex('idx_uhid_sequences_hospital_site').on(table.hospital_id, table.site_code),
}));

// ============================================================
// WRISTBAND JOBS (Print queue for patient wristbands)
// ============================================================

export const wristbandJobs = pgTable('wristband_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'cascade' }),
  format: text('format').notNull().default('wristband_roll'),
  printer_id: text('printer_id'),
  status: wristbandStatusEnum('status').default('queued'),
  pdf_url: text('pdf_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  printed_at: timestamp('printed_at', { withTimezone: true }),
}, (table) => ({
  hospitalIdIdx: index('idx_wristband_jobs_hospital_id').on(table.hospital_id),
  encounterIdIdx: index('idx_wristband_jobs_encounter_id').on(table.encounter_id),
  statusIdx: index('idx_wristband_jobs_status').on(table.status),
  createdAtIdx: index('idx_wristband_jobs_created_at').on(table.created_at),
}));

// ============================================================
// LSQ SYNC LOG (Log of LSQ lead syncs)
// ============================================================

export const lsqSyncLog = pgTable('lsq_sync_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  sync_at: timestamp('sync_at', { withTimezone: true }).notNull().defaultNow(),
  lead_count_total: integer('lead_count_total').default(0),
  lead_count_new: integer('lead_count_new').default(0),
  lead_count_updated: integer('lead_count_updated').default(0),
  lead_count_skipped: integer('lead_count_skipped').default(0),
  lead_count_error: integer('lead_count_error').default(0),
  status: lsqSyncStatusEnum('status').notNull(),
  error_message: text('error_message'),
}, (table) => ({
  hospitalIdIdx: index('idx_lsq_sync_log_hospital_id').on(table.hospital_id),
  syncAtIdx: index('idx_lsq_sync_log_sync_at').on(table.sync_at),
}));

// ============================================================
// LSQ API LOG (Detailed API call tracing)
// ============================================================

export const lsqApiLog = pgTable('lsq_api_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  api_endpoint: text('api_endpoint').notNull(),
  request_method: text('request_method').notNull(),
  response_status: integer('response_status'),
  latency_ms: integer('latency_ms'),
  error: text('error'),
  logged_at: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdIdx: index('idx_lsq_api_log_hospital_id').on(table.hospital_id),
  endpointIdx: index('idx_lsq_api_log_endpoint').on(table.api_endpoint),
  loggedAtIdx: index('idx_lsq_api_log_logged_at').on(table.logged_at),
}));

// ============================================================
// LSQ SYNC STATE (Current state of LSQ lead -> patient mapping)
// ============================================================

export const lsqSyncState = pgTable('lsq_sync_state', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  lsq_lead_id: text('lsq_lead_id').notNull(),
  patient_id: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
  synced_at: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  status: lsqLeadStatusEnum('status').default('synced'),
}, (table) => ({
  lsqLeadIdIdx: uniqueIndex('idx_lsq_sync_state_lead').on(table.hospital_id, table.lsq_lead_id),
  hospitalIdIdx: index('idx_lsq_sync_state_hospital_id').on(table.hospital_id),
  statusIdx: index('idx_lsq_sync_state_status').on(table.status),
}));

// ============================================================
// TRANSFER HISTORY (Audit trail of patient movements)
// ============================================================

export const transferHistory = pgTable('transfer_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'cascade' }),
  from_location_id: uuid('from_location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  to_location_id: uuid('to_location_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  transfer_type: text('transfer_type').notNull(), // bed, ward, floor, hospital
  reason: text('reason'),
  transfer_at: timestamp('transfer_at', { withTimezone: true }).notNull().defaultNow(),
  transferred_by_user_id: uuid('transferred_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  encounterIdIdx: index('idx_transfer_history_encounter_id').on(table.encounter_id),
  hospitalIdIdx: index('idx_transfer_history_hospital_id').on(table.hospital_id),
  transferAtIdx: index('idx_transfer_history_transfer_at').on(table.transfer_at),
}));

// ============================================================
// DISCHARGE ORDERS (Orders for patient discharge)
// ============================================================

export const dischargeOrders = pgTable('discharge_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(), // recovered, referred, self_discharge, death, lama
  summary: text('summary'),
  status: text('status').notNull().default('draft'), // draft, ordered, completed
  ordered_at: timestamp('ordered_at', { withTimezone: true }).notNull().defaultNow(),
  ordered_by_user_id: uuid('ordered_by_user_id').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  hospitalIdIdx: index('idx_discharge_orders_hospital_id').on(table.hospital_id),
  encounterIdIdx: index('idx_discharge_orders_encounter_id').on(table.encounter_id),
  statusIdx: index('idx_discharge_orders_status').on(table.status),
}));

// ============================================================
// ADMISSION CHECKLISTS (Pre-admission checklist items per encounter)
// ============================================================

export const admissionChecklists = pgTable('admission_checklists', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'cascade' }),
  item_key: text('item_key').notNull(), // e.g., 'identity_docs', 'insurance_verified', 'pre_auth_obtained', 'consent_signed', 'emergency_contact'
  item_label: text('item_label').notNull(),
  is_mandatory: boolean('is_mandatory').notNull().default(true),
  status: checklistItemStatusEnum('status').default('pending'),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  completed_by_user_id: uuid('completed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
}, (table) => ({
  encounterIdIdx: index('idx_admission_checklists_encounter_id').on(table.encounter_id),
  hospitalIdIdx: index('idx_admission_checklists_hospital_id').on(table.hospital_id),
  itemKeyIdx: index('idx_admission_checklists_item_key').on(table.encounter_id, table.item_key),
}));

// ============================================================
// DISCHARGE MILESTONES (8-step discharge chain per encounter)
// ============================================================

export const dischargeMilestones = pgTable('discharge_milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'cascade' }),
  milestone: dischargeMilestoneEnum('milestone').notNull(),
  sequence: integer('sequence').notNull(), // 1–8
  completed_at: timestamp('completed_at', { withTimezone: true }),
  completed_by_user_id: uuid('completed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
}, (table) => ({
  encounterIdIdx: index('idx_discharge_milestones_encounter_id').on(table.encounter_id),
  hospitalIdIdx: index('idx_discharge_milestones_hospital_id').on(table.hospital_id),
  milestoneIdx: uniqueIndex('idx_discharge_milestones_unique').on(table.encounter_id, table.milestone),
}));

// ============================================================
// RELATIONS
// ============================================================

export const patientsRelations = relations(patients, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [patients.hospital_id], references: [hospitals.hospital_id] }),
  createdBy: one(users, { fields: [patients.created_by_user_id], references: [users.id], relationName: 'patient_created_by' }),
  updatedBy: one(users, { fields: [patients.updated_by_user_id], references: [users.id], relationName: 'patient_updated_by' }),
  documents: many(patientDocuments),
  coverages: many(coverages),
  relatedPersons: many(relatedPersons),
  encounters: many(encounters),
  patientsAudit: many(patientsAudit),
  mpiLinks: many(mpiLinks),
}));

export const patientsAuditRelations = relations(patientsAudit, ({ one }) => ({
  hospital: one(hospitals, { fields: [patientsAudit.hospital_id], references: [hospitals.hospital_id] }),
  patient: one(patients, { fields: [patientsAudit.patient_id], references: [patients.id] }),
  user: one(users, { fields: [patientsAudit.user_id], references: [users.id] }),
}));

export const patientDocumentsRelations = relations(patientDocuments, ({ one }) => ({
  hospital: one(hospitals, { fields: [patientDocuments.hospital_id], references: [hospitals.hospital_id] }),
  patient: one(patients, { fields: [patientDocuments.patient_id], references: [patients.id] }),
  uploadedBy: one(users, { fields: [patientDocuments.uploaded_by_user_id], references: [users.id] }),
}));

export const coveragesRelations = relations(coverages, ({ one }) => ({
  hospital: one(hospitals, { fields: [coverages.hospital_id], references: [hospitals.hospital_id] }),
  patient: one(patients, { fields: [coverages.patient_id], references: [patients.id] }),
  createdBy: one(users, { fields: [coverages.created_by_user_id], references: [users.id] }),
}));

export const relatedPersonsRelations = relations(relatedPersons, ({ one }) => ({
  hospital: one(hospitals, { fields: [relatedPersons.hospital_id], references: [hospitals.hospital_id] }),
  patient: one(patients, { fields: [relatedPersons.patient_id], references: [patients.id] }),
  createdBy: one(users, { fields: [relatedPersons.created_by_user_id], references: [users.id] }),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [locations.hospital_id], references: [hospitals.hospital_id] }),
  parentLocation: one(locations, {
    fields: [locations.parent_location_id],
    references: [locations.id],
    relationName: 'parent_location',
  }),
  childLocations: many(locations, { relationName: 'parent_location' }),
  encounters: many(encounters),
  bedAssignments: many(bedAssignments),
  bedStatusHistory: many(bedStatusHistory),
  transferFromHistory: many(transferHistory, { relationName: 'from_location' }),
  transferToHistory: many(transferHistory, { relationName: 'to_location' }),
}));

export const encountersRelations = relations(encounters, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [encounters.hospital_id], references: [hospitals.hospital_id] }),
  patient: one(patients, { fields: [encounters.patient_id], references: [patients.id] }),
  currentLocation: one(locations, { fields: [encounters.current_location_id], references: [locations.id] }),
  attendingPractitioner: one(users, { fields: [encounters.attending_practitioner_id], references: [users.id] }),
  createdBy: one(users, { fields: [encounters.created_by_user_id], references: [users.id], relationName: 'encounter_created_by' }),
  bedAssignments: many(bedAssignments),
  wristbandJobs: many(wristbandJobs),
  transferHistory: many(transferHistory),
  dischargeOrders: many(dischargeOrders),
}));

export const bedAssignmentsRelations = relations(bedAssignments, ({ one }) => ({
  hospital: one(hospitals, { fields: [bedAssignments.hospital_id], references: [hospitals.hospital_id] }),
  location: one(locations, { fields: [bedAssignments.location_id], references: [locations.id] }),
  encounter: one(encounters, { fields: [bedAssignments.encounter_id], references: [encounters.id] }),
  assignedBy: one(users, { fields: [bedAssignments.assigned_by_user_id], references: [users.id] }),
  transferToLocation: one(locations, { fields: [bedAssignments.transfer_to_location_id], references: [locations.id] }),
}));

export const bedStatusHistoryRelations = relations(bedStatusHistory, ({ one }) => ({
  hospital: one(hospitals, { fields: [bedStatusHistory.hospital_id], references: [hospitals.hospital_id] }),
  location: one(locations, { fields: [bedStatusHistory.location_id], references: [locations.id] }),
  changedBy: one(users, { fields: [bedStatusHistory.changed_by_user_id], references: [users.id] }),
}));

export const mpiRecordsRelations = relations(mpiRecords, ({ many }) => ({
  mpiLinks: many(mpiLinks),
}));

export const mpiLinksRelations = relations(mpiLinks, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [mpiLinks.hospital_id], references: [hospitals.hospital_id] }),
  mpiRecord: one(mpiRecords, { fields: [mpiLinks.mpi_record_id], references: [mpiRecords.id] }),
  patient: one(patients, { fields: [mpiLinks.patient_id], references: [patients.id] }),
  linkedBy: one(users, { fields: [mpiLinks.linked_by_user_id], references: [users.id] }),
  audit: many(mpiLinksAudit),
}));

export const mpiLinksAuditRelations = relations(mpiLinksAudit, ({ one }) => ({
  mpiLink: one(mpiLinks, { fields: [mpiLinksAudit.mpi_link_id], references: [mpiLinks.id] }),
  user: one(users, { fields: [mpiLinksAudit.user_id], references: [users.id] }),
}));

export const potentialDuplicatesRelations = relations(potentialDuplicates, ({ one }) => ({
  hospital: one(hospitals, { fields: [potentialDuplicates.hospital_id], references: [hospitals.hospital_id] }),
  patientA: one(patients, { fields: [potentialDuplicates.patient_a_id], references: [patients.id], relationName: 'dedup_patient_a' }),
  patientB: one(patients, { fields: [potentialDuplicates.patient_b_id], references: [patients.id], relationName: 'dedup_patient_b' }),
  resolvedBy: one(users, { fields: [potentialDuplicates.resolved_by_user_id], references: [users.id] }),
}));

export const uhidSequencesRelations = relations(uhidSequences, ({ one }) => ({
  hospital: one(hospitals, { fields: [uhidSequences.hospital_id], references: [hospitals.hospital_id] }),
}));

export const wristbandJobsRelations = relations(wristbandJobs, ({ one }) => ({
  hospital: one(hospitals, { fields: [wristbandJobs.hospital_id], references: [hospitals.hospital_id] }),
  encounter: one(encounters, { fields: [wristbandJobs.encounter_id], references: [encounters.id] }),
}));

export const lsqSyncLogRelations = relations(lsqSyncLog, ({ one }) => ({
  hospital: one(hospitals, { fields: [lsqSyncLog.hospital_id], references: [hospitals.hospital_id] }),
}));

export const lsqApiLogRelations = relations(lsqApiLog, ({ one }) => ({
  hospital: one(hospitals, { fields: [lsqApiLog.hospital_id], references: [hospitals.hospital_id] }),
}));

export const lsqSyncStateRelations = relations(lsqSyncState, ({ one }) => ({
  hospital: one(hospitals, { fields: [lsqSyncState.hospital_id], references: [hospitals.hospital_id] }),
  patient: one(patients, { fields: [lsqSyncState.patient_id], references: [patients.id] }),
}));

export const transferHistoryRelations = relations(transferHistory, ({ one }) => ({
  hospital: one(hospitals, { fields: [transferHistory.hospital_id], references: [hospitals.hospital_id] }),
  encounter: one(encounters, { fields: [transferHistory.encounter_id], references: [encounters.id] }),
  fromLocation: one(locations, {
    fields: [transferHistory.from_location_id],
    references: [locations.id],
    relationName: 'from_location',
  }),
  toLocation: one(locations, {
    fields: [transferHistory.to_location_id],
    references: [locations.id],
    relationName: 'to_location',
  }),
  transferredBy: one(users, { fields: [transferHistory.transferred_by_user_id], references: [users.id] }),
}));

export const dischargeOrdersRelations = relations(dischargeOrders, ({ one }) => ({
  hospital: one(hospitals, { fields: [dischargeOrders.hospital_id], references: [hospitals.hospital_id] }),
  encounter: one(encounters, { fields: [dischargeOrders.encounter_id], references: [encounters.id] }),
  orderedBy: one(users, { fields: [dischargeOrders.ordered_by_user_id], references: [users.id] }),
}));

export const admissionChecklistsRelations = relations(admissionChecklists, ({ one }) => ({
  hospital: one(hospitals, { fields: [admissionChecklists.hospital_id], references: [hospitals.hospital_id] }),
  encounter: one(encounters, { fields: [admissionChecklists.encounter_id], references: [encounters.id] }),
  completedBy: one(users, { fields: [admissionChecklists.completed_by_user_id], references: [users.id] }),
}));

export const dischargeMilestonesRelations = relations(dischargeMilestones, ({ one }) => ({
  hospital: one(hospitals, { fields: [dischargeMilestones.hospital_id], references: [hospitals.hospital_id] }),
  encounter: one(encounters, { fields: [dischargeMilestones.encounter_id], references: [encounters.id] }),
  completedBy: one(users, { fields: [dischargeMilestones.completed_by_user_id], references: [users.id] }),
}));
