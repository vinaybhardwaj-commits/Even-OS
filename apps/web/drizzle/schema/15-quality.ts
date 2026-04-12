import { pgTable, pgEnum, uuid, text, varchar, integer, boolean, timestamp, date, numeric, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';

// ═══════════════════════════════════════════════════════════════
// ENUMS — Quality & NABH (Module 13, Part 1: S8a)
// ═══════════════════════════════════════════════════════════════

export const incidentTypeEnum = pgEnum('incident_type', [
  'near_miss', 'adverse_event', 'sentinel_event', 'medication_error',
  'fall', 'infection', 'equipment_failure', 'surgical_complication', 'patient_complaint',
]);

export const incidentSeverityEnum = pgEnum('incident_severity', [
  'minor', 'moderate', 'major', 'catastrophic',
]);

export const incidentStatusEnum = pgEnum('incident_status', [
  'open', 'investigating', 'closed', 'no_action_needed',
]);

export const medErrorTypeEnum = pgEnum('med_error_type', [
  'wrong_drug', 'wrong_dose', 'wrong_patient', 'wrong_time',
  'wrong_route', 'omission', 'documentation_error',
]);

export const medErrorSeverityEnum = pgEnum('med_error_severity', [
  'near_miss', 'potential_harm', 'temporary_harm', 'permanent_harm', 'death',
]);

export const fallRiskCategoryEnum = pgEnum('fall_risk_category', [
  'no_risk', 'low_risk', 'high_risk',
]);

export const fallInjurySeverityEnum = pgEnum('fall_injury_severity', [
  'none', 'minor_abrasion', 'moderate_bruising', 'fracture', 'intracranial_injury', 'death',
]);

export const auditOperationEnum = pgEnum('ae_audit_operation', [
  'CREATE', 'UPDATE', 'ROUTE', 'CLOSE', 'ESCALATE',
]);

export const qivSourceEnum = pgEnum('qiv_source', [
  'auto_computed', 'manual_entry',
]);

export const qivApprovalStatusEnum = pgEnum('qiv_approval_status', [
  'draft', 'approved', 'rejected',
]);

// ═══════════════════════════════════════════════════════════════
// ADVERSE EVENTS (Incident Reporting)
// ═══════════════════════════════════════════════════════════════

export const adverseEvents = pgTable('adverse_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  patientId: uuid('ae_patient_id'),
  encounterId: uuid('ae_encounter_id'),
  incidentType: incidentTypeEnum('incident_type').notNull(),
  severity: incidentSeverityEnum('ae_severity'),
  incidentDescription: text('incident_description').notNull(),
  incidentDate: timestamp('incident_date').notNull(),
  incidentLocationText: varchar('incident_location_text', { length: 255 }),
  incidentLocationId: uuid('incident_location_id'),
  involvedStaffIds: text('involved_staff_ids'), // comma-separated UUIDs
  witnessNames: text('witness_names'),
  immediateActionsTaken: text('immediate_actions_taken'),
  patientOutcomeStatement: text('patient_outcome_statement'),
  anonymous: boolean('anonymous').default(false),
  status: incidentStatusEnum('ae_status').default('open'),
  hasRca: boolean('has_rca').default(false),
  rcaId: uuid('rca_id'),
  reportedAt: timestamp('reported_at').defaultNow().notNull(),
  reportedByUserId: uuid('reported_by_user_id'),
  createdAt: timestamp('ae_created_at').defaultNow().notNull(),
  updatedAt: timestamp('ae_updated_at').defaultNow().notNull(),
});

