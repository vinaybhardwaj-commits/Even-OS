import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex, date,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// ENUMS — OT Management (Module 12)
// ============================================================

export const otStatusEnum = pgEnum('ot_schedule_status', [
  'requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'postponed',
]);

export const otRoomStatusEnum = pgEnum('ot_room_status', [
  'available', 'occupied', 'cleaning', 'maintenance', 'reserved',
]);

export const checklistPhaseEnum = pgEnum('checklist_phase', [
  'sign_in', 'time_out', 'sign_out',  // WHO Surgical Safety Checklist
]);

export const anesthesiaTypeEnum = pgEnum('anesthesia_type', [
  'general', 'spinal', 'epidural', 'regional_block', 'local', 'sedation', 'combined',
]);

export const asaClassEnum = pgEnum('asa_class', [
  'I', 'II', 'III', 'IV', 'V', 'VI',
]);

export const recoveryStatusEnum = pgEnum('recovery_status', [
  'in_ot', 'in_pacu', 'stable', 'discharged_to_ward', 'icu_transfer', 'complication',
]);

// ============================================================
// OT ROOMS
// ============================================================

export const otRooms = pgTable('ot_rooms', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  room_name: varchar('room_name', { length: 50 }).notNull(),
  room_number: varchar('room_number', { length: 20 }).notNull(),
  room_type: varchar('ot_room_type', { length: 30 }),  // major, minor, hybrid, cath_lab, endo
  floor: varchar('ot_floor', { length: 10 }),

  status: otRoomStatusEnum('otr_status').default('available').notNull(),
  equipment: jsonb('ot_equipment'),  // list of available equipment
  specialties: jsonb('ot_specialties'),  // compatible specialties

  is_active: boolean('otr_is_active').default(true).notNull(),
  created_at: timestamp('otr_created_at').defaultNow().notNull(),
  updated_at: timestamp('otr_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_otr_hospital').on(t.hospital_id),
  numberIdx: uniqueIndex('idx_otr_number').on(t.hospital_id, t.room_number),
  statusIdx: index('idx_otr_status').on(t.status),
}));

// ============================================================
// OT SCHEDULE (surgery bookings)
// ============================================================

export const otSchedule = pgTable('ot_schedule', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('ots_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('ots_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  room_id: uuid('ots_room_id').references(() => otRooms.id, { onDelete: 'set null' }),

  schedule_number: varchar('schedule_number', { length: 50 }).notNull(),
  status: otStatusEnum('ots_status').default('requested').notNull(),

  // Procedure
  procedure_name: text('ots_procedure_name').notNull(),
  procedure_code: varchar('ots_procedure_code', { length: 20 }),
  laterality: varchar('ots_laterality', { length: 20 }),
  estimated_duration_min: integer('estimated_duration_min'),
  actual_duration_min: integer('actual_duration_min'),

  // Team
  primary_surgeon: uuid('primary_surgeon').notNull().references(() => users.id, { onDelete: 'restrict' }),
  assistant_surgeon: uuid('assistant_surgeon').references(() => users.id, { onDelete: 'set null' }),
  anesthetist: uuid('ots_anesthetist').references(() => users.id, { onDelete: 'set null' }),
  scrub_nurse: uuid('scrub_nurse').references(() => users.id, { onDelete: 'set null' }),
  circulating_nurse: uuid('circulating_nurse').references(() => users.id, { onDelete: 'set null' }),

  // Timing
  scheduled_date: date('scheduled_date').notNull(),
  scheduled_start: timestamp('scheduled_start'),
  scheduled_end: timestamp('scheduled_end'),
  actual_start: timestamp('ots_actual_start'),
  actual_end: timestamp('ots_actual_end'),
  wheels_in: timestamp('wheels_in'),
  wheels_out: timestamp('wheels_out'),

  // Pre-op
  consent_obtained: boolean('consent_obtained').default(false),
  site_marked: boolean('site_marked').default(false),
  blood_arranged: boolean('blood_arranged').default(false),
  special_equipment: text('special_equipment'),
  pre_op_diagnosis: text('pre_op_diagnosis'),
  post_op_diagnosis: text('post_op_diagnosis'),

  priority: varchar('ots_priority', { length: 20 }).default('elective'),  // emergency, urgent, elective
  notes: text('ots_notes'),

  created_by: uuid('ots_created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('ots_created_at').defaultNow().notNull(),
  updated_at: timestamp('ots_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_ots_hospital').on(t.hospital_id),
  patientIdx: index('idx_ots_patient').on(t.patient_id),
  roomIdx: index('idx_ots_room').on(t.room_id),
  dateIdx: index('idx_ots_date').on(t.scheduled_date),
  statusIdx: index('idx_ots_status').on(t.status),
  surgeonIdx: index('idx_ots_surgeon').on(t.primary_surgeon),
  numberIdx: uniqueIndex('idx_ots_number').on(t.hospital_id, t.schedule_number),
}));

