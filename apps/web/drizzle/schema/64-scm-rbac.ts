import {
  pgTable, text, timestamp, uuid, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';

// ============================================================
// SCM RBAC — Phase 1.6
//
// scm_role_assignments captures which Even OS users hold which SCM-specific
// roles. The 7 SCM roles (per Phase 1.5 /admin/scm/roles spec):
//   - pr_creator
//   - po_approver
//   - po_creator
//   - grn_creator
//   - inventory_manager
//   - item_master_steward
//   - scm_admin
//
// Path B (V's lock): per-hospital admin self-service via /admin/scm/roles
// UI. GMs assign by mid-November; V is sole final approver.
//
// Override pattern: super_admin and hospital_admin pass every SCM SoD
// check WITHOUT needing an explicit assignment row. This matches existing
// app convention and lets V/admins bootstrap the hospital before role
// assignments roll out.
//
// SoD conflict matrix encoded in src/server/scm/sod-permissions.ts —
// the assignRole router rejects assignments that would create a
// conflict for that user × hospital.
//
// Active vs revoked: a row is "active" when revoked_at IS NULL.
// Revocation is soft (audit trail preserved). uniqueIndex enforces
// at most one ACTIVE assignment per (user, hospital, scm_role) — the
// partial unique index uses WHERE revoked_at IS NULL in the migration.
// ============================================================

export const scmRoleAssignments = pgTable('scm_role_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),

  scm_role: text('scm_role').notNull(),
  // CHECK scm_role IN ('pr_creator','po_approver','po_creator','grn_creator',
  //                    'inventory_manager','item_master_steward','scm_admin')

  // ====== Grant ======
  granted_by: uuid('granted_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  granted_at: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grant_reason: text('grant_reason'),

  // ====== Revoke (soft) ======
  revoked_by: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  revoke_reason: text('revoke_reason'),

  notes: text('notes'),
}, (table) => ({
  hospitalIdx: index('idx_scm_role_assignments_hospital').on(table.hospital_id),
  userIdx: index('idx_scm_role_assignments_user').on(table.user_id),
  roleIdx: index('idx_scm_role_assignments_role').on(table.scm_role),
  // Partial unique index in migration: WHERE revoked_at IS NULL
  // (Drizzle doesn't natively express partial indexes; defined in 0061 SQL.)
  hospitalUserIdx: index('idx_scm_role_assignments_hospital_user').on(table.hospital_id, table.user_id),
}));

// Type alias for use elsewhere
export type ScmRole =
  | 'pr_creator'
  | 'po_approver'
  | 'po_creator'
  | 'grn_creator'
  | 'inventory_manager'
  | 'item_master_steward'
  | 'scm_admin';

export const SCM_ROLES: ScmRole[] = [
  'pr_creator',
  'po_approver',
  'po_creator',
  'grn_creator',
  'inventory_manager',
  'item_master_steward',
  'scm_admin',
];