export const adverseEventsAudit = pgTable('adverse_events_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  adverseEventId: uuid('adverse_event_id').notNull(),
  operation: auditOperationEnum('aea_operation').notNull(),
  fieldName: varchar('field_name', { length: 255 }),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  userId: uuid('aea_user_id').notNull(),
  changedAt: timestamp('aea_changed_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// MEDICATION ERRORS (linked to adverse_events)
// ═══════════════════════════════════════════════════════════════

export const medicationErrors = pgTable('medication_errors', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  adverseEventId: uuid('me_adverse_event_id').notNull(),
  errorTypes: text('error_types'), // comma-separated from enum
  severity: medErrorSeverityEnum('me_severity'),
  prescribedMedication: varchar('prescribed_medication', { length: 255 }),
  dispensedMedication: varchar('dispensed_medication', { length: 255 }),
  createdAt: timestamp('me_created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// FALL ASSESSMENTS (Morse Fall Scale)
// ═══════════════════════════════════════════════════════════════

export const fallAssessments = pgTable('fall_assessments', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  patientId: uuid('fa_patient_id').notNull(),
  encounterId: uuid('fa_encounter_id'),
  historyOfFalls: integer('history_of_falls').notNull(), // 0 or 25
  secondaryDiagnosis: integer('secondary_diagnosis').notNull(), // 0 or 15
  ambulatoryAid: integer('ambulatory_aid').notNull(), // 0, 15, 30
  ivOrHeparinLock: integer('iv_or_heparin_lock').notNull(), // 0 or 20
  gait: integer('gait').notNull(), // 0, 10, 20
  mentalStatus: integer('mental_status').notNull(), // 0 or 15
  morseScore: integer('morse_score').notNull(), // 0-125
  riskCategory: fallRiskCategoryEnum('risk_category').notNull(),
  assessmentNotes: text('assessment_notes'),
  assessedByUserId: uuid('assessed_by_user_id').notNull(),
  assessedAt: timestamp('assessed_at').defaultNow().notNull(),
  createdAt: timestamp('fa_created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// FALL EVENTS (linked to adverse_events)
// ═══════════════════════════════════════════════════════════════

export const fallEvents = pgTable('fall_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  adverseEventId: uuid('fe_adverse_event_id').notNull(),
  patientId: uuid('fe_patient_id').notNull(),
  encounterId: uuid('fe_encounter_id'),
  fallDate: timestamp('fall_date').notNull(),
  witnessed: boolean('witnessed').default(false),
  location: varchar('fall_location', { length: 255 }),
  fallCause: varchar('fall_cause', { length: 255 }),
  injurySeverity: fallInjurySeverityEnum('injury_severity').notNull(),
  contributingFactors: text('contributing_factors'), // comma-separated
  interventionsTaken: text('interventions_taken'),
  morseScoreAtFall: integer('morse_score_at_fall'),
  recordedByUserId: uuid('fe_recorded_by_user_id').notNull(),
  recordedAt: timestamp('fe_recorded_at').defaultNow().notNull(),
  createdAt: timestamp('fe_created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// QUALITY INDICATOR VALUES (computed/manual results)
// ═══════════════════════════════════════════════════════════════

export const qualityIndicatorValues = pgTable('quality_indicator_values', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  indicatorId: varchar('qiv_indicator_id', { length: 20 }).notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  numerator: numeric('numerator', { precision: 12, scale: 2 }),
  denominator: numeric('denominator', { precision: 12, scale: 2 }),
  value: numeric('qiv_value', { precision: 12, scale: 4 }).notNull(),
  source: qivSourceEnum('qiv_source').notNull(),
  pipelineVersion: varchar('pipeline_version', { length: 50 }),
  submittedByUserId: uuid('submitted_by_user_id'),
  submittedAt: timestamp('submitted_at'),
  approvalStatus: qivApprovalStatusEnum('approval_status'),
  approvedByUserId: uuid('approved_by_user_id'),
  approvedAt: timestamp('approved_at'),
  rejectionReason: text('rejection_reason'),
  evidenceNotes: text('evidence_notes'),
  computedAt: timestamp('computed_at'),
  createdAt: timestamp('qiv_created_at').defaultNow().notNull(),
});
