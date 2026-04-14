import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { relations } from 'drizzle-orm';

// ============================================================
// ENUMS — Template Management
// ============================================================

export const templateCategoryEnum = pgEnum('template_category', [
  'discharge', 'operative', 'handoff', 'admission', 'assessment',
  'consent', 'nursing', 'progress', 'consultation', 'referral', 'custom',
]);

export const templateScopeEnum = pgEnum('template_scope', [
  'system', 'department', 'personal',
]);

export const templateSuggestionTypeEnum = pgEnum('template_suggestion_type', [
  'new_field', 'default_change', 'section_reorder', 'field_removal', 'field_type_change',
]);

export const templateSuggestionStatusEnum = pgEnum('template_suggestion_status', [
  'pending', 'accepted', 'rejected', 'expired',
]);

// ============================================================
// CLINICAL TEMPLATES — Main template definitions
// ============================================================

export const clinicalTemplates = pgTable('clinical_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  name: text('template_name').notNull(),
  description: text('template_description'),
  category: templateCategoryEnum('template_category').notNull(),
  scope: templateScopeEnum('template_scope').default('personal').notNull(),

  // Ownership
  department_id: uuid('template_department_id'),  // for department-scope
  owner_id: uuid('template_owner_id').references(() => users.id, { onDelete: 'set null' }),  // for personal-scope

  // Applicability
  applicable_roles: jsonb('applicable_roles').$type<string[]>().default([]),
  applicable_encounter_types: jsonb('applicable_encounter_types').$type<string[]>().default([]),

  // Content
  fields: jsonb('template_fields').$type<TemplateField[]>().notNull().default([]),
  default_values: jsonb('template_default_values').$type<Record<string, any>>().default({}),
  ai_generation_prompt: text('ai_generation_prompt'),

  // Versioning
  version: integer('template_version').default(1).notNull(),
  is_active: boolean('template_is_active').default(true).notNull(),
  is_locked: boolean('template_is_locked').default(false).notNull(),
  forked_from_id: uuid('forked_from_id'),

  // Metadata
  tags: jsonb('template_tags').$type<string[]>().default([]),
  usage_count: integer('template_usage_count').default(0).notNull(),
  last_used_at: timestamp('template_last_used_at'),

  created_by: uuid('template_created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('template_created_at').defaultNow().notNull(),
  updated_at: timestamp('template_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_ct_hospital').on(t.hospital_id),
  categoryIdx: index('idx_ct_category').on(t.category),
  scopeIdx: index('idx_ct_scope').on(t.scope),
  ownerIdx: index('idx_ct_owner').on(t.owner_id),
  activeIdx: index('idx_ct_active').on(t.is_active),
}));

// ============================================================
// CLINICAL TEMPLATE VERSIONS — Immutable snapshots
// ============================================================

export const clinicalTemplateVersions = pgTable('clinical_template_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  template_id: uuid('ctv_template_id').notNull().references(() => clinicalTemplates.id, { onDelete: 'cascade' }),

  version_number: integer('ctv_version_number').notNull(),
  fields: jsonb('ctv_fields').$type<TemplateField[]>().notNull(),
  default_values: jsonb('ctv_default_values').$type<Record<string, any>>().default({}),
  change_summary: text('ctv_change_summary'),

  changed_by: uuid('ctv_changed_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('ctv_created_at').defaultNow().notNull(),
}, (t) => ({
  templateIdx: index('idx_ctv_template').on(t.template_id),
  versionIdx: index('idx_ctv_version').on(t.template_id, t.version_number),
}));

// ============================================================
// CLINICAL TEMPLATE USAGE LOG — Fill events
// ============================================================

