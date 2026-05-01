import {
  pgTable, text, uuid, integer, numeric, timestamp, boolean, jsonb,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';
import { billingAccounts } from './09-billing';
import { chargeItems } from './62-billing-v3';

// =============================================================================
// BV3 PHASE 4 — Bills + Bill State History + Bill Lines (snapshot)
// =============================================================================
// Per Q4 lock — 6-state machine:
//   draft → pending_review → finalized → settled → closed → archived
//   amendment branch: finalized → reversed (via reverseAndReissue) +
//                     new bill in draft with replaces_bill_id
//
// Bills aggregate charge_items by category. At `finalized` transition the
// charge_items become locked (status='posted' immutable per Q1) and a
// bill_lines snapshot is frozen for the bill PDF + auditing.
//
// Concession + approval (per Q8):
//   Self-cashier limit = 5% (default per charge_master_hospital_setting)
//   GM limit          = 20% (default)
//   > GM limit         = CFO approval required
// =============================================================================

// ---------- 1. bills — bill-level metadata + state ----------

export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  /** Hospital-scoped sequential bill number (e.g. BILL-EHRC-2026-000123). */
  bill_number: text('bill_number').notNull(),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  billing_account_id: uuid('billing_account_id').notNull().references(() => billingAccounts.id, { onDelete: 'cascade' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  /**
   * State CHECK enum: draft | pending_review | finalized | settled | closed | archived
   * Server-side enforced via bill-state-machine.ts (no SQL trigger).
   */
  state: text('state').notNull().default('draft'),

  // ── Aggregated totals (re-computed on transition; frozen at finalized) ──
  /** Sum of charge_items.line_total before concession (excl GST already applied per-line). */
  subtotal_inr: numeric('subtotal_inr', { precision: 14, scale: 2 }).notNull().default('0'),
  /** Sum of charge_items.gst_amount. */
  gst_amount_inr: numeric('gst_amount_inr', { precision: 14, scale: 2 }).notNull().default('0'),
  /** Concession amount applied. */
  concession_amount_inr: numeric('concession_amount_inr', { precision: 14, scale: 2 }).notNull().default('0'),
  /** Concession reason (free-form). */
  concession_reason: text('concession_reason'),
  /**
   * Concession approval level required: 'self' | 'gm' | 'cfo' | null (none).
   * Set by applyConcession when amount exceeds self limit.
   */
  concession_approval_level: text('concession_approval_level'),
  /** True iff finalize is gated on out-of-band approval workflow. */
  approval_required: boolean('approval_required').notNull().default(false),
  /** UUID of approver who unlocked finalize (when applicable). */
  approved_by: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approved_at: timestamp('approved_at', { withTimezone: true }),

  /** Final billable amount = subtotal + gst - concession. */
  total_amount_inr: numeric('total_amount_inr', { precision: 14, scale: 2 }).notNull().default('0'),

  /**
   * Amendment chain: when a finalized bill is reversed-and-reissued, the
   * NEW bill carries replaces_bill_id pointing back to the original.
   * Original bill gets `amended=true` flag.
   */
  replaces_bill_id: uuid('replaces_bill_id'),
  amended: boolean('amended').notNull().default(false),
  amended_count: integer('amended_count').notNull().default(0),

  /** Timestamps for state transitions (also logged in bill_state_history). */
  finalized_at: timestamp('finalized_at', { withTimezone: true }),
  settled_at: timestamp('settled_at', { withTimezone: true }),
  closed_at: timestamp('closed_at', { withTimezone: true }),
  archived_at: timestamp('archived_at', { withTimezone: true }),

  /** Audit. */
  created_by: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  billNumberHospitalIdx: uniqueIndex('idx_bills_number_hospital').on(t.hospital_id, t.bill_number),
  encounterIdx: index('idx_bills_encounter').on(t.encounter_id),
  billingAccountIdx: index('idx_bills_billing_account').on(t.billing_account_id),
  patientIdx: index('idx_bills_patient').on(t.patient_id),
  stateIdx: index('idx_bills_state').on(t.state),
  hospitalCreatedIdx: index('idx_bills_hospital_created').on(t.hospital_id, t.created_at),
  replacesIdx: index('idx_bills_replaces').on(t.replaces_bill_id),
}));

export type Bill = typeof bills.$inferSelect;
export type NewBill = typeof bills.$inferInsert;


// ---------- 2. bill_state_history — every transition audit-logged ----------

export const billStateHistory = pgTable('bill_state_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  bill_id: uuid('bill_id').notNull().references(() => bills.id, { onDelete: 'cascade' }),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  from_state: text('from_state').notNull(),
  to_state: text('to_state').notNull(),
  /** Action verb: send_for_review / finalize / settle_payment / close / archive / reverse / reissue. */
  action: text('action').notNull(),
  actor_user_id: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actor_role: text('actor_role').notNull(),
  reason: text('reason'),
  /** Snapshot of relevant amounts/flags at the moment of transition. */
  snapshot: jsonb('snapshot'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  billIdx: index('idx_bill_state_history_bill').on(t.bill_id),
  hospitalCreatedIdx: index('idx_bill_state_history_hospital_created').on(t.hospital_id, t.created_at),
}));

export type BillStateHistory = typeof billStateHistory.$inferSelect;


// ---------- 3. bill_lines — snapshot frozen at finalized ----------

export const billLines = pgTable('bill_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  bill_id: uuid('bill_id').notNull().references(() => bills.id, { onDelete: 'cascade' }),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  /** FK back to source charge_items row. */
  charge_item_id: uuid('charge_item_id').references(() => chargeItems.id, { onDelete: 'restrict' }),
  /** Aggregation category for grouping on the bill PDF. */
  category: text('category').notNull(),
  /** Display label shown to patient. */
  display_name: text('display_name').notNull(),
  charge_code: text('charge_code'),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
  unit_price_inr: numeric('unit_price_inr', { precision: 14, scale: 2 }).notNull(),
  line_total_inr: numeric('line_total_inr', { precision: 14, scale: 2 }).notNull(),
  gst_percentage: numeric('gst_percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  gst_amount_inr: numeric('gst_amount_inr', { precision: 14, scale: 2 }).notNull().default('0'),
  /** Display order on the bill (set by aggregator). */
  display_order: integer('display_order').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  billIdx: index('idx_bill_lines_bill').on(t.bill_id),
  categoryIdx: index('idx_bill_lines_category').on(t.category),
  chargeItemIdx: index('idx_bill_lines_charge_item').on(t.charge_item_id),
}));

export type BillLine = typeof billLines.$inferSelect;
export type NewBillLine = typeof billLines.$inferInsert;


// ---------- Constants ----------

export const BILL_STATES = ['draft', 'pending_review', 'finalized', 'settled', 'closed', 'archived'] as const;
export type BillState = typeof BILL_STATES[number];

export const BILL_TRANSITION_ACTIONS = [
  'send_for_review', 'finalize', 'settle_payment', 'close', 'archive', 'reverse', 'reissue',
] as const;
export type BillTransitionAction = typeof BILL_TRANSITION_ACTIONS[number];

export const CONCESSION_APPROVAL_LEVELS = ['self', 'gm', 'cfo'] as const;
export type ConcessionApprovalLevel = typeof CONCESSION_APPROVAL_LEVELS[number];
