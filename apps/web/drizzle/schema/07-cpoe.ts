import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, real,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// ENUMS — CPOE & eMAR (Module 05)
// ============================================================

export const medRequestStatusEnum = pgEnum('med_request_status', [
  'draft', 'active', 'on_hold', 'completed', 'cancelled', 'entered_in_error',
]);

export const medRequestIntentEnum = pgEnum('med_request_intent', [
  'order', 'plan', 'proposal', 'reflex_order',
]);

export const frequencyUnitEnum = pgEnum('frequency_unit', [
  'hourly', 'daily', 'weekly', 'as_needed',
]);

export const medAdminStatusEnum = pgEnum('med_admin_status', [
  'pending', 'in_progress', 'completed', 'not_done', 'held', 'entered_in_error',
]);

export const narcoticsClassEnum = pgEnum('narcotics_class', [
  'OTC', 'H', 'H1', 'X', 'none',
]);

export const cdsAlertTypeEnum = pgEnum('cds_alert_type', [
  'allergy', 'drug_drug_interaction', 'duplicate_order', 'dose_range',
  'privilege_violation', 'high_alert', 'lasa', 'renal_adjustment',
]);

export const cdsAlertSeverityEnum = pgEnum('cds_alert_severity', [
  'info', 'warning', 'critical',
]);

export const cdsAlertOutcomeEnum = pgEnum('cds_alert_outcome', [
  'accepted', 'overridden', 'cancelled',
]);

export const serviceRequestTypeEnum = pgEnum('service_request_type', [
  'lab', 'imaging', 'referral', 'consult',
]);

export const serviceRequestStatusEnum = pgEnum('service_request_status', [
  'draft', 'active', 'completed', 'cancelled', 'entered_in_error',
]);

export const resultStatusEnum = pgEnum('result_status', [
  'pending', 'preliminary', 'final', 'corrected', 'cancelled',
]);

export const dietTypeEnum = pgEnum('diet_type', [
  'regular', 'soft', 'liquid', 'npo', 'diabetic', 'renal', 'cardiac', 'low_sodium',
  'high_protein', 'pureed', 'custom',
]);

export const dietOrderStatusEnum = pgEnum('diet_order_status', [
  'active', 'completed', 'cancelled', 'on_hold',
]);

export const nursingTaskTypeEnum = pgEnum('nursing_task_type', [
  'vitals_monitoring', 'positioning', 'wound_care', 'catheter_care',
  'fall_precautions', 'isolation_precautions', 'oxygen_therapy',
  'iv_monitoring', 'drain_care', 'feeding', 'mobility', 'custom',
]);

export const nursingOrderStatusEnum = pgEnum('nursing_order_status', [
  'active', 'completed', 'cancelled', 'on_hold',
]);

// ============================================================
// MEDICATION REQUESTS (FHIR MedicationRequest)
// ============================================================

export const medicationRequests = pgTable('medication_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  // Medication reference
  drug_name: text('drug_name').notNull(),
  generic_name: text('generic_name'),
  drug_code: varchar('drug_code', { length: 50 }),

  // Status
  status: medRequestStatusEnum('med_req_status').default('draft').notNull(),
  intent: medRequestIntentEnum('med_req_intent').default('order').notNull(),

  // Dosage
  dose_quantity: real('dose_quantity'),
  dose_unit: varchar('dose_unit', { length: 30 }),       // mg, ml, mcg, units
  route: varchar('route', { length: 50 }),                // oral, iv, im, sc, topical
  frequency_code: varchar('frequency_code', { length: 20 }),  // BD, TDS, QID, Q4H, Q6H, Q8H, STAT, PRN, OD, HS
  frequency_value: integer('frequency_value'),             // numeric: e.g. 4 for "every 4 hours"
  frequency_unit: frequencyUnitEnum('frequency_unit'),     // hourly, daily, weekly, as_needed
  duration_days: integer('duration_days'),
  max_dose_per_day: real('max_dose_per_day'),

  // PRN (as-needed) specifics
  is_prn: boolean('is_prn').default(false),
  prn_indication: text('prn_indication'),                // e.g. "for pain", "for nausea"

  // Safety flags
  is_high_alert: boolean('is_high_alert').default(false),
  is_lasa: boolean('is_lasa').default(false),
  narcotics_class: narcoticsClassEnum('narcotics_class').default('none'),

  // Instructions
  instructions: text('instructions'),
  substitution_allowed: boolean('substitution_allowed').default(true),

  // Ordering
  prescriber_id: uuid('prescriber_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  ordered_at: timestamp('ordered_at').defaultNow().notNull(),
  start_date: timestamp('start_date'),
  end_date: timestamp('end_date'),

  // Cancellation
  cancelled_at: timestamp('cancelled_at'),
  cancel_reason: text('cancel_reason'),

  // Event sourcing
  version: integer('version').default(1).notNull(),
  previous_version_id: uuid('previous_version_id'),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_medreq_patient').on(t.patient_id),
  hospitalIdx: index('idx_medreq_hospital').on(t.hospital_id),
  encounterIdx: index('idx_medreq_encounter').on(t.encounter_id),
  statusIdx: index('idx_medreq_status').on(t.status),
  prescriberIdx: index('idx_medreq_prescriber').on(t.prescriber_id),
  drugCodeIdx: index('idx_medreq_drug_code').on(t.drug_code),
  narcoticsIdx: index('idx_medreq_narcotics').on(t.narcotics_class),
}));