export const clinicalTemplateUsageLog = pgTable('clinical_template_usage_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  template_id: uuid('ctul_template_id').notNull().references(() => clinicalTemplates.id, { onDelete: 'cascade' }),
  template_version: integer('ctul_template_version').notNull(),

  user_id: uuid('ctul_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  patient_id: uuid('ctul_patient_id'),
  encounter_id: uuid('ctul_encounter_id'),

  filled_data: jsonb('ctul_filled_data').$type<Record<string, any>>().default({}),
  completion_time_seconds: integer('ctul_completion_time_seconds'),
  fields_modified: jsonb('ctul_fields_modified').$type<string[]>().default([]),
  fields_skipped: jsonb('ctul_fields_skipped').$type<string[]>().default([]),

  created_at: timestamp('ctul_created_at').defaultNow().notNull(),
}, (t) => ({
  templateIdx: index('idx_ctul_template').on(t.template_id),
  userIdx: index('idx_ctul_user').on(t.user_id),
  patientIdx: index('idx_ctul_patient').on(t.patient_id),
}));

// ============================================================
// CLINICAL TEMPLATE AI SUGGESTIONS — Evolution engine
// ============================================================

export const clinicalTemplateAiSuggestions = pgTable('clinical_template_ai_suggestions', {
  id: uuid('id').defaultRandom().primaryKey(),
  template_id: uuid('ctas_template_id').notNull().references(() => clinicalTemplates.id, { onDelete: 'cascade' }),

  suggestion_type: templateSuggestionTypeEnum('ctas_suggestion_type').notNull(),
  suggestion_data: jsonb('ctas_suggestion_data').$type<Record<string, any>>().notNull(),
  confidence_score: numeric('ctas_confidence_score', { precision: 5, scale: 4 }),
  supporting_evidence: jsonb('ctas_supporting_evidence').$type<Record<string, any>>().default({}),

  status: templateSuggestionStatusEnum('ctas_status').default('pending').notNull(),
  reviewed_by: uuid('ctas_reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewed_at: timestamp('ctas_reviewed_at'),

  created_at: timestamp('ctas_created_at').defaultNow().notNull(),
}, (t) => ({
  templateIdx: index('idx_ctas_template').on(t.template_id),
  statusIdx: index('idx_ctas_status').on(t.status),
}));

// ============================================================
// RELATIONS
// ============================================================

export const clinicalTemplatesRelations = relations(clinicalTemplates, ({ one, many }) => ({
  owner: one(users, { fields: [clinicalTemplates.owner_id], references: [users.id] }),
  createdBy: one(users, { fields: [clinicalTemplates.created_by], references: [users.id] }),
  versions: many(clinicalTemplateVersions),
  usageLogs: many(clinicalTemplateUsageLog),
  aiSuggestions: many(clinicalTemplateAiSuggestions),
}));

export const clinicalTemplateVersionsRelations = relations(clinicalTemplateVersions, ({ one }) => ({
  template: one(clinicalTemplates, { fields: [clinicalTemplateVersions.template_id], references: [clinicalTemplates.id] }),
}));

export const clinicalTemplateUsageLogRelations = relations(clinicalTemplateUsageLog, ({ one }) => ({
  template: one(clinicalTemplates, { fields: [clinicalTemplateUsageLog.template_id], references: [clinicalTemplates.id] }),
}));

export const clinicalTemplateAiSuggestionsRelations = relations(clinicalTemplateAiSuggestions, ({ one }) => ({
  template: one(clinicalTemplates, { fields: [clinicalTemplateAiSuggestions.template_id], references: [clinicalTemplates.id] }),
}));

// ============================================================
// TYPE DEFINITIONS (for JSONB typing)
// ============================================================

export interface TemplateField {
  id: string;
  type: 'text' | 'textarea' | 'checkbox' | 'checkbox_group' | 'dropdown' | 'numeric' | 'date' | 'time' | 'datetime' | 'signature' | 'medication_list' | 'vitals_grid' | 'icd_picker' | 'procedure_picker' | 'drug_picker' | 'patient_data_auto' | 'section_header' | 'divider';
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  default_value?: any;
  auto_populate_from?: string;
  validation?: { min_length?: number; max_length?: number; min?: number; max?: number };
  conditional_on?: { field_id: string; value: any };
  ai_hint?: string;
  order: number;
}
