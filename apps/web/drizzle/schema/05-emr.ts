import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  uniqueIndex, index, uuid, pgEnum, numeric, real,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// ENUMS — EMR / Clinical Core (Module 04)
// ============================================================

// Condition (Problem List)
export const clinicalStatusEnum = pgEnum('clinical_status', [
  'active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved',
]);
export const verificationStatusEnum = pgEnum('verification_status', [
  'unconfirmed', 'provisional', 'differential', 'confirmed',
]);

// Allergy
export const allergySeverityEnum = pgEnum('allergy_severity', [
  'mild', 'moderate', 'severe', 'life_threatening',
]);
export const allergyCategoryEnum = pgEnum('allergy_category', [
  'medication', 'food', 'environment', 'biologic',
]);
export const allergyCriticalityEnum = pgEnum('allergy_criticality', [
  'low', 'high', 'unable_to_assess',
]);

// Observation
export const observationTypeEnum = pgEnum('observation_type', [
  'vital_temperature', 'vital_pulse', 'vital_bp_systolic', 'vital_bp_diastolic',
  'vital_spo2', 'vital_rr', 'vital_pain_score', 'vital_weight', 'vital_height', 'vital_bmi',
  'intake_iv', 'intake_oral', 'output_urine', 'output_drain', 'output_emesis',
  'lab_result', 'imaging_finding',
]);
export const observationStatusEnum = pgEnum('observation_status', [
  'registered', 'preliminary', 'final', 'amended', 'cancelled', 'entered_in_error',
]);

// Alert
export const alertSeverityEnum = pgEnum('alert_severity', ['warning', 'critical']);

// NEWS2
export const news2RiskEnum = pgEnum('news2_risk_level', ['low', 'medium', 'high']);

// ============================================================
// CONDITIONS (FHIR Condition — Problem List)
// ============================================================

export const conditions = pgTable('conditions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  icd10_code: varchar('icd10_code', { length: 20 }),
  condition_name: text('condition_name').notNull(),
  clinical_status: clinicalStatusEnum('clinical_status').default('active').notNull(),
  verification_status: verificationStatusEnum('verification_status').default('unconfirmed').notNull(),
  severity: varchar('severity', { length: 20 }),   // mild | moderate | severe
  onset_date: timestamp('onset_date'),
  abatement_date: timestamp('abatement_date'),
  notes: text('notes'),

  // Event sourcing
  version: integer('version').default(1).notNull(),
  previous_version_id: uuid('previous_version_id'),
  is_deleted: boolean('is_deleted').default(false).notNull(),

  recorded_by: uuid('recorded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_conditions_patient').on(t.patient_id),
  hospitalIdx: index('idx_conditions_hospital').on(t.hospital_id),
  encounterIdx: index('idx_conditions_encounter').on(t.encounter_id),
  icd10Idx: index('idx_conditions_icd10').on(t.icd10_code),
  statusIdx: index('idx_conditions_status').on(t.clinical_status),
  versionIdx: index('idx_conditions_version').on(t.previous_version_id),
}));

// ============================================================
// ALLERGY INTOLERANCES (FHIR AllergyIntolerance)
// ============================================================

export const allergyIntolerances = pgTable('allergy_intolerances', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  substance: text('substance').notNull(),
  reaction: text('reaction'),
  severity: allergySeverityEnum('severity').default('moderate').notNull(),
  category: allergyCategoryEnum('category').default('medication').notNull(),
  criticality: allergyCriticalityEnum('criticality').default('low').notNull(),
  verification_status: verificationStatusEnum('allergy_verification_status').default('unconfirmed').notNull(),
  onset_date: timestamp('onset_date'),
  notes: text('notes'),

  // Event sourcing
  version: integer('version').default(1).notNull(),
  previous_version_id: uuid('previous_version_id'),
  is_deleted: boolean('is_deleted').default(false).notNull(),

  recorded_by: uuid('recorded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_allergies_patient').on(t.patient_id),
  hospitalIdx: index('idx_allergies_hospital').on(t.hospital_id),
  substanceIdx: index('idx_allergies_substance').on(t.substance),
  severityIdx: index('idx_allergies_severity').on(t.severity),
  statusIdx: index('idx_allergies_verification').on(t.verification_status),
}));