// ============================================================
// MEDICATION ADMINISTRATIONS (FHIR MedicationAdministration — eMAR)
// ============================================================

export const medicationAdministrations = pgTable('medication_administrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  medication_request_id: uuid('medication_request_id').notNull().references(() => medicationRequests.id, { onDelete: 'restrict' }),

  // Status
  status: medAdminStatusEnum('med_admin_status').default('pending').notNull(),

  // Scheduled vs actual
  scheduled_datetime: timestamp('scheduled_datetime').notNull(),
  administered_datetime: timestamp('administered_datetime'),

  // Dose administered
  dose_given: real('dose_given'),
  dose_unit: varchar('admin_dose_unit', { length: 30 }),
  route: varchar('admin_route', { length: 50 }),

  // Barcode verification
  patient_barcode_scanned: boolean('patient_barcode_scanned').default(false),
  medication_barcode_scanned: boolean('medication_barcode_scanned').default(false),
  manual_entry: boolean('manual_entry').default(false),

  // Narcotics double-check
  witness_id: uuid('witness_id').references(() => users.id),
  witness_confirmed_at: timestamp('witness_confirmed_at'),

  // High-alert dose confirmation
  dose_confirmed: boolean('dose_confirmed').default(false),

  // PRN details
  prn_indication_given: text('prn_indication_given'),     // pain, nausea, fever, anxiety, insomnia

  // Not-done / Hold tracking
  not_done_reason: text('not_done_reason'),               // patient_refused, npo, vomiting, absent, withheld
  hold_reason: text('hold_reason'),

  // Site
  administration_site: varchar('administration_site', { length: 100 }),

  // Performer
  administered_by: uuid('administered_by').references(() => users.id),
  notes: text('notes'),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_medadmin_patient').on(t.patient_id),
  hospitalIdx: index('idx_medadmin_hospital').on(t.hospital_id),
  encounterIdx: index('idx_medadmin_encounter').on(t.encounter_id),
  medRequestIdx: index('idx_medadmin_med_request').on(t.medication_request_id),
  statusIdx: index('idx_medadmin_status').on(t.status),
  scheduledIdx: index('idx_medadmin_scheduled').on(t.scheduled_datetime),
  administeredByIdx: index('idx_medadmin_administered_by').on(t.administered_by),
}));

// ============================================================
// CDS ALERTS (Clinical Decision Support — immutable log)
// ============================================================

export const cdsAlerts = pgTable('cds_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  // Alert type and details
  alert_type: cdsAlertTypeEnum('cds_alert_type').notNull(),
  severity: cdsAlertSeverityEnum('cds_alert_severity').notNull(),
  message: text('message').notNull(),
  details: jsonb('cds_details'),            // { drug_a, drug_b, interaction_type } or { allergen, reaction }

  // What triggered it
  triggering_order_id: uuid('triggering_order_id'),      // medication_request or service_request
  conflicting_order_id: uuid('conflicting_order_id'),    // the existing order that conflicts

  // Outcome
  outcome: cdsAlertOutcomeEnum('cds_alert_outcome'),
  override_reason: text('override_reason'),
  resolved_by: uuid('resolved_by').references(() => users.id),
  resolved_at: timestamp('resolved_at'),

  // Triggered by (user creating the order)
  triggered_by: uuid('triggered_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_cds_patient').on(t.patient_id),
  hospitalIdx: index('idx_cds_hospital').on(t.hospital_id),
  alertTypeIdx: index('idx_cds_alert_type').on(t.alert_type),
  severityIdx: index('idx_cds_severity').on(t.severity),
  outcomeIdx: index('idx_cds_outcome').on(t.outcome),
  triggeredByIdx: index('idx_cds_triggered_by').on(t.triggered_by),
}));

// ============================================================
// SERVICE REQUESTS (FHIR ServiceRequest — Lab, Imaging, Referral)
// ============================================================

