/**
 * PC.3.4 Track A — admin_audit_log
 *
 * Separate audit table for admin-surface writes (chart_permission_matrix
 * edits, role preset changes, preview-as-role impersonations, future
 * admin-only mutations). Split from chart_audit_log because:
 *
 *   - chart_audit_log.patient_id is NOT NULL FK → patients.id. Matrix
 *     edits don't have a patient, forcing the silent-fail placeholder
 *     pattern used in PC.3.3.C.
 *   - Admin reads of admin_audit_log don't want to wade through clinical
 *     writes; they want their own append-only stream.
 *
 * No FK to patients. user_id is optional (system writes allowed).
 */

import {
  pgTable, text, timestamp, uuid, jsonb, index,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';

export const adminAuditLog = pgTable('admin_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  user_role: text('user_role').notNull(),

  // 'chart_matrix.update' | 'preview_role.set' | 'preview_role.clear' |
  // 'matrix_version.create' | ... — see PRD v2.0 §9 admin scope.
  action: text('action').notNull(),

  // 'chart_permission_matrix' | 'chart_permission_matrix_versions' | 'user' | ...
  resource_type: text('resource_type').notNull(),
  resource_id: uuid('resource_id'),

  // Small JSON blob — changed keys, diff summary, reason text.
  // Never store PHI here; this table is admin-surface only.
  payload_summary: jsonb('payload_summary').notNull().default({} as any),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('idx_admin_audit_hospital').on(t.hospital_id, t.created_at),
  userIdx: index('idx_admin_audit_user').on(t.user_id, t.created_at),
  actionIdx: index('idx_admin_audit_action').on(t.action, t.created_at),
  resourceIdx: index('idx_admin_audit_resource').on(t.resource_type, t.resource_id),
}));