// ============================================================
// WHO SURGICAL SAFETY CHECKLIST
// ============================================================

export const otChecklists = pgTable('ot_checklists', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  schedule_id: uuid('otc_schedule_id').notNull().references(() => otSchedule.id, { onDelete: 'cascade' }),

  phase: checklistPhaseEnum('otc_phase').notNull(),

  // Sign In (before anesthesia)
  patient_identity_confirmed: boolean('identity_confirmed'),
  site_marked: boolean('cl_site_marked'),
  consent_signed: boolean('consent_signed'),
  anesthesia_machine_checked: boolean('anesthesia_checked'),
  pulse_oximeter_functioning: boolean('pulse_ox_ok'),
  allergies_known: boolean('allergies_known'),
  airway_risk: boolean('airway_risk'),
  blood_loss_risk: boolean('blood_loss_risk'),

  // Time Out (before incision)
  team_introduced: boolean('team_introduced'),
  patient_name_procedure_confirmed: boolean('name_procedure_confirmed'),
  antibiotics_given: boolean('antibiotics_given'),
  imaging_displayed: boolean('imaging_displayed'),
  critical_steps_discussed: boolean('critical_steps_discussed'),
  equipment_issues: boolean('equipment_issues'),

  // Sign Out (before leaving OT)
  instrument_count_correct: boolean('instrument_count_ok'),
  specimen_labeled: boolean('specimen_labeled'),
  equipment_problems_noted: boolean('equipment_problems'),
  recovery_plan_discussed: boolean('recovery_plan'),

  completed_by: uuid('otc_completed_by').references(() => users.id, { onDelete: 'set null' }),
  completed_at: timestamp('otc_completed_at'),
  notes: text('otc_notes'),

  created_at: timestamp('otc_created_at').defaultNow().notNull(),
}, (t) => ({
  scheduleIdx: index('idx_otc_schedule').on(t.schedule_id),
  hospitalIdx: index('idx_otc_hospital').on(t.hospital_id),
  phaseIdx: index('idx_otc_phase').on(t.phase),
}));

// ============================================================
// ANESTHESIA RECORDS
// ============================================================

