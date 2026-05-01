import {
  pgTable, text, timestamp, uuid, integer, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { indents } from './63-scm-core';

// ============================================================
// SCM INDENTS — Phase 2 multi-tier approval tracking
//
// indent_approvals captures per-tier sign-off rows for the KPMG matrix.
// Phase 2 v1 uses single-tier (one row per indent); Phase 9 KPMG
// ABSORPTION expands to multi-tier chains (HOD → Non-Med Head →
// Finance → FD) using the same table.
//
// Pattern matches scm_role_assignments soft-revoke + partial UNIQUE
// INDEX from Phase 1.6.
//
// When all required rows have decision='approved', the indent
// transitions pending → approved. Any decision='rejected' transitions
// pending → rejected (whole indent).
// ============================================================

export const indentApprovals = pgTable('indent_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  indent_id: uuid('indent_id').notNull().references(() => indents.id, { onDelete: 'cascade' }),

  // CHECK approver_role IN ('hod','non_med_head','finance_in_charge','facility_director','procurement_head')
  approver_role: text('approver_role').notNull(),

  // CHECK decision IN ('approved','rejected') OR NULL = pending
  decision: text('decision'),
  decided_by: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  decision_reason: text('decision_reason'),

  tier_order: integer('tier_order').notNull().default(1),

  notes: text('notes'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_indent_approvals_hospital').on(table.hospital_id),
  indentIdx: index('idx_indent_approvals_indent').on(table.indent_id),
  roleIdx: index('idx_indent_approvals_role').on(table.approver_role),
  // Partial unique in migration: WHERE decision IS NULL
  uniqueActive: uniqueIndex('uq_indent_approvals_active').on(
    table.indent_id, table.approver_role, table.tier_order,
  ),
}));

// ----- Type exports -----

export type ApproverRole =
  | 'hod'
  | 'non_med_head'
  | 'finance_in_charge'
  | 'facility_director'
  | 'procurement_head';

export const APPROVER_ROLES: ApproverRole[] = [
  'hod',
  'non_med_head',
  'finance_in_charge',
  'facility_director',
  'procurement_head',
];

export const APPROVER_ROLE_LABELS: Record<ApproverRole, string> = {
  hod: 'Head of Department (HOD)',
  non_med_head: 'Non-Medical Head',
  finance_in_charge: 'Finance In-Charge',
  facility_director: 'Facility Director',
  procurement_head: 'Procurement Head',
};