export const serviceRequests = pgTable('service_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  // Type and identity
  request_type: serviceRequestTypeEnum('service_request_type').notNull(),
  status: serviceRequestStatusEnum('service_req_status').default('draft').notNull(),
  priority: varchar('sr_priority', { length: 20 }).default('routine'),  // routine, urgent, stat

  // Common fields
  order_code: varchar('sr_order_code', { length: 50 }),
  order_name: text('sr_order_name').notNull(),
  clinical_indication: text('clinical_indication'),
  instructions: text('sr_instructions'),

  // Lab-specific
  test_code: varchar('test_code', { length: 50 }),
  specimen_type: varchar('specimen_type', { length: 50 }),
  fasting_required: boolean('fasting_required').default(false),

  // Imaging-specific
  modality: varchar('modality', { length: 50 }),           // xray, ct, mri, ultrasound, fluoroscopy
  body_part: varchar('body_part', { length: 100 }),
  contrast_required: boolean('contrast_required').default(false),
  pregnancy_check: boolean('pregnancy_check'),
  renal_function_check: boolean('renal_function_check'),

  // Referral-specific
  referral_to_department: varchar('referral_to_department', { length: 100 }),
  referral_to_provider_id: uuid('referral_to_provider_id').references(() => users.id),
  referral_reason: text('referral_reason'),

  // Results
  result_status: resultStatusEnum('result_status').default('pending'),
  result_value: text('result_value'),
  result_json: jsonb('result_json'),
  reference_range: text('reference_range'),
  is_critical: boolean('is_critical').default(false),
  result_datetime: timestamp('result_datetime'),
  reported_by: uuid('reported_by').references(() => users.id),

  // Ordering
  requester_id: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  ordered_at: timestamp('sr_ordered_at').defaultNow().notNull(),
  completed_at: timestamp('sr_completed_at'),
  cancelled_at: timestamp('sr_cancelled_at'),
  cancel_reason: text('sr_cancel_reason'),

  // Billing
  charge_master_id: uuid('sr_charge_master_id'),
  unit_price: numeric('sr_unit_price', { precision: 12, scale: 2 }),

  created_at: timestamp('sr_created_at').defaultNow().notNull(),
  updated_at: timestamp('sr_updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_sr_patient').on(t.patient_id),
  hospitalIdx: index('idx_sr_hospital').on(t.hospital_id),
  encounterIdx: index('idx_sr_encounter').on(t.encounter_id),
  typeIdx: index('idx_sr_type').on(t.request_type),
  statusIdx: index('idx_sr_status').on(t.status),
  requesterIdx: index('idx_sr_requester').on(t.requester_id),
  resultStatusIdx: index('idx_sr_result_status').on(t.result_status),
  criticalIdx: index('idx_sr_critical').on(t.is_critical),
}));

// ============================================================
// DIET ORDERS
// ============================================================

export const dietOrders = pgTable('diet_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  diet_type: dietTypeEnum('diet_type').notNull(),
  status: dietOrderStatusEnum('diet_order_status').default('active').notNull(),

  custom_description: text('custom_description'),        // for 'custom' diet type
  restrictions: jsonb('diet_restrictions'),               // ["no milk", "gluten-free"]
  supplements: jsonb('diet_supplements'),                 // ["Ensure 200ml TDS", "ORS 1L/day"]
  calorie_target: integer('calorie_target'),
  fluid_restriction_ml: integer('fluid_restriction_ml'),

  start_date: timestamp('diet_start_date').notNull(),
  end_date: timestamp('diet_end_date'),

  ordered_by: uuid('diet_ordered_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  cancelled_at: timestamp('diet_cancelled_at'),
  cancel_reason: text('diet_cancel_reason'),

  created_at: timestamp('diet_created_at').defaultNow().notNull(),
  updated_at: timestamp('diet_updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_diet_patient').on(t.patient_id),
  hospitalIdx: index('idx_diet_hospital').on(t.hospital_id),
  encounterIdx: index('idx_diet_encounter').on(t.encounter_id),
  statusIdx: index('idx_diet_status').on(t.status),
}));

// ============================================================
// NURSING ORDERS (task-based)
// ============================================================

export const nursingOrders = pgTable('nursing_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  task_type: nursingTaskTypeEnum('nursing_task_type').notNull(),
  status: nursingOrderStatusEnum('nursing_order_status').default('active').notNull(),

  description: text('nursing_order_description').notNull(),
  frequency_code: varchar('nursing_freq_code', { length: 20 }),   // Q4H, Q6H, Q8H, continuous, once
  instructions: text('nursing_instructions'),

  start_date: timestamp('nursing_start_date').notNull(),
  end_date: timestamp('nursing_end_date'),

  // Completion tracking
  last_completed_at: timestamp('last_completed_at'),
  completion_count: integer('completion_count').default(0),
  completion_log: jsonb('completion_log'),                // [{completed_at, completed_by, notes}]

  ordered_by: uuid('nursing_ordered_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  cancelled_at: timestamp('nursing_cancelled_at'),
  cancel_reason: text('nursing_cancel_reason'),

  created_at: timestamp('nursing_created_at').defaultNow().notNull(),
  updated_at: timestamp('nursing_updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_nursing_ord_patient').on(t.patient_id),
  hospitalIdx: index('idx_nursing_ord_hospital').on(t.hospital_id),
  encounterIdx: index('idx_nursing_ord_encounter').on(t.encounter_id),
  taskTypeIdx: index('idx_nursing_ord_task_type').on(t.task_type),
  statusIdx: index('idx_nursing_ord_status').on(t.status),
}));
