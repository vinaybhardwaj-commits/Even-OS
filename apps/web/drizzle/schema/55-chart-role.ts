/**
 * Patient Chart Overhaul — PC.3.1 — Role/Tab Model foundation
 *
 * Three tables that together give the Patient Chart a role-adaptive surface:
 *
 *   1. `chart_permission_matrix` — per-role chart config (visible tabs, overview
 *      card order, action-bar preset, sensitive-field list, allowed writes).
 *      Safe-default fallback: on miss, `chartSelectors.forRole()` returns the
 *      hardcoded pre-PC.3 config so nothing breaks.
 *
 *   2. `chart_audit_log` — append-only row per edit to the patient chart.
 *      Every note write, order placement, problem-list change, vitals entry,
 *      etc. logs one row. Normal reads are NOT logged (would be too noisy).
 *
 *   3. `chart_view_audit` — append-only row only when a sensitive field is
 *      rendered for a restricted role (e.g. CCE viewing diagnosis, billing
 *      viewing notes snippet). Keyed from the matrix `sensitive_fields`.
 *
 * All three have `hospital_id` per PRD v2.0 §25 multi-tenant future.
 *
 * See PRD v2.0 §9 (audit), §18 (overview layout), §23 (action bar),
 * and the PC.3 scope in `project_patient_chart_prd.md`.
 */

import {
  pgTable, text, timestamp, uuid, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ── 1. chart_permission_matrix ──────────────────────────────────────────────

export const chartPermissionMatrix = pgTable('chart_permission_matrix', {
  id: uuid('id').defaultRandom().primaryKey(),
  role: text('role').notNull(),
  role_tag: text('role_tag'),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // Ordered list of visible tab ids. See PatientTab union in patient-chart-client.tsx.
  tabs: text('tabs').array().notNull(),

  // Ordered array of card ids for the Overview grid. PRD §18.
  overview_layout: jsonb('overview_layout').notNull().default([] as any),

  // Bottom-bar pills preset { primary: [...], secondary: [...] }. PRD §23.
  action_bar_preset: jsonb('action_bar_preset').notNull().default({} as any),

  // Field ids whose render triggers a chart_view_audit row.
  sensitive_fields: text('sensitive_fields').array().notNull().default([] as any),

  // Write-action ids granted (future PC.3.2 enforcement).
  allowed_write_actions: text('allowed_write_actions').array().notNull().default([] as any),

  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqRole: uniqueIndex('uniq_chart_perm_role').on(t.role, t.role_tag, t.hospital_id),
  hospitalIdx: index('idx_chart_perm_hospital').on(t.hospital_id),
}));

// ── 2. chart_audit_log ──────────────────────────────────────────────────────

export const chartAuditLog = pgTable('chart_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  user_role: text('user_role').notNull(),

  // 'note.create' | 'note.amend' | 'order.place' | 'order.cancel' |
  // 'problem.add' | 'problem.update' | 'vitals.record' | ...
  action: text('action').notNull(),

  // 'note' | 'order' | 'condition' | 'observation' | 'proposal' | ...
  resource_type: text('resource_type').notNull(),
  resource_id: uuid('resource_id'),

  // Small diff summary — never store full PHI payloads here.
  payload_summary: jsonb('payload_summary').notNull().default({} as any),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientIdx: index('idx_chart_audit_patient').on(t.patient_id, t.created_at),
  userIdx: index('idx_chart_audit_user').on(t.user_id, t.created_at),
  hospitalIdx: index('idx_chart_audit_hospital').on(t.hospital_id, t.created_at),
  actionIdx: index('idx_chart_audit_action').on(t.action, t.created_at),
}));

// ── 3. chart_view_audit ─────────────────────────────────────────────────────

export const chartViewAudit = pgTable('chart_view_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  user_role: text('user_role').notNull(),

  // Which sensitive field was rendered — e.g. 'diagnosis', 'notes_snippet', 'mlc_reason'.
  field_name: text('field_name').notNull(),

  // Which chart tab surfaced it, if known.
  tab_id: text('tab_id'),

  // Free-form reason if the UI captures one (e.g. "billing enquiry").
  access_reason: text('access_reason'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  patientIdx: index('idx_chart_view_patient').on(t.patient_id, t.created_at),
  userIdx: index('idx_chart_view_user').on(t.user_id, t.created_at),
  fieldIdx: index('idx_chart_view_field').on(t.field_name, t.created_at),
}));
