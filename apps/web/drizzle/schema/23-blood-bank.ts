import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters, bloodGroupEnum } from './03-registration';

// ============================================================
// ENUMS — Blood Bank (Module 8 — L.6)
// ============================================================

export const bloodComponentEnum = pgEnum('blood_component', [
  'whole_blood', 'prbc', 'ffp', 'platelet_concentrate', 'cryoprecipitate',
  'sdp', 'granulocytes', 'plasma',
]);

export const bloodUnitStatusEnum = pgEnum('blood_unit_status', [
  'available', 'reserved', 'crossmatched', 'issued', 'transfused',
  'returned', 'expired', 'discarded',
]);

export const crossmatchStatusEnum = pgEnum('crossmatch_status', [
  'requested', 'sample_received', 'testing', 'compatible', 'incompatible', 'cancelled',
]);

export const transfusionReactionTypeEnum = pgEnum('transfusion_reaction_type', [
  'febrile', 'allergic', 'hemolytic_acute', 'hemolytic_delayed',
  'anaphylactic', 'trali', 'taco', 'septic', 'other',
]);

export const transfusionReactionSeverityEnum = pgEnum('transfusion_reaction_severity', [
  'mild', 'moderate', 'severe', 'life_threatening', 'fatal',
]);

// ============================================================
// BLOOD BANK INVENTORY — Individual blood units
// ============================================================

export const bloodBankInventory = pgTable('blood_bank_inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // Unit identification
  unit_number: varchar('bbi_unit_number', { length: 50 }).notNull(),
  blood_group: bloodGroupEnum('bbi_blood_group').notNull(),
  component: bloodComponentEnum('bbi_component').notNull(),
  status: bloodUnitStatusEnum('bbi_status').default('available').notNull(),

  // Donor info
  donor_id: varchar('bbi_donor_id', { length: 50 }),
  donor_name: text('bbi_donor_name'),
  donation_date: timestamp('bbi_donation_date'),
  donation_type: varchar('bbi_donation_type', { length: 30 }),  // voluntary, replacement, autologous

  // Unit details
  volume_ml: integer('bbi_volume_ml'),
  bag_type: varchar('bbi_bag_type', { length: 30 }),  // single, double, triple, quadruple
  anticoagulant: varchar('bbi_anticoagulant', { length: 30 }),  // CPDA-1, SAGM, etc.

  // Testing
  hiv_status: varchar('bbi_hiv', { length: 20 }).default('negative'),
  hbsag_status: varchar('bbi_hbsag', { length: 20 }).default('negative'),
  hcv_status: varchar('bbi_hcv', { length: 20 }).default('negative'),
  vdrl_status: varchar('bbi_vdrl', { length: 20 }).default('negative'),
  malaria_status: varchar('bbi_malaria', { length: 20 }).default('negative'),
  antibody_screen: varchar('bbi_antibody_screen', { length: 30 }),

  // Storage
  storage_location: varchar('bbi_storage_location', { length: 50 }),
  storage_temp: varchar('bbi_storage_temp', { length: 20 }),  // 2-6°C, -18°C, 20-24°C
  collection_date: timestamp('bbi_collection_date'),
  expiry_date: timestamp('bbi_expiry_date').notNull(),

  // Issuance
  issued_to_patient_id: uuid('bbi_issued_to').references(() => patients.id, { onDelete: 'set null' }),
  issued_at: timestamp('bbi_issued_at'),
  issued_by: uuid('bbi_issued_by').references(() => users.id, { onDelete: 'set null' }),

  // Discard/return
  discard_reason: text('bbi_discard_reason'),
  discarded_at: timestamp('bbi_discarded_at'),
  discarded_by: uuid('bbi_discarded_by').references(() => users.id, { onDelete: 'set null' }),

  received_from: varchar('bbi_received_from', { length: 100 }),  // blood bank source name
  received_at: timestamp('bbi_received_at').defaultNow(),
  received_by: uuid('bbi_received_by').references(() => users.id, { onDelete: 'set null' }),

  notes: text('bbi_notes'),
  created_at: timestamp('bbi_created_at').defaultNow().notNull(),
  updated_at: timestamp('bbi_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_bbi_hospital').on(t.hospital_id),
  unitNumIdx: index('idx_bbi_unit_number').on(t.hospital_id, t.unit_number),
  bloodGroupIdx: index('idx_bbi_blood_group').on(t.blood_group),
  componentIdx: index('idx_bbi_component').on(t.component),
  statusIdx: index('idx_bbi_status').on(t.status),
  expiryIdx: index('idx_bbi_expiry').on(t.expiry_date),
  patientIdx: index('idx_bbi_patient').on(t.issued_to_patient_id),
}));

// ============================================================
// CROSSMATCH REQUESTS — Type & crossmatch workflow
// ============================================================

