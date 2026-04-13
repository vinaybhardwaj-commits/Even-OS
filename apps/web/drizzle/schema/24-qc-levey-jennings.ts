import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, real,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';

// ============================================================
// ENUMS — QC & Levey-Jennings (Module 8 — L.7)
// ============================================================

export const qcLotStatusEnum = pgEnum('qc_lot_status', [
  'active', 'expired', 'depleted',
]);

export const qcRunStatusEnum = pgEnum('qc_run_status', [
  'accepted', 'rejected', 'warning', 'pending_review',
]);

export const qcRuleViolationEnum = pgEnum('qc_rule_violation', [
  'none', '1_2s', '1_3s', '2_2s', 'R_4s', '4_1s', '10_x', '7_T', '7_x',
]);

export const qcActionEnum = pgEnum('qc_action', [
  'accept', 'reject', 'repeat', 'recalibrate', 'new_lot', 'maintenance',
]);

// ============================================================
// TABLE 1 — qc_lots: Control material lots
// ============================================================

export const qcLots = pgTable('qc_lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.id),

  lot_number: varchar('lot_number', { length: 100 }).notNull(),
  manufacturer: varchar('manufacturer', { length: 200 }),
  material_name: varchar('material_name', { length: 200 }).notNull(),
  level: varchar('level', { length: 50 }).notNull(),         // e.g. "Level 1 (Low)", "Level 2 (Normal)", "Level 3 (High)"
  analyte: varchar('analyte', { length: 100 }).notNull(),     // e.g. "Glucose", "Hemoglobin", "Creatinine"
  analyzer: varchar('analyzer', { length: 200 }),             // e.g. "Beckman AU5800"
  department: varchar('department', { length: 100 }),          // e.g. "Biochemistry", "Hematology"
  unit: varchar('unit', { length: 50 }),                       // e.g. "mg/dL", "g/dL"

  // Manufacturer-assigned target values
  target_mean: real('target_mean').notNull(),
  target_sd: real('target_sd').notNull(),
  target_cv: real('target_cv'),                                // coefficient of variation

  // Peer / lab-specific overrides (optional — populated after enough runs)
  peer_mean: real('peer_mean'),
  peer_sd: real('peer_sd'),

  // Lot lifecycle
  status: qcLotStatusEnum('status').notNull().default('active'),
  opened_date: timestamp('opened_date', { withTimezone: true }),
  expiry_date: timestamp('expiry_date', { withTimezone: true }).notNull(),

  created_by: text('created_by').notNull().references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('qc_lots_hospital_idx').on(t.hospital_id),
  analyteIdx: index('qc_lots_analyte_idx').on(t.analyte),
  statusIdx: index('qc_lots_status_idx').on(t.status),
}));

// ============================================================
// TABLE 2 — qc_runs: Individual QC measurements
// ============================================================

export const qcRuns = pgTable('qc_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.id),
  lot_id: uuid('lot_id').notNull().references(() => qcLots.id),

  // Measurement
  measured_value: real('measured_value').notNull(),
  z_score: real('z_score'),                                   // computed: (value - mean) / sd
  sd_index: real('sd_index'),                                 // how many SDs from mean

  // Westgard evaluation
  status: qcRunStatusEnum('status').notNull().default('pending_review'),
  rule_violated: qcRuleViolationEnum('rule_violated').notNull().default('none'),
  westgard_details: jsonb('westgard_details'),                // { rules_checked: [...], triggered: [...] }

  // Corrective action
  action_taken: qcActionEnum('action_taken'),
  action_notes: text('action_notes'),
  corrective_run_id: uuid('corrective_run_id'),               // links to repeat run

  // Context
  operator: text('operator').notNull().references(() => users.id),
  run_datetime: timestamp('run_datetime', { withTimezone: true }).notNull().defaultNow(),
  shift: varchar('shift', { length: 20 }),                    // morning, afternoon, night
  temperature: real('temperature'),                           // ambient temp at time of run
  reagent_lot: varchar('reagent_lot', { length: 100 }),

  reviewed_by: text('reviewed_by').references(() => users.id),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('qc_runs_hospital_idx').on(t.hospital_id),
  lotIdx: index('qc_runs_lot_idx').on(t.lot_id),
  datetimeIdx: index('qc_runs_datetime_idx').on(t.run_datetime),
  statusIdx: index('qc_runs_status_idx').on(t.status),
}));

// ============================================================
// TABLE 3 — levey_jennings_metrics: Aggregated LJ statistics
// ============================================================

export const leveyJenningsMetrics = pgTable('levey_jennings_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.id),
  lot_id: uuid('lot_id').notNull().references(() => qcLots.id),

  // Period
  period_start: timestamp('period_start', { withTimezone: true }).notNull(),
  period_end: timestamp('period_end', { withTimezone: true }).notNull(),

  // Computed statistics
  run_count: integer('run_count').notNull().default(0),
  calculated_mean: real('calculated_mean'),
  calculated_sd: real('calculated_sd'),
  calculated_cv: real('calculated_cv'),
  min_value: real('min_value'),
  max_value: real('max_value'),

  // Violation counts
  total_violations: integer('total_violations').notNull().default(0),
  rejection_count: integer('rejection_count').notNull().default(0),
  warning_count: integer('warning_count').notNull().default(0),

  // Sigma metric (process capability)
  sigma_metric: real('sigma_metric'),                          // (TEa - |bias|) / CV
  total_allowable_error: real('total_allowable_error'),        // TEa from CLIA/CAP

  computed_at: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('lj_metrics_hospital_idx').on(t.hospital_id),
  lotIdx: index('lj_metrics_lot_idx').on(t.lot_id),
  periodIdx: index('lj_metrics_period_idx').on(t.period_start),
}));
