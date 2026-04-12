import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// ENUMS — Lab & Radiology (Module 10)
// ============================================================

export const labOrderStatusEnum = pgEnum('lab_order_status', [
  'ordered', 'collected', 'received', 'processing', 'resulted', 'verified', 'cancelled',
]);

export const specimenStatusEnum = pgEnum('specimen_status', [
  'pending_collection', 'collected', 'in_transit', 'received_lab', 'processing', 'completed', 'rejected',
]);

export const resultFlagEnum = pgEnum('result_flag', [
  'normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal',
]);

export const radiologyOrderStatusEnum = pgEnum('radiology_order_status', [
  'ordered', 'scheduled', 'in_progress', 'completed', 'reported', 'verified', 'cancelled',
]);

export const radiologyModalityEnum = pgEnum('radiology_modality', [
  'xray', 'ct', 'mri', 'ultrasound', 'fluoroscopy', 'mammography', 'dexa', 'pet_ct', 'interventional',
]);

export const urgencyEnum = pgEnum('lab_urgency', [
  'routine', 'urgent', 'stat', 'asap',
]);

// ============================================================
// LAB PANELS (grouped tests — e.g., CBC, LFT, RFT)
// ============================================================

export const labPanels = pgTable('lab_panels', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  panel_code: varchar('panel_code', { length: 30 }).notNull(),
  panel_name: text('panel_name').notNull(),
  department: varchar('lp_department', { length: 50 }),  // hematology, biochemistry, microbiology, pathology
  description: text('lp_description'),

  // LOINC mapping
  loinc_code: varchar('lp_loinc_code', { length: 20 }),

  sample_type: varchar('sample_type', { length: 50 }),  // blood, urine, csf, tissue, swab, etc.
  container_type: varchar('container_type', { length: 50 }),  // EDTA, plain, citrate, heparin, etc.

  tat_minutes: integer('tat_minutes'),  // expected turnaround time
  price: numeric('lp_price', { precision: 10, scale: 2 }),

  is_active: boolean('lp_is_active').default(true).notNull(),
  created_at: timestamp('lp_created_at').defaultNow().notNull(),
  updated_at: timestamp('lp_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_lp_hospital').on(t.hospital_id),
  codeIdx: uniqueIndex('idx_lp_code').on(t.hospital_id, t.panel_code),
  deptIdx: index('idx_lp_dept').on(t.department),
}));

// ============================================================
// LAB PANEL COMPONENTS (individual tests within a panel)
// ============================================================

export const labPanelComponents = pgTable('lab_panel_components', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  panel_id: uuid('lpc_panel_id').notNull().references(() => labPanels.id, { onDelete: 'cascade' }),

  test_code: varchar('test_code', { length: 30 }).notNull(),
  test_name: text('test_name').notNull(),
  loinc_code: varchar('lpc_loinc_code', { length: 20 }),

  unit: varchar('test_unit', { length: 30 }),
  reference_range_low: numeric('ref_range_low', { precision: 12, scale: 4 }),
  reference_range_high: numeric('ref_range_high', { precision: 12, scale: 4 }),
  reference_range_text: text('ref_range_text'),  // for non-numeric ranges

  critical_low: numeric('critical_low', { precision: 12, scale: 4 }),
  critical_high: numeric('critical_high', { precision: 12, scale: 4 }),

  data_type: varchar('test_data_type', { length: 20 }).default('numeric'),  // numeric, text, coded, ratio
  sort_order: integer('lpc_sort_order').default(0),

  is_active: boolean('lpc_is_active').default(true).notNull(),
  created_at: timestamp('lpc_created_at').defaultNow().notNull(),
}, (t) => ({
  panelIdx: index('idx_lpc_panel').on(t.panel_id),
  hospitalIdx: index('idx_lpc_hospital').on(t.hospital_id),
  testCodeIdx: index('idx_lpc_test_code').on(t.test_code),
}));

// ============================================================
// LAB ORDERS (linked to service_requests from CPOE)
// ============================================================

