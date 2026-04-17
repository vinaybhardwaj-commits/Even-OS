import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { relations } from 'drizzle-orm';

// ============================================================
// ENUMS — Bill Adjustments / Waiver Governance (A.4)
// ============================================================

export const adjustmentTypeEnum = pgEnum('adjustment_type', [
  'waiver',           // Full or partial waiver of charges
  'discount',         // Percentage or flat discount
  'write_off',        // Bad debt write-off
  'hardship',         // Financial hardship — always escalates to GM
  'goodwill',         // Goodwill gesture (service recovery)
  'rounding',         // Rounding adjustment (auto-approved)
]);

export const adjustmentStatusEnum = pgEnum('adjustment_status', [
  'pending',          // Waiting for approval
  'approved_tier1',   // Auto-approved (≤ ₹5,000 waiver/discount)
  'approved_tier2',   // Billing manager approved (₹5,001–₹50,000)
  'approved_tier3',   // Accounts manager approved (₹50,001–₹2,00,000)
  'approved_tier4',   // GM approved (₹2,00,001+)
  'approved_gm',      // GM override (hardship, special cases)
  'rejected',         // Rejected at any tier
  'revised',          // Superseded by a new version
  'cancelled',        // Cancelled by requester
]);

// ============================================================
// BILL ADJUSTMENTS — Tiered approval workflow
// ============================================================

export const billAdjustments = pgTable('bill_adjustments', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // What is being adjusted
  encounter_id: uuid('encounter_id'),       // The admission
  patient_id: uuid('patient_id'),           // The patient
  bill_id: uuid('bill_id'),                 // Specific bill/invoice
  billing_account_id: uuid('billing_account_id'), // Billing account

  // Adjustment details
  adjustment_type: adjustmentTypeEnum('adjustment_type').notNull(),
  adjustment_amount: numeric('adjustment_amount', { precision: 14, scale: 2 }).notNull(),
  original_amount: numeric('original_amount', { precision: 14, scale: 2 }).notNull(),
  adjusted_amount: numeric('adjusted_amount', { precision: 14, scale: 2 }).notNull(),

  // For discount type
  discount_percentage: numeric('discount_percentage', { precision: 5, scale: 2 }),

  // Reason & justification
  reason: text('reason').notNull(),
  category: text('category'), // e.g., 'service_issue', 'financial_hardship', 'staff_error', 'insurance_gap'
  justification: text('justification'), // Detailed explanation
  supporting_docs: jsonb('supporting_docs').default([]), // Array of document references

  // Approval workflow
  status: adjustmentStatusEnum('status').notNull().default('pending'),
  current_approver_role: text('current_approver_role'), // Role needed to approve next
  tier_required: integer('tier_required').notNull().default(1), // Computed from amount + category

  // Approval chain (JSONB array of approval actions)
  // [{ tier, role, user_id, user_name, action: 'approve'|'reject', timestamp, notes }]
  approval_chain: jsonb('approval_chain').notNull().default([]),

  // Rejection
  rejection_reason: text('rejection_reason'),
  rejected_by: uuid('rejected_by').references(() => users.id, { onDelete: 'set null' }),

  // Version chain (revised adjustments)
  version: integer('version').notNull().default(1),
  parent_adjustment_id: uuid('parent_adjustment_id'), // Previous version

  // Audit
  requested_by: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  approved_by: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
  resolved_at: timestamp('resolved_at'), // When final approval/rejection happened
}, (t) => ({
  hospitalIdx: index('idx_ba_hospital').on(t.hospital_id),
  encounterIdx: index('idx_ba_encounter').on(t.encounter_id),
  patientIdx: index('idx_ba_patient').on(t.patient_id),
  billIdx: index('idx_ba_bill').on(t.bill_id),
  statusIdx: index('idx_ba_status').on(t.status),
  typeIdx: index('idx_ba_type').on(t.adjustment_type),
  approverIdx: index('idx_ba_approver').on(t.current_approver_role),
  parentIdx: index('idx_ba_parent').on(t.parent_adjustment_id),
  requestedByIdx: index('idx_ba_requested_by').on(t.requested_by),
}));

// ============================================================
// ADJUSTMENT CONFIG — Tier thresholds (editable by super_admin)
// ============================================================

export const adjustmentConfig = pgTable('adjustment_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  config_key: text('config_key').notNull(), // e.g., 'waiver_tier_thresholds', 'discount_max_pct'
  config_value: jsonb('config_value').notNull(),
  description: text('description'),

  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalKeyIdx: uniqueIndex('idx_ac_hospital_key').on(t.hospital_id, t.config_key),
}));

// ============================================================
// Relations
// ============================================================

export const billAdjustmentRelations = relations(billAdjustments, ({ one }) => ({
  parentAdjustment: one(billAdjustments, {
    fields: [billAdjustments.parent_adjustment_id],
    references: [billAdjustments.id],
    relationName: 'adjustmentVersions',
  }),
}));