export const anesthesiaRecords = pgTable('anesthesia_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  schedule_id: uuid('ar_schedule_id').notNull().references(() => otSchedule.id, { onDelete: 'cascade' }),
  patient_id: uuid('ar_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  // Pre-op assessment
  asa_class: asaClassEnum('ar_asa_class'),
  anesthesia_type: anesthesiaTypeEnum('ar_anesthesia_type').notNull(),
  airway_assessment: text('airway_assessment'),  // mallampati, thyromental, etc.
  fasting_hours: integer('fasting_hours'),
  pre_medications: jsonb('pre_medications'),
  allergies_noted: text('ar_allergies'),
  comorbidities: text('ar_comorbidities'),

  // Intra-op
  induction_time: timestamp('induction_time'),
  intubation_time: timestamp('intubation_time'),
  extubation_time: timestamp('extubation_time'),
  agents_used: jsonb('agents_used'),  // [{name, dose, route, time}]
  fluids_given: jsonb('fluids_given'),  // [{type, volume_ml, time}]
  blood_products: jsonb('blood_products'),
  estimated_blood_loss_ml: integer('ebl_ml'),
  urine_output_ml: integer('urine_output_ml'),

  // Vitals timeline (periodic readings)
  vitals_timeline: jsonb('vitals_timeline'),  // [{time, hr, bp_sys, bp_dia, spo2, etco2, temp}]

  // Complications
  complications: text('ar_complications'),
  difficult_airway: boolean('difficult_airway').default(false),
  anaphylaxis: boolean('anaphylaxis').default(false),

  // Post-op / Recovery
  recovery_status: recoveryStatusEnum('ar_recovery_status').default('in_ot'),
  aldrete_score: integer('aldrete_score'),  // 0-10 recovery score
  pacu_admission_time: timestamp('pacu_admission_time'),
  pacu_discharge_time: timestamp('pacu_discharge_time'),
  post_op_orders: text('post_op_orders'),

  anesthetist_id: uuid('ar_anesthetist_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  notes: text('ar_notes'),
  created_at: timestamp('ar_created_at').defaultNow().notNull(),
  updated_at: timestamp('ar_updated_at').defaultNow().notNull(),
}, (t) => ({
  scheduleIdx: index('idx_ar_schedule').on(t.schedule_id),
  hospitalIdx: index('idx_ar_hospital').on(t.hospital_id),
  patientIdx: index('idx_ar_patient').on(t.patient_id),
  typeIdx: index('idx_ar_type').on(t.anesthesia_type),
  recoveryIdx: index('idx_ar_recovery').on(t.recovery_status),
}));

// ============================================================
// OT EQUIPMENT LOG
// ============================================================

export const otEquipmentLog = pgTable('ot_equipment_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  schedule_id: uuid('oel_schedule_id').references(() => otSchedule.id, { onDelete: 'set null' }),
  room_id: uuid('oel_room_id').references(() => otRooms.id, { onDelete: 'set null' }),

  equipment_name: text('equipment_name').notNull(),
  equipment_code: varchar('equipment_code', { length: 30 }),
  action: varchar('oel_action', { length: 20 }).notNull(),  // checked_out, returned, malfunction, maintenance
  condition: varchar('oel_condition', { length: 20 }),  // good, needs_repair, out_of_service

  logged_by: uuid('oel_logged_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  logged_at: timestamp('oel_logged_at').defaultNow().notNull(),
  notes: text('oel_notes'),
}, (t) => ({
  hospitalIdx: index('idx_oel_hospital').on(t.hospital_id),
  scheduleIdx: index('idx_oel_schedule').on(t.schedule_id),
  roomIdx: index('idx_oel_room').on(t.room_id),
}));

// ============================================================
// OT TURNOVER LOG (room cleaning/prep between cases)
// ============================================================

export const otTurnoverLog = pgTable('ot_turnover_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  room_id: uuid('otl_room_id').notNull().references(() => otRooms.id, { onDelete: 'restrict' }),

  previous_schedule_id: uuid('prev_schedule_id').references(() => otSchedule.id, { onDelete: 'set null' }),
  next_schedule_id: uuid('next_schedule_id').references(() => otSchedule.id, { onDelete: 'set null' }),

  cleaning_start: timestamp('cleaning_start').notNull(),
  cleaning_end: timestamp('cleaning_end'),
  turnover_minutes: integer('turnover_minutes'),

  cleaned_by: uuid('cleaned_by').references(() => users.id, { onDelete: 'set null' }),
  verified_by: uuid('otl_verified_by').references(() => users.id, { onDelete: 'set null' }),
  verified_at: timestamp('otl_verified_at'),

  notes: text('otl_notes'),
  created_at: timestamp('otl_created_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_otl_hospital').on(t.hospital_id),
  roomIdx: index('idx_otl_room').on(t.room_id),
  dateIdx: index('idx_otl_date').on(t.cleaning_start),
}));
