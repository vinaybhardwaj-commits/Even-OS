import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { labPanels, labPanelComponents } from './13-lab-radiology';

// ============================================================
// ENUMS — Test Catalog & Accession (Module 10 — L.3)
// ============================================================

export const catalogChangeTypeEnum = pgEnum('catalog_change_type', [
  'created', 'range_updated', 'critical_range_updated', 'deactivated', 'reactivated',
  'unit_changed', 'loinc_updated', 'specimen_changed', 'method_changed',
]);

export const accessionPrefixTypeEnum = pgEnum('accession_prefix_type', [
  'department', 'panel', 'specimen_type', 'custom',
]);

export const genderSpecificEnum = pgEnum('gender_specific', [
  'all', 'male', 'female',
]);

// ============================================================
// TEST CATALOG VERSIONS — Immutable audit trail of changes
// ============================================================

export const testCatalogVersions = pgTable('test_catalog_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // What changed
  panel_id: uuid('tcv_panel_id').references(() => labPanels.id, { onDelete: 'set null' }),
  component_id: uuid('tcv_component_id').references(() => labPanelComponents.id, { onDelete: 'set null' }),
  change_type: catalogChangeTypeEnum('tcv_change_type').notNull(),

  // Snapshot: previous values
  previous_values: jsonb('tcv_previous_values'),  // { ref_range_low, ref_range_high, critical_low, critical_high, unit, ... }
  new_values: jsonb('tcv_new_values'),

  // Who & when
  changed_by: uuid('tcv_changed_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reason: text('tcv_reason'),  // optional reason for change
  effective_from: timestamp('tcv_effective_from').defaultNow().notNull(),

  created_at: timestamp('tcv_created_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_tcv_hospital').on(t.hospital_id),
  panelIdx: index('idx_tcv_panel').on(t.panel_id),
  componentIdx: index('idx_tcv_component').on(t.component_id),
  changeTypeIdx: index('idx_tcv_change_type').on(t.change_type),
  changedAtIdx: index('idx_tcv_created').on(t.created_at),
}));

// ============================================================
// AGE-GENDER REFERENCE RANGES — Per-component overrides
// ============================================================

export const ageGenderRanges = pgTable('age_gender_ranges', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  component_id: uuid('agr_component_id').notNull().references(() => labPanelComponents.id, { onDelete: 'cascade' }),

  // Age range (in years; 0 = neonate, 999 = no upper bound)
  age_min_years: integer('agr_age_min').default(0).notNull(),
  age_max_years: integer('agr_age_max').default(999).notNull(),
  gender: genderSpecificEnum('agr_gender').default('all').notNull(),

  // Reference ranges for this demographic
  ref_range_low: numeric('agr_ref_low', { precision: 12, scale: 4 }),
  ref_range_high: numeric('agr_ref_high', { precision: 12, scale: 4 }),
  ref_range_text: text('agr_ref_text'),

  // Critical ranges for this demographic
  critical_low: numeric('agr_critical_low', { precision: 12, scale: 4 }),
  critical_high: numeric('agr_critical_high', { precision: 12, scale: 4 }),

  is_active: boolean('agr_is_active').default(true).notNull(),
  created_at: timestamp('agr_created_at').defaultNow().notNull(),
  updated_at: timestamp('agr_updated_at').defaultNow().notNull(),
}, (t) => ({
  componentIdx: index('idx_agr_component').on(t.component_id),
  hospitalIdx: index('idx_agr_hospital').on(t.hospital_id),
  demographicIdx: index('idx_agr_demographic').on(t.component_id, t.gender, t.age_min_years, t.age_max_years),
}));

// ============================================================
// ACCESSION CONFIG — Accession number generation rules
// ============================================================

export const accessionConfigs = pgTable('accession_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // Config name (e.g., "Hematology", "Biochemistry", "Microbiology")
  config_name: varchar('ac_config_name', { length: 100 }).notNull(),
  department: varchar('ac_department', { length: 50 }),

  // Format: prefix + date part + sequence
  // e.g., HEM-20260412-0001, BIO-20260412-0001
  prefix: varchar('ac_prefix', { length: 20 }).notNull(),
  prefix_type: accessionPrefixTypeEnum('ac_prefix_type').default('department').notNull(),
  date_format: varchar('ac_date_format', { length: 20 }).default('YYYYMMDD').notNull(),  // YYYYMMDD, YYMM, YYMMDD
  sequence_digits: integer('ac_sequence_digits').default(4).notNull(),  // zero-padded
  separator: varchar('ac_separator', { length: 5 }).default('-').notNull(),

  // Current sequence tracking
  current_date_key: varchar('ac_current_date_key', { length: 20 }),  // e.g., "20260412"
  current_sequence: integer('ac_current_sequence').default(0).notNull(),

  is_active: boolean('ac_is_active').default(true).notNull(),
  created_at: timestamp('ac_created_at').defaultNow().notNull(),
  updated_at: timestamp('ac_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_ac_hospital').on(t.hospital_id),
  prefixIdx: uniqueIndex('idx_ac_prefix').on(t.hospital_id, t.prefix),
  deptIdx: index('idx_ac_dept').on(t.department),
}));