export const crossmatchRequests = pgTable('crossmatch_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('cmr_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('cmr_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  request_number: varchar('cmr_request_number', { length: 50 }).notNull(),
  status: crossmatchStatusEnum('cmr_status').default('requested').notNull(),

  // Patient blood group (confirmed)
  patient_blood_group: bloodGroupEnum('cmr_patient_bg'),
  patient_antibodies: text('cmr_patient_antibodies'),

  // Request details
  component_requested: bloodComponentEnum('cmr_component').notNull(),
  units_requested: integer('cmr_units_requested').default(1).notNull(),
  urgency: varchar('cmr_urgency', { length: 20 }).default('routine'),  // routine, urgent, emergency
  indication: text('cmr_indication'),

  // Two-sample rule
  sample1_collected_at: timestamp('cmr_sample1_at'),
  sample1_collected_by: uuid('cmr_sample1_by').references(() => users.id, { onDelete: 'set null' }),
  sample2_collected_at: timestamp('cmr_sample2_at'),
  sample2_collected_by: uuid('cmr_sample2_by').references(() => users.id, { onDelete: 'set null' }),
  two_sample_verified: boolean('cmr_two_sample_ok').default(false),

  // Crossmatch result
  crossmatch_result: varchar('cmr_result', { length: 30 }),  // compatible, incompatible
  crossmatched_units: jsonb('cmr_matched_units'),  // Array of unit_ids
  crossmatched_by: uuid('cmr_crossmatched_by').references(() => users.id, { onDelete: 'set null' }),
  crossmatched_at: timestamp('cmr_crossmatched_at'),

  requested_by: uuid('cmr_requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  requested_at: timestamp('cmr_requested_at').defaultNow().notNull(),

  created_at: timestamp('cmr_created_at').defaultNow().notNull(),
  updated_at: timestamp('cmr_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_cmr_hospital').on(t.hospital_id),
  patientIdx: index('idx_cmr_patient').on(t.patient_id),
  statusIdx: index('idx_cmr_status').on(t.status),
  requestNumIdx: index('idx_cmr_request_number').on(t.hospital_id, t.request_number),
}));

// ============================================================
// TRANSFUSION REACTIONS — Adverse event logging
// ============================================================

export const transfusionReactions = pgTable('transfusion_reactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('tr_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  unit_id: uuid('tr_unit_id').references(() => bloodBankInventory.id, { onDelete: 'set null' }),

  // Reaction details
  reaction_type: transfusionReactionTypeEnum('tr_type').notNull(),
  severity: transfusionReactionSeverityEnum('tr_severity').notNull(),
  onset_minutes: integer('tr_onset_minutes'),  // minutes after transfusion start

  // Signs & symptoms
  symptoms: jsonb('tr_symptoms'),  // Array of strings: fever, chills, rash, dyspnea, etc.
  temperature: numeric('tr_temperature', { precision: 4, scale: 1 }),
  blood_pressure: varchar('tr_bp', { length: 20 }),
  heart_rate: integer('tr_heart_rate'),
  spo2: integer('tr_spo2'),

  // Actions taken
  transfusion_stopped: boolean('tr_stopped').default(true),
  treatment_given: text('tr_treatment'),
  iv_fluids: boolean('tr_iv_fluids').default(false),
  medications_given: jsonb('tr_medications'),  // Array of { drug, dose, route }

  // Investigation
  dat_result: varchar('tr_dat', { length: 30 }),  // Direct Antiglobulin Test
  repeat_crossmatch: varchar('tr_repeat_xm', { length: 30 }),
  urine_color: varchar('tr_urine_color', { length: 30 }),
  plasma_color: varchar('tr_plasma_color', { length: 30 }),
  ldh_level: varchar('tr_ldh', { length: 20 }),
  bilirubin_level: varchar('tr_bilirubin', { length: 20 }),
  haptoglobin_level: varchar('tr_haptoglobin', { length: 20 }),

  // Outcome
  outcome: varchar('tr_outcome', { length: 30 }),  // resolved, ongoing, death
  outcome_notes: text('tr_outcome_notes'),

  reported_by: uuid('tr_reported_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reported_at: timestamp('tr_reported_at').defaultNow().notNull(),
  reviewed_by: uuid('tr_reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewed_at: timestamp('tr_reviewed_at'),

  created_at: timestamp('tr_created_at').defaultNow().notNull(),
  updated_at: timestamp('tr_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_tr_hospital').on(t.hospital_id),
  patientIdx: index('idx_tr_patient').on(t.patient_id),
  unitIdx: index('idx_tr_unit').on(t.unit_id),
  typeIdx: index('idx_tr_type').on(t.reaction_type),
  severityIdx: index('idx_tr_severity').on(t.severity),
}));