export const labOrders = pgTable('lab_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('lo_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('lo_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  service_request_id: uuid('lo_service_request_id'),  // from CPOE service_requests
  panel_id: uuid('lo_panel_id').references(() => labPanels.id, { onDelete: 'set null' }),

  order_number: varchar('lo_order_number', { length: 50 }).notNull(),
  status: labOrderStatusEnum('lo_status').default('ordered').notNull(),
  urgency: urgencyEnum('lo_urgency').default('routine').notNull(),

  panel_code: varchar('lo_panel_code', { length: 30 }),
  panel_name: text('lo_panel_name'),
  clinical_notes: text('lo_clinical_notes'),

  ordered_by: uuid('lo_ordered_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  ordered_at: timestamp('lo_ordered_at').defaultNow().notNull(),
  collected_at: timestamp('lo_collected_at'),
  received_at: timestamp('lo_received_at'),
  resulted_at: timestamp('lo_resulted_at'),
  verified_at: timestamp('lo_verified_at'),
  verified_by: uuid('lo_verified_by').references(() => users.id, { onDelete: 'set null' }),

  tat_minutes_actual: integer('tat_minutes_actual'),  // actual turnaround
  is_critical: boolean('lo_is_critical').default(false),

  created_at: timestamp('lo_created_at').defaultNow().notNull(),
  updated_at: timestamp('lo_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_lo_hospital').on(t.hospital_id),
  patientIdx: index('idx_lo_patient').on(t.patient_id),
  encounterIdx: index('idx_lo_encounter').on(t.encounter_id),
  statusIdx: index('idx_lo_status').on(t.status),
  orderNumberIdx: uniqueIndex('idx_lo_order_number').on(t.hospital_id, t.order_number),
  urgencyIdx: index('idx_lo_urgency').on(t.urgency),
  orderedAtIdx: index('idx_lo_ordered_at').on(t.ordered_at),
}));

// ============================================================
// LAB RESULTS (individual test results within an order)
// ============================================================

export const labResults = pgTable('lab_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  order_id: uuid('lr_order_id').notNull().references(() => labOrders.id, { onDelete: 'cascade' }),
  component_id: uuid('lr_component_id').references(() => labPanelComponents.id, { onDelete: 'set null' }),

  test_code: varchar('lr_test_code', { length: 30 }).notNull(),
  test_name: text('lr_test_name').notNull(),

  // Result
  value_numeric: numeric('value_numeric', { precision: 12, scale: 4 }),
  value_text: text('value_text'),
  value_coded: varchar('value_coded', { length: 50 }),
  unit: varchar('lr_unit', { length: 30 }),

  // Reference ranges (snapshot at result time)
  ref_range_low: numeric('lr_ref_range_low', { precision: 12, scale: 4 }),
  ref_range_high: numeric('lr_ref_range_high', { precision: 12, scale: 4 }),
  ref_range_text: text('lr_ref_range_text'),

  flag: resultFlagEnum('lr_flag').default('normal'),
  is_critical: boolean('lr_is_critical').default(false),

  // LOINC
  loinc_code: varchar('lr_loinc_code', { length: 20 }),

  resulted_by: uuid('lr_resulted_by').references(() => users.id, { onDelete: 'set null' }),
  resulted_at: timestamp('lr_resulted_at').defaultNow().notNull(),
  notes: text('lr_notes'),
}, (t) => ({
  orderIdx: index('idx_lr_order').on(t.order_id),
  hospitalIdx: index('idx_lr_hospital').on(t.hospital_id),
  testCodeIdx: index('idx_lr_test_code').on(t.test_code),
  flagIdx: index('idx_lr_flag').on(t.flag),
  criticalIdx: index('idx_lr_critical').on(t.is_critical),
}));

// ============================================================
// SPECIMEN TRACKING
// ============================================================

export const specimens = pgTable('specimens', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  order_id: uuid('sp_order_id').notNull().references(() => labOrders.id, { onDelete: 'cascade' }),
  patient_id: uuid('sp_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  barcode: varchar('sp_barcode', { length: 50 }),
  sample_type: varchar('sp_sample_type', { length: 50 }).notNull(),
  container_type: varchar('sp_container_type', { length: 50 }),
  status: specimenStatusEnum('sp_status').default('pending_collection').notNull(),

  collected_by: uuid('sp_collected_by').references(() => users.id, { onDelete: 'set null' }),
  collected_at: timestamp('sp_collected_at'),
  collection_site: varchar('collection_site', { length: 50 }),

  received_by: uuid('sp_received_by').references(() => users.id, { onDelete: 'set null' }),
  received_at: timestamp('sp_received_at'),

  rejection_reason: text('sp_rejection_reason'),
  notes: text('sp_notes'),

  created_at: timestamp('sp_created_at').defaultNow().notNull(),
}, (t) => ({
  orderIdx: index('idx_sp_order').on(t.order_id),
  hospitalIdx: index('idx_sp_hospital').on(t.hospital_id),
  patientIdx: index('idx_sp_patient').on(t.patient_id),
  barcodeIdx: uniqueIndex('idx_sp_barcode').on(t.hospital_id, t.barcode),
  statusIdx: index('idx_sp_status').on(t.status),
}));

