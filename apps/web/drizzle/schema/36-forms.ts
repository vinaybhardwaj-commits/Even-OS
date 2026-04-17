import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb, uuid,
  index, uniqueIndex, serial, pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { hospitals, users } from './00-foundations';
import { encounters, patients } from './03-registration';
import { chatChannels, chatMessages } from './35-chat';

// ============================================================
// FORM ENGINE — SC.1
// 4 tables: form_definitions, form_submissions, form_audit_log,
//   form_analytics_events
// ============================================================

// ── Enums ──────────────────────────────────────────────────────────────────

export const formCategoryEnum = pgEnum('form_category_sc1', [
  'clinical', 'operational', 'administrative', 'custom',
]);

export const formStatusEnumSC1 = pgEnum('form_status_sc1', [
  'draft', 'active', 'archived',
]);

export const submissionStatusEnum = pgEnum('submission_status', [
  'draft', 'submitted', 'reviewed', 'locked', 'voided',
]);

export const formAuditActionEnum = pgEnum('form_audit_action', [
  'form_opened', 'form_submitted', 'form_viewed', 'status_changed',
  'version_created', 'export_pdf',
]);

export const analyticsEventTypeEnum = pgEnum('form_analytics_event_type', [
  'form_start', 'field_focus', 'field_blur', 'section_enter',
  'form_submit', 'form_abandon',
]);

// ── form_definitions ──────────────────────────────────────────────────────
// Stores form structure, metadata, layout, and submission routing.
// One row per form definition (versioned separately).

export const formDefinitions = pgTable('form_definitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 256 }).notNull(),
  slug: varchar('slug', { length: 128 }).notNull(),
  description: text('description'),
  category: formCategoryEnum('category').notNull().default('custom'),
  version: integer('version').notNull().default(1),
  status: formStatusEnumSC1('status').notNull().default('draft'),
  sections: jsonb('sections').notNull().default('[]'), // Array of FormSection objects
  requires_patient: boolean('requires_patient').notNull().default(false),
  applicable_roles: jsonb('applicable_roles').notNull().default('[]'), // Array of role strings
  applicable_encounter_types: jsonb('applicable_encounter_types').default('[]'), // Array of encounter type strings
  role_field_visibility: jsonb('role_field_visibility'), // { role: { field_id: bool } }
  slash_command: varchar('slash_command', { length: 64 }),
  slash_role_action_map: jsonb('slash_role_action_map'), // { role: { action: endpoint } }
  layout: varchar('layout', { length: 32 }).notNull().default('auto'), // scroll | wizard | auto
  submission_target: varchar('submission_target', { length: 64 }).notNull().default('form_submissions'), // form_submissions | his_router | clinical_template
  submit_endpoint: text('submit_endpoint'),
  template_slug: varchar('template_slug', { length: 128 }),
  submit_transform: text('submit_transform'), // Transformation logic (JSON schema or Jsonnet snippet)
  source_url: text('source_url'),
  ported_from: varchar('ported_from', { length: 128 }),
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalStatusIdx: index('idx_form_defs_hospital_status').on(table.hospital_id, table.status),
  slugVersionIdx: uniqueIndex('idx_form_defs_slug_version').on(table.hospital_id, table.slug, table.version),
}));

// ── form_submissions ───────────────────────────────────────────────────────
// Immutable submission records. Version chain support for edits.
// Supports draft → submitted → reviewed → locked → voided states.

export const formSubmissions = pgTable('form_submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  form_definition_id: uuid('form_definition_id').notNull().references(() => formDefinitions.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').references(() => patients.id), // Nullable for non-patient forms
  encounter_id: uuid('encounter_id').references(() => encounters.id), // Nullable
  channel_id: uuid('channel_id').references(() => chatChannels.id), // NULL if not from chat
  message_id: integer('message_id'), // confirmation card message ID (nullable)
  parent_submission_id: uuid('parent_submission_id'), // Self-ref for version chain (will be set in relations)
  version: integer('version').notNull().default(1),
  form_data: jsonb('form_data').notNull(), // The actual form response
  form_data_hash: varchar('form_data_hash', { length: 64 }).notNull(), // SHA-256 for tamper detection
  status: submissionStatusEnum('status').notNull().default('submitted'),
  void_reason: text('void_reason'),
  submitted_by: uuid('submitted_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  submitted_at: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  reviewed_by: uuid('reviewed_by').references(() => users.id),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  locked_by: uuid('locked_by').references(() => users.id),
  locked_at: timestamp('locked_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalSubmittedIdx: index('idx_form_subs_hospital_submitted').on(table.hospital_id, table.submitted_at),
  patientIdx: index('idx_form_subs_patient').on(table.patient_id),
  formDefIdx: index('idx_form_subs_form_def').on(table.form_definition_id),
  parentIdx: index('idx_form_subs_parent').on(table.parent_submission_id),
  encounterIdx: index('idx_form_subs_encounter').on(table.encounter_id),
}));

