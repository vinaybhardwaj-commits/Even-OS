import {
  pgTable, text, uuid, integer, numeric, timestamp, boolean,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { inventoryItems } from './66-codes';

// =============================================================================
// CODES MODULE — Phase 2 (Approval workflow)
// =============================================================================
// Implements Q3's locked design (5-state machine + role-routing per code kind),
// scoped down to the PRD line for Phase 2: Pharmacy Supervisor + Master Data
// Officer queues + SOP §5.6 enforcement.
//
// 4 schema deltas:
//   1. inventory_items.status (added in 66-codes.ts; see comment there)
//   2. codes_approval_history — append-only audit log of state transitions
//   3. codes_approval_routing — config: code_kind → SLA + clinical-stage rules
//   4. codes_role_assignments — domain RBAC (mirrors scm_role_assignments
//      pattern; bypasses the foundation user_role pgEnum since adding to a
//      pgEnum is irreversible and cross-domain noise)
//
// State machine (5 states + rejection branch):
//
//   draft → pending_clinical_review (skipped for non-clinical kinds)
//         → pending_master_data_review (always required)
//           → pending_cms_gm_review (high-impact only — Phase 3+)
//             → active
//
//   rejected loops back to draft from any stage with feedback note
//
// Phase 2 implements the spine: drug 2-stage (pharmacy_supervisor → mdo →
// active) and consumable 1-stage (mdo → active). Other code kinds (implant /
// procedure / lab_test / imaging_study / pack / charge_tier) get added when
// their respective downstream PRDs ship (LIS, RIS, OT, Codes Phase 3+4).
//
// Roles seeded for Phase 2:
//   - pharmacy_supervisor (Stage-1 reviewer for drugs)
//   - master_data_officer (Stage-2 reviewer always)
// Future roles (added when downstream PRDs need them):
//   - cath_lab_lead, lab_lead, radiology_lead, cms_gm_approver
// =============================================================================

// ---------- 1. codes_approval_history (audit log) ----------

export const codesApprovalHistory = pgTable('codes_approval_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  item_id: uuid('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  /**
   * code_kind classifier — one of:
   *   drug | implant | consumable | procedure | lab_test | imaging_study |
   *   pack | charge_tier | lookup | deprecation
   * CHECK enforced in migration SQL.
   */
  code_kind: text('code_kind').notNull(),
  from_state: text('from_state').notNull(),
  /**
   * Target state. CHECK enforced in migration SQL with same values as
   * inventory_items.status.
   */
  to_state: text('to_state').notNull(),
  actor_user_id: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  /**
   * Role that performed the action. 'system' for migration / bootstrap rows.
   * For human actions, one of the 6 codes roles or super_admin / hospital_admin.
   */
  actor_role: text('actor_role').notNull(),
  /**
   * SLA remaining when the action fired (0-100). NULL for non-SLA-tracked
   * transitions (system bootstrap, draft→pending_*).
   */
  sla_remaining_pct_at_action: numeric('sla_remaining_pct_at_action', { precision: 5, scale: 2 }),
  feedback_note: text('feedback_note'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  itemIdx: index('idx_codes_approval_history_item').on(t.item_id),
  toStateIdx: index('idx_codes_approval_history_to_state').on(t.to_state),
  hospitalCreatedIdx: index('idx_codes_approval_history_hospital_created').on(t.hospital_id, t.created_at),
  actorIdx: index('idx_codes_approval_history_actor').on(t.actor_user_id),
}));

export type CodesApprovalHistory = typeof codesApprovalHistory.$inferSelect;


// ---------- 2. codes_approval_routing (config) ----------

export const codesApprovalRouting = pgTable('codes_approval_routing', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  /**
   * code_kind being routed. Same enum values as codes_approval_history.code_kind.
   * CHECK enforced in migration SQL.
   */
  code_kind: text('code_kind').notNull(),
  /**
   * Stage-1 reviewer role. NULL = skip clinical stage (consumables, lookups).
   * For drugs: 'pharmacy_supervisor'. For implants/procedures (later phases):
   * 'cath_lab_lead' / 'department_head' / etc.
   */
  clinical_role: text('clinical_role'),
  /**
   * If true, codes meeting high-impact thresholds escalate to CMS/GM stage.
   * Phase 2: deferred (no high-impact rules defined yet — Phase 4 territory).
   */
  requires_cms_gm_for_high_impact: boolean('requires_cms_gm_for_high_impact').notNull().default(false),
  /** Working-days SLA per stage. 0 = stage skipped. */
  sla_clinical_working_days: integer('sla_clinical_working_days').notNull().default(3),
  sla_mdo_working_days: integer('sla_mdo_working_days').notNull().default(2),
  sla_cms_gm_working_days: integer('sla_cms_gm_working_days').notNull().default(2),
  is_active: boolean('is_active').notNull().default(true),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalKindIdx: uniqueIndex('idx_codes_approval_routing_hospital_kind').on(t.hospital_id, t.code_kind),
  isActiveIdx: index('idx_codes_approval_routing_active').on(t.is_active),
}));

export type CodesApprovalRouting = typeof codesApprovalRouting.$inferSelect;


// ---------- 3. codes_role_assignments (domain RBAC) ----------

export type CodesRole =
  | 'pharmacy_supervisor'
  | 'master_data_officer'
  | 'cath_lab_lead'
  | 'lab_lead'
  | 'radiology_lead'
  | 'cms_gm_approver';

export const CODES_ROLES: CodesRole[] = [
  'pharmacy_supervisor',
  'master_data_officer',
  'cath_lab_lead',
  'lab_lead',
  'radiology_lead',
  'cms_gm_approver',
];

export const CODES_ROLE_LABELS: Record<CodesRole, string> = {
  pharmacy_supervisor: 'Pharmacy Supervisor',
  master_data_officer: 'Master Data Officer',
  cath_lab_lead: 'Cath Lab Lead',
  lab_lead: 'Lab Lead',
  radiology_lead: 'Radiology Lead',
  cms_gm_approver: 'CMS / GM Approver',
};

export const codesRoleAssignments = pgTable('codes_role_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /**
   * One of the 6 codes roles. CHECK enforced in migration SQL.
   * CodesRole TS type mirrors the CHECK list for type-safe code paths.
   */
  codes_role: text('codes_role').notNull(),
  assigned_by: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  /** Soft-revoke pattern: set revoked_at to retire an assignment without losing audit. */
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  revoked_by: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
}, (t) => ({
  // Active assignments are unique per (hospital, user, role).
  // Partial UNIQUE INDEX added by name in migration SQL: WHERE revoked_at IS NULL.
  activeUniqueIdx: uniqueIndex('idx_codes_role_assignments_active').on(t.hospital_id, t.user_id, t.codes_role),
  userIdx: index('idx_codes_role_assignments_user').on(t.user_id),
  hospitalRoleIdx: index('idx_codes_role_assignments_hospital_role').on(t.hospital_id, t.codes_role),
}));

export type CodesRoleAssignment = typeof codesRoleAssignments.$inferSelect;