// ============================================================
// OBSERVATIONS (FHIR Observation — Vitals, I/O, Lab, Imaging)
// ============================================================

export const observations = pgTable('observations', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  observation_type: observationTypeEnum('observation_type').notNull(),
  status: observationStatusEnum('status').default('final').notNull(),

  // Values
  value_quantity: real('value_quantity'),
  value_string: text('value_string'),
  unit: varchar('unit', { length: 30 }),
  value_code: varchar('value_code', { length: 50 }),

  // Reference ranges
  reference_low: real('reference_low'),
  reference_high: real('reference_high'),
  interpretation: varchar('interpretation', { length: 30 }),   // normal | abnormal | critical

  effective_datetime: timestamp('effective_datetime').notNull(),

  // I/O specifics
  io_color: varchar('io_color', { length: 30 }),
  io_clarity: varchar('io_clarity', { length: 30 }),
  io_notes: text('io_notes'),

  // Composite observations (e.g., BP systolic + diastolic)
  component_of_id: uuid('component_of_id'),

  recorded_by: uuid('recorded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_obs_patient').on(t.patient_id),
  hospitalIdx: index('idx_obs_hospital').on(t.hospital_id),
  encounterIdx: index('idx_obs_encounter').on(t.encounter_id),
  typeIdx: index('idx_obs_type').on(t.observation_type),
  effectiveIdx: index('idx_obs_effective').on(t.effective_datetime),
  compositeIdx: index('idx_obs_patient_encounter_type').on(t.patient_id, t.encounter_id, t.observation_type, t.effective_datetime),
}));

// ============================================================
// CLINICAL ALERT LOGS (Vital alerts, NEWS2, allergy conflicts)
// ============================================================

export const clinicalAlertLogs = pgTable('clinical_alert_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  alert_type: varchar('alert_type', { length: 50 }).notNull(),   // vital_out_of_range | news2_high | allergy_conflict
  observation_id: uuid('observation_id'),
  threshold_value: real('threshold_value'),
  actual_value: real('actual_value'),
  unit: varchar('unit', { length: 30 }),
  severity: alertSeverityEnum('severity').notNull(),
  message: text('message'),

  // Acknowledgement
  acknowledged_by_user_id: uuid('acknowledged_by_user_id').references(() => users.id),
  acknowledged_at: timestamp('acknowledged_at'),

  // Escalation
  escalated_to_user_id: uuid('escalated_to_user_id').references(() => users.id),
  escalated_at: timestamp('escalated_at'),

  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_alert_patient').on(t.patient_id),
  hospitalIdx: index('idx_alert_hospital').on(t.hospital_id),
  typeIdx: index('idx_alert_type').on(t.alert_type),
}));

// ============================================================
// NEWS2 SCORES (Early Warning, cached from vital observations)
// ============================================================

export const news2Scores = pgTable('news2_scores', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  // Component scores (0-3 each)
  temperature_score: integer('temperature_score').default(0).notNull(),
  systolic_score: integer('systolic_score').default(0).notNull(),
  diastolic_score: integer('diastolic_score').default(0).notNull(),
  spo2_score: integer('spo2_score').default(0).notNull(),
  pulse_score: integer('pulse_score').default(0).notNull(),
  rr_score: integer('rr_score').default(0).notNull(),
  avpu_score: integer('avpu_score').default(0).notNull(),

  total_score: integer('total_score').default(0).notNull(),
  risk_level: news2RiskEnum('risk_level').default('low').notNull(),

  // Source observation IDs
  temperature_obs_id: uuid('temperature_obs_id'),
  systolic_obs_id: uuid('systolic_obs_id'),
  diastolic_obs_id: uuid('diastolic_obs_id'),
  spo2_obs_id: uuid('spo2_obs_id'),
  pulse_obs_id: uuid('pulse_obs_id'),
  rr_obs_id: uuid('rr_obs_id'),

  calculated_at: timestamp('calculated_at').defaultNow().notNull(),
  calculated_by: uuid('calculated_by').references(() => users.id),
}, (t) => ({
  patientIdx: index('idx_news2_patient').on(t.patient_id),
  encounterIdx: index('idx_news2_encounter').on(t.encounter_id),
  riskIdx: index('idx_news2_risk').on(t.risk_level),
  calcIdx: index('idx_news2_calculated').on(t.calculated_at),
}));