// ── form_audit_log ─────────────────────────────────────────────────────────
// Every interaction with a form (open, submit, view, status change, etc).
// Immutable for compliance and traceability.

export const formAuditLog = pgTable('form_audit_log', {
  id: serial('id').primaryKey(), // BIGSERIAL
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  form_definition_id: uuid('form_definition_id').notNull().references(() => formDefinitions.id, { onDelete: 'restrict' }),
  form_submission_id: uuid('form_submission_id').references(() => formSubmissions.id), // Nullable
  patient_id: uuid('patient_id').references(() => patients.id), // Nullable
  action: formAuditActionEnum('action').notNull(),
  action_detail: jsonb('action_detail'), // Flexible metadata
  field_snapshot: jsonb('field_snapshot'), // Snapshot of form data at time of action
  performed_by: uuid('performed_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  performed_at: timestamp('performed_at', { withTimezone: true }).notNull().defaultNow(),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
}, (table) => ({
  hospitalPerformedIdx: index('idx_form_audit_hospital_performed').on(table.hospital_id, table.performed_at),
  formDefPerformedIdx: index('idx_form_audit_form_def_performed').on(table.form_definition_id, table.performed_at),
  patientIdx: index('idx_form_audit_patient').on(table.patient_id),
  performedByIdx: index('idx_form_audit_performed_by').on(table.performed_by, table.performed_at),
  submissionIdx: index('idx_form_audit_submission').on(table.form_submission_id),
}));

// ── form_analytics_events ──────────────────────────────────────────────────
// UX analytics: track form usage patterns, drop-off points, time spent.
// Lightweight event stream for analytics and optimization.

export const formAnalyticsEvents = pgTable('form_analytics_events', {
  id: serial('id').primaryKey(), // BIGSERIAL
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  form_definition_id: uuid('form_definition_id').notNull().references(() => formDefinitions.id, { onDelete: 'restrict' }),
  session_id: varchar('session_id', { length: 128 }).notNull(),
  event_type: analyticsEventTypeEnum('event_type').notNull(),
  field_id: varchar('field_id', { length: 128 }),
  section_id: varchar('section_id', { length: 128 }),
  duration_ms: integer('duration_ms'), // Time spent on field/section
  metadata: jsonb('metadata'), // Flexible metadata
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  formDefCreatedIdx: index('idx_form_analytics_form_def_created').on(table.form_definition_id, table.created_at),
  sessionIdx: index('idx_form_analytics_session').on(table.session_id),
}));

// ============================================================
// RELATIONS
// ============================================================

export const formDefinitionRelations = relations(formDefinitions, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [formDefinitions.hospital_id], references: [hospitals.hospital_id] }),
  creator: one(users, { fields: [formDefinitions.created_by], references: [users.id] }),
  submissions: many(formSubmissions),
  auditLogs: many(formAuditLog),
  analyticsEvents: many(formAnalyticsEvents),
}));

export const formSubmissionRelations = relations(formSubmissions, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [formSubmissions.hospital_id], references: [hospitals.hospital_id] }),
  formDefinition: one(formDefinitions, { fields: [formSubmissions.form_definition_id], references: [formDefinitions.id] }),
  patient: one(patients, { fields: [formSubmissions.patient_id], references: [patients.id] }),
  encounter: one(encounters, { fields: [formSubmissions.encounter_id], references: [encounters.id] }),
  channel: one(chatChannels, { fields: [formSubmissions.channel_id], references: [chatChannels.id] }),
  submittedBy: one(users, { fields: [formSubmissions.submitted_by], references: [users.id] }),
  reviewedBy: one(users, { fields: [formSubmissions.reviewed_by], references: [users.id] }),
  lockedBy: one(users, { fields: [formSubmissions.locked_by], references: [users.id] }),
  parentSubmission: one(formSubmissions, { fields: [formSubmissions.parent_submission_id], references: [formSubmissions.id] }),
  childSubmissions: many(formSubmissions),
  auditLogs: many(formAuditLog),
}));

export const formAuditLogRelations = relations(formAuditLog, ({ one }) => ({
  hospital: one(hospitals, { fields: [formAuditLog.hospital_id], references: [hospitals.hospital_id] }),
  formDefinition: one(formDefinitions, { fields: [formAuditLog.form_definition_id], references: [formDefinitions.id] }),
  formSubmission: one(formSubmissions, { fields: [formAuditLog.form_submission_id], references: [formSubmissions.id] }),
  patient: one(patients, { fields: [formAuditLog.patient_id], references: [patients.id] }),
  performedBy: one(users, { fields: [formAuditLog.performed_by], references: [users.id] }),
}));

export const formAnalyticsEventRelations = relations(formAnalyticsEvents, ({ one }) => ({
  hospital: one(hospitals, { fields: [formAnalyticsEvents.hospital_id], references: [hospitals.hospital_id] }),
  formDefinition: one(formDefinitions, { fields: [formAnalyticsEvents.form_definition_id], references: [formDefinitions.id] }),
}));