// ============================================================
// RADIOLOGY ORDERS
// ============================================================

export const radiologyOrders = pgTable('radiology_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('ro_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('ro_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  service_request_id: uuid('ro_service_request_id'),  // from CPOE
  order_number: varchar('ro_order_number', { length: 50 }).notNull(),

  modality: radiologyModalityEnum('ro_modality').notNull(),
  study_description: text('study_description').notNull(),
  body_part: varchar('body_part', { length: 100 }),
  laterality: varchar('laterality', { length: 20 }),  // left, right, bilateral

  status: radiologyOrderStatusEnum('ro_status').default('ordered').notNull(),
  urgency: urgencyEnum('ro_urgency').default('routine').notNull(),
  clinical_indication: text('clinical_indication'),
  contrast_required: boolean('contrast_required').default(false),

  // Scheduling
  scheduled_at: timestamp('scheduled_at'),
  room: varchar('ro_room', { length: 30 }),

  // Execution
  performed_by: uuid('ro_performed_by').references(() => users.id, { onDelete: 'set null' }),
  performed_at: timestamp('ro_performed_at'),

  ordered_by: uuid('ro_ordered_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  ordered_at: timestamp('ro_ordered_at').defaultNow().notNull(),

  created_at: timestamp('ro_created_at').defaultNow().notNull(),
  updated_at: timestamp('ro_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_ro_hospital').on(t.hospital_id),
  patientIdx: index('idx_ro_patient').on(t.patient_id),
  encounterIdx: index('idx_ro_encounter').on(t.encounter_id),
  statusIdx: index('idx_ro_status').on(t.status),
  orderNumberIdx: uniqueIndex('idx_ro_order_number').on(t.hospital_id, t.order_number),
  modalityIdx: index('idx_ro_modality').on(t.modality),
  scheduledIdx: index('idx_ro_scheduled').on(t.scheduled_at),
}));

// ============================================================
// RADIOLOGY REPORTS
// ============================================================

export const radiologyReports = pgTable('radiology_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  order_id: uuid('rr2_order_id').notNull().references(() => radiologyOrders.id, { onDelete: 'cascade' }),

  findings: text('rr2_findings'),
  impression: text('rr2_impression'),
  recommendation: text('rr2_recommendation'),

  // Scoring (where applicable)
  birads_category: varchar('birads_category', { length: 10 }),  // mammography
  li_rads_category: varchar('li_rads_category', { length: 10 }),  // liver CT/MRI
  lung_rads_category: varchar('lung_rads_category', { length: 10 }),  // chest CT

  is_critical: boolean('rr2_is_critical').default(false),
  critical_notified: boolean('critical_notified').default(false),
  critical_notified_to: text('critical_notified_to'),
  critical_notified_at: timestamp('critical_notified_at'),

  reported_by: uuid('rr2_reported_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reported_at: timestamp('rr2_reported_at').defaultNow().notNull(),

  verified_by: uuid('rr2_verified_by').references(() => users.id, { onDelete: 'set null' }),
  verified_at: timestamp('rr2_verified_at'),

  // Addendum
  addendum: text('rr2_addendum'),
  addendum_by: uuid('rr2_addendum_by').references(() => users.id, { onDelete: 'set null' }),
  addendum_at: timestamp('rr2_addendum_at'),

  created_at: timestamp('rr2_created_at').defaultNow().notNull(),
}, (t) => ({
  orderIdx: index('idx_rr2_order').on(t.order_id),
  hospitalIdx: index('idx_rr2_hospital').on(t.hospital_id),
  reportedByIdx: index('idx_rr2_reported_by').on(t.reported_by),
  criticalIdx: index('idx_rr2_critical').on(t.is_critical),
}));
