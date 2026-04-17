import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { labPanels, labPanelComponents } from './13-lab-radiology';

// ============================================================
// ENUMS — QC Enhancement (Module 43)
// ============================================================

export const qcLevelTypeEnum = pgEnum('qc_level_type', [
  'level_1',
  'level_2',
  'level_3',
]);

export const qcResultStatusEnum = pgEnum('qc_result_status', [
  'pass',
  'warning',
  'fail',
]);

export const westgardRuleCodeEnum = pgEnum('westgard_rule_code', [
  '1_2s',
  '1_3s',
  '2_2s',
  'R_4s',
  '4_1s',
  '10x',
]);

export const eqasPerformanceEnum = pgEnum('eqas_performance_rating', [
  'acceptable',
  'warning',
  'unacceptable',
]);

// ============================================================
// QC_LOT_MASTER — QC material lots
// ============================================================

export const qcLotMaster = pgTable('qc_lot_master', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  lot_number: varchar('lot_number', { length: 50 }).notNull(),
  material_name: text('material_name').notNull(),
  manufacturer: varchar('manufacturer', { length: 100 }),
  level: text('level').notNull(), // 'level_1', 'level_2', 'level_3'
  component_id: uuid('component_id').references(() => labPanelComponents.id, { onDelete: 'set null' }),

  target_mean: numeric('target_mean', { precision: 12, scale: 4 }).notNull(),
  target_sd: numeric('target_sd', { precision: 12, scale: 4 }).notNull(),
  unit: varchar('unit', { length: 50 }),

  received_date: timestamp('received_date'),
  expiry_date: timestamp('expiry_date'),
  opened_date: timestamp('opened_date'),

  is_expired: boolean('is_expired').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),

  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_qlm_hospital').on(t.hospital_id),
  componentIdx: index('idx_qlm_component').on(t.component_id),
  expiryIdx: index('idx_qlm_expiry').on(t.expiry_date),
  lotUnique: uniqueIndex('idx_qlm_lot_unique').on(t.hospital_id, t.lot_number, t.component_id),
}));

// ============================================================
// QC_RUNS — Individual QC measurement runs
// ============================================================

export const qcEnhancedRuns = pgTable('qc_enhanced_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  lot_id: uuid('lot_id').notNull().references(() => qcLotMaster.id, { onDelete: 'restrict' }),
  component_id: uuid('component_id').notNull().references(() => labPanelComponents.id, { onDelete: 'restrict' }),

  run_date: timestamp('run_date').notNull(),
  measured_value: numeric('measured_value', { precision: 12, scale: 4 }).notNull(),
  z_score: numeric('z_score', { precision: 8, scale: 4 }),
  result_status: text('result_status'), // 'pass', 'warning', 'fail'

  // Array of violated Westgard rule codes as JSON
  westgard_violations: jsonb('westgard_violations'),

  tech_id: uuid('tech_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  tech_sign_off: boolean('tech_sign_off').default(false).notNull(),
  sign_off_at: timestamp('sign_off_at'),

  instrument: varchar('instrument', { length: 100 }),
  notes: text('notes'),

  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_qr_hospital').on(t.hospital_id),
  lotIdx: index('idx_qr_lot').on(t.lot_id),
  componentIdx: index('idx_qr_component').on(t.component_id),
  runDateIdx: index('idx_qr_run_date').on(t.run_date),
  techIdx: index('idx_qr_tech').on(t.tech_id),
  statusIdx: index('idx_qr_status').on(t.result_status),
}));

// ============================================================
// WESTGARD_CONFIG — Westgard rule configuration per hospital
// ============================================================

export const westgardConfig = pgTable('westgard_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  rule_code: varchar('rule_code', { length: 20 }).notNull(),
  rule_name: text('rule_name').notNull(),
  description: text('description'),

  is_warning: boolean('is_warning').default(false).notNull(),
  is_reject: boolean('is_reject').default(true).notNull(),
  block_patient_results: boolean('block_patient_results').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),

  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_wc_hospital').on(t.hospital_id),
  ruleUnique: uniqueIndex('idx_wc_rule_unique').on(t.hospital_id, t.rule_code),
}));

// ============================================================
// EQAS_RESULTS — External Quality Assessment Scheme results
// ============================================================

export const eqasResults = pgTable('eqas_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  scheme_name: varchar('scheme_name', { length: 100 }).notNull(), // 'RIQAS', 'CAP', 'EQAS-India'
  cycle_name: varchar('cycle_name', { length: 100 }),
  component_id: uuid('component_id').references(() => labPanelComponents.id, { onDelete: 'set null' }),
  sample_id: varchar('sample_id', { length: 50 }),

  reported_value: numeric('reported_value', { precision: 12, scale: 4 }),
  expected_value: numeric('expected_value', { precision: 12, scale: 4 }),
  sdi: numeric('sdi', { precision: 8, scale: 4 }), // Standard Deviation Index
  performance_rating: text('performance_rating'), // 'acceptable', 'warning', 'unacceptable'

  peer_group_mean: numeric('peer_group_mean', { precision: 12, scale: 4 }),
  peer_group_sd: numeric('peer_group_sd', { precision: 12, scale: 4 }),
  peer_group_cv: numeric('peer_group_cv', { precision: 8, scale: 4 }), // coefficient of variation

  reported_date: timestamp('reported_date'),
  reported_by: uuid('reported_by').references(() => users.id, { onDelete: 'set null' }),

  notes: text('notes'),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_er_hospital').on(t.hospital_id),
  componentIdx: index('idx_er_component').on(t.component_id),
  schemeIdx: index('idx_er_scheme').on(t.scheme_name),
  performanceIdx: index('idx_er_performance').on(t.performance_rating),
}));
