/**
 * Notes v2 + Document Vault + Patient Brief — Sprint N.1
 *
 * New Drizzle definitions added on 17 Apr 2026.
 *
 * NOTE: The `note_type` enum already exists (declared in 06-notes.ts). Six new
 * values (`progress_note`, `admission_note`, `physical_exam`, `procedure_note`,
 * `consultation_note`, `ward_round_note`) are appended via raw SQL migration
 * (`ALTER TYPE note_type ADD VALUE ...`) rather than redeclaring the enum here,
 * because PostgreSQL won't let you redeclare an enum without a full swap and
 * Drizzle's codegen would produce the wrong DDL.
 *
 * Similarly, two additive column changes handled via raw SQL:
 *   - `clinical_impressions.template_id uuid null`
 *   - `mrd_document_references.storage_tier storage_tier default 'vercel_blob'`
 */

import {
  pgTable, text, timestamp, jsonb, boolean, real, integer,
  index, uuid, pgEnum,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// NEW ENUMS
// ============================================================

/** Trigger events that cause a Patient Brief regeneration — PRD §5.3 */
export const briefTriggerEnum = pgEnum('brief_trigger', [
  'admission',
  'new_note',
  'new_document',
  'new_lab',
  'vitals_abnormal',
  'problem_list_change',
  'med_list_change',
  'discharge',
  'scheduled',
  'manual',
]);

/** Kind of chart update a proposal represents — PRD §5.1 */
export const proposalTypeEnum = pgEnum('chart_proposal_type', [
  'condition',
  'allergy',
  'medication',
  'lab_result',
  'procedure',
  'problem',
]);

/** Review lifecycle for chart update proposals — PRD §5.1 */
export const proposalStatusEnum = pgEnum('chart_proposal_status', [
  'pending',
  'accepted',
  'rejected',
  'modified',
]);

/** Document storage tier */
export const storageTierEnum = pgEnum('storage_tier', [
  'vercel_blob',
  'legacy_base64',
]);

// ============================================================
// patient_briefs — one row per regeneration; versioned, never deleted
// ============================================================

export const patientBriefs = pgTable('patient_briefs', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id')
    .notNull()
    .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  version: integer('version').notNull(),

  narrative: text('narrative').notNull(),
  structured: jsonb('structured').notNull(),

  triggerEvent: briefTriggerEnum('trigger_event').notNull(),
  triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),

  llmAuditId: uuid('llm_audit_id'),

  sourceIds: jsonb('source_ids').notNull().default([]),
  hallucinationFlags: jsonb('hallucination_flags').notNull().default([]),

  isStale: boolean('is_stale').notNull().default(false),
  supersedesId: uuid('supersedes_id'),

  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  patientVersionIdx: index('patient_briefs_patient_version_idx').on(t.patientId, t.version),
  hospitalIdx: index('patient_briefs_hospital_idx').on(t.hospitalId),
  generatedIdx: index('patient_briefs_generated_idx').on(t.generatedAt),
  staleIdx: index('patient_briefs_stale_idx').on(t.isStale),
}));

// ============================================================
// patient_brief_sources — traceability pointers for each brief
// ============================================================

export const patientBriefSources = pgTable('patient_brief_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  briefId: uuid('brief_id')
    .notNull()
    .references(() => patientBriefs.id, { onDelete: 'cascade' }),
  sourceTable: text('source_table').notNull(),
  sourceId: uuid('source_id').notNull(),
  includedAt: timestamp('included_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  briefIdx: index('patient_brief_sources_brief_idx').on(t.briefId),
  sourceIdx: index('patient_brief_sources_source_idx').on(t.sourceTable, t.sourceId),
}));

// ============================================================
// patient_brief_flags — doctor-raised hallucination/accuracy flags
// ============================================================

export const patientBriefFlags = pgTable('patient_brief_flags', {
  id: uuid('id').defaultRandom().primaryKey(),
  briefId: uuid('brief_id')
    .notNull()
    .references(() => patientBriefs.id, { onDelete: 'cascade' }),
  flaggedBy: uuid('flagged_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  flaggedByRole: text('flagged_by_role').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('open'),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  briefIdx: index('patient_brief_flags_brief_idx').on(t.briefId),
  statusIdx: index('patient_brief_flags_status_idx').on(t.status),
}));

// ============================================================
// chart_update_proposals — LLM-extracted facts awaiting doctor approval
// ============================================================

export const chartUpdateProposals = pgTable('chart_update_proposals', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id')
    .notNull()
    .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patientId: uuid('patient_id')
    .notNull()
    .references(() => patients.id, { onDelete: 'cascade' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),

  sourceDocumentId: uuid('source_document').notNull(),

  proposalType: proposalTypeEnum('proposal_type').notNull(),

  payload: jsonb('payload').notNull(),
  confidence: real('confidence'),
  extractionNotes: text('extraction_notes'),

  status: proposalStatusEnum('status').notNull().default('pending'),
  reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNotes: text('review_notes'),
  appliedRowId: uuid('applied_row_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  patientStatusIdx: index('chart_update_proposals_patient_status_idx').on(t.patientId, t.status),
  hospitalIdx: index('chart_update_proposals_hospital_idx').on(t.hospitalId),
  sourceDocIdx: index('chart_update_proposals_source_doc_idx').on(t.sourceDocumentId),
  createdIdx: index('chart_update_proposals_created_idx').on(t.createdAt),
}));
