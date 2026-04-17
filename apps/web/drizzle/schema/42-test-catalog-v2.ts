import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { labPanels, labPanelComponents } from './13-lab-radiology';
import { externalLabs } from './41-external-labs';

// ============================================================
// ENUMS — Test Catalog v2 (Module B.2)
// ============================================================

export const sourceTypeEnum = pgEnum('test_source_type', [
  'in_house',
  'outsourced',
  'either',
]);

export const reportingFormatEnum = pgEnum('reporting_format', [
  'standard',
  'narrative',
  'cumulative',
]);

export const approvalStatusEnum = pgEnum('test_approval_status', [
  'draft',
  'pending_approval',
  'approved',
  'archived',
]);

export const turnaroundPriorityEnum = pgEnum('turnaround_priority', [
  'routine_4h',
  'urgent_2h',
  'stat_1h',
  'custom',
]);

export const pregnancyStatusEnum = pgEnum('pregnancy_status', [
  'not_pregnant',
  'trimester_1',
  'trimester_2',
  'trimester_3',
  'postpartum',
]);

export const clinicalContextEnum = pgEnum('clinical_context', [
  'fasting',
  'post_prandial',
  'exercise',
  'altitude',
]);

export const testGenderEnum = pgEnum('test_gender', [
  'all',
  'male',
  'female',
]);

// ============================================================
// TEST CATALOG EXTENSIONS — Extended properties for lab panels
// ============================================================

export const testCatalogExtensions = pgTable('test_catalog_extensions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  panel_id: uuid('tce_panel_id').notNull().references(() => labPanels.id, { onDelete: 'restrict' }),

  // Source classification
  source_type: text('source_type').notNull().default('in_house'),  // in_house, outsourced, either
  default_external_lab_id: uuid('default_external_lab_id').references(() => externalLabs.id, { onDelete: 'set null' }),

  // Technical details
  methodology: varchar('methodology', { length: 100 }),  // Immunoassay, HPLC, PCR, Spectrophotometry, etc.
  equipment: varchar('equipment', { length: 100 }),  // e.g., 'Beckman Coulter DxH 800', 'Roche Cobas 8000'
  specimen_volume: varchar('specimen_volume', { length: 100 }),  // e.g., '3ml', '5ml EDTA'
  special_instructions: text('special_instructions'),  // e.g., 'Fasting 8-12 hours required'

  // Reporting
  reporting_format: varchar('reporting_format', { length: 30 }).default('standard'),  // standard, narrative, cumulative
  turnaround_priority: varchar('turnaround_priority', { length: 30 }).default('routine_4h'),  // routine_4h, urgent_2h, stat_1h, custom

  // Approval & consent
  approval_status: varchar('approval_status', { length: 30 }).default('approved'),  // draft, pending_approval, approved, archived
  approved_by: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approved_at: timestamp('approved_at'),
  requires_consent: boolean('requires_consent').default(false),

  // Audit
  is_active: boolean('tce_is_active').default(true).notNull(),
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('tce_created_at').defaultNow().notNull(),
  updated_at: timestamp('tce_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_tce_hospital').on(t.hospital_id),
  panelIdx: uniqueIndex('idx_tce_panel_unique').on(t.hospital_id, t.panel_id),
  sourceTypeIdx: index('idx_tce_source_type').on(t.source_type),
  approvalStatusIdx: index('idx_tce_approval_status').on(t.approval_status),
  externalLabIdx: index('idx_tce_external_lab').on(t.default_external_lab_id),
}));

// ============================================================
// REFERENCE RANGE RULES — Advanced age/gender/pregnancy stratification
// ============================================================

export const referenceRangeRules = pgTable('reference_range_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  component_id: uuid('rrr_component_id').notNull().references(() => labPanelComponents.id, { onDelete: 'cascade' }),

  // Rule identification & metadata
  rule_name: varchar('rule_name', { length: 100 }).notNull(),  // e.g., 'Adult Male', 'Pediatric Female', 'Pregnant T3'

  // Age stratification (years & neonatal days)
  age_min_years: integer('age_min_years'),  // NULL = no lower bound
  age_max_years: integer('age_max_years'),  // NULL = no upper bound
  age_min_days: integer('age_min_days'),  // For neonates (0-28 days)
  age_max_days: integer('age_max_days'),

  // Demographics
  gender: testGenderEnum('gender').default('all').notNull(),  // all, male, female
  pregnancy_status: pregnancyStatusEnum('pregnancy_status'),  // not_pregnant, trimester_1, trimester_2, trimester_3, postpartum
  clinical_context: clinicalContextEnum('clinical_context'),  // fasting, post_prandial, exercise, altitude

  // Reference ranges
  ref_range_low: numeric('ref_range_low', { precision: 12, scale: 4 }),
  ref_range_high: numeric('ref_range_high', { precision: 12, scale: 4 }),
  ref_range_text: text('ref_range_text'),  // For non-numeric ranges like 'Negative', 'Reactive'
  unit: varchar('unit', { length: 50 }),  // e.g., 'g/dL', 'mg/dL', 'mEq/L', 'cells/μL'

  // Critical & panic ranges
  critical_low: numeric('critical_low', { precision: 12, scale: 4 }),  // Panic low
  critical_high: numeric('critical_high', { precision: 12, scale: 4 }),  // Panic high
  panic_low: numeric('panic_low', { precision: 12, scale: 4 }),  // Extreme critical low
  panic_high: numeric('panic_high', { precision: 12, scale: 4 }),  // Extreme critical high

  // Interpretation & priority
  interpretation_guide: text('interpretation_guide'),  // Clinical interpretation notes
  priority: integer('priority').default(100).notNull(),  // Lower = matched first (more specific rules win)

  // Audit
  is_active: boolean('rrr_is_active').default(true).notNull(),
  created_by: uuid('rrr_created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('rrr_created_at').defaultNow().notNull(),
  updated_at: timestamp('rrr_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_rrr_hospital').on(t.hospital_id),
  componentIdx: index('idx_rrr_component').on(t.component_id),
  genderIdx: index('idx_rrr_gender').on(t.gender),
  pregnancyIdx: index('idx_rrr_pregnancy').on(t.pregnancy_status),
  isActiveIdx: index('idx_rrr_is_active').on(t.is_active),
  priorityIdx: index('idx_rrr_priority').on(t.component_id, t.priority),  // For rule resolution
}));
