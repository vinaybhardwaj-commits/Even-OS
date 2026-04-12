import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';
import { billingAccounts } from './09-billing';
import { insuranceClaims } from './10-insurance';

// ============================================================
// ENUMS — Refunds & Revenue (Module 11c)
// Note: invoices/payments tables exist in 04-clinical.ts (S4d)
// This file adds: refund_requests, revenue_snapshots
// ============================================================

export const refundStatusEnum = pgEnum('refund_status', [
  'requested', 'pending_approval', 'approved', 'rejected', 'processed', 'cancelled',
]);

export const refundReasonEnum = pgEnum('refund_reason', [
  'excess_deposit', 'insurance_settlement', 'billing_error',
  'cancelled_procedure', 'patient_request', 'duplicate_payment', 'other',
]);

// ============================================================
// REFUND REQUESTS (tiered approval chain)
// ============================================================

export const refundRequests = pgTable('refund_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('rr_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('rr_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  account_id: uuid('rr_account_id').references(() => billingAccounts.id, { onDelete: 'set null' }),
  claim_id: uuid('rr_claim_id').references(() => insuranceClaims.id, { onDelete: 'set null' }),

  refund_number: varchar('refund_number', { length: 50 }),
  status: refundStatusEnum('rr_status').default('requested').notNull(),
  reason: refundReasonEnum('rr_reason').notNull(),
  reason_detail: text('rr_reason_detail'),

  amount: numeric('rr_amount', { precision: 14, scale: 2 }).notNull(),
  approved_amount: numeric('rr_approved_amount', { precision: 14, scale: 2 }),

  // Tiered approval (from billing_config refund_tier_1..4)
  approval_tier: integer('approval_tier'),
  approved_by: uuid('rr_approved_by').references(() => users.id, { onDelete: 'set null' }),
  approved_at: timestamp('rr_approved_at'),
  rejection_reason: text('rr_rejection_reason'),

  // Payment details
  payment_method: varchar('rr_payment_method', { length: 30 }),
  payment_reference: varchar('rr_payment_reference', { length: 100 }),
  processed_at: timestamp('rr_processed_at'),

  requested_by: uuid('rr_requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('rr_created_at').defaultNow().notNull(),
  updated_at: timestamp('rr_updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_rr_patient').on(t.patient_id),
  hospitalIdx: index('idx_rr_hospital').on(t.hospital_id),
  statusIdx: index('idx_rr_status').on(t.status),
  refundNumberIdx: uniqueIndex('idx_rr_number').on(t.hospital_id, t.refund_number),
}));

// ============================================================
// REVENUE SNAPSHOTS (daily aggregates for dashboard)
// ============================================================

export const revenueSnapshots = pgTable('revenue_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  snapshot_date: timestamp('snapshot_date').notNull(),

  // Daily totals
  total_charges: numeric('rs_total_charges', { precision: 14, scale: 2 }).default('0'),
  total_collections: numeric('rs_total_collections', { precision: 14, scale: 2 }).default('0'),
  total_deposits: numeric('rs_total_deposits', { precision: 14, scale: 2 }).default('0'),
  total_refunds: numeric('rs_total_refunds', { precision: 14, scale: 2 }).default('0'),
  net_revenue: numeric('net_revenue', { precision: 14, scale: 2 }).default('0'),

  // Insurance metrics
  claims_submitted: integer('claims_submitted').default(0),
  claims_approved: integer('claims_approved').default(0),
  pre_auth_approved: integer('rs_pre_auth_approved').default(0),
  total_approved_amount: numeric('rs_total_approved_amt', { precision: 14, scale: 2 }).default('0'),
  total_deductions: numeric('rs_total_deductions', { precision: 14, scale: 2 }).default('0'),
  deduction_percentage: numeric('deduction_pct', { precision: 5, scale: 2 }).default('0'),

  // Occupancy & billing
  occupied_beds: integer('occupied_beds').default(0),
  total_beds: integer('rs_total_beds').default(0),
  avg_bill_per_patient: numeric('avg_bill_per_patient', { precision: 12, scale: 2 }).default('0'),
  avg_los_days: numeric('avg_los_days', { precision: 5, scale: 1 }).default('0'),

  // Outstanding
  total_outstanding: numeric('total_outstanding', { precision: 14, scale: 2 }).default('0'),
  insurance_outstanding: numeric('insurance_outstanding', { precision: 14, scale: 2 }).default('0'),
  patient_outstanding: numeric('patient_outstanding', { precision: 14, scale: 2 }).default('0'),

  created_at: timestamp('rs_created_at').defaultNow().notNull(),
}, (t) => ({
  hospitalDateIdx: uniqueIndex('idx_rs_hospital_date').on(t.hospital_id, t.snapshot_date),
  dateIdx: index('idx_rs_date').on(t.snapshot_date),
}));
