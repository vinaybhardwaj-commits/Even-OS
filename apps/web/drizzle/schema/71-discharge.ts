import {
  pgTable, text, uuid, integer, timestamp, jsonb,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { encounters } from './03-registration';
import { bills } from './70-bills';

// =============================================================================
// BV3 PHASE 4 — Discharge billing closure (Q10 — 6-step orchestration)
// =============================================================================
// Idempotent + resumable orchestration. Each step writes a row in
// discharge_billing_steps with status (pending / in_progress / complete /
// error). Re-runs check status; skip completed; resume from interrupted.
// Server-side gates: cannot start step N+1 unless step N is 'complete'.
//
// 6 steps:
//   1. charge_reconciliation — read charge_items for encounter; flag missing emits
//   2. bill_build              — Q3 rule engine fires; bill state → pending_review
//   3. settlement_presentation — bill PDF on tablet; patient/family acknowledge
//   4. payment_collection      — patient pays balance OR claim filed
//   5. document_pack           — discharge summary + bill + diagnostics + OT/implant
//                                (DEFERRED to a later phase per Phase 4 A5)
//   6. bill_close              — bill state → settled or pending_settlement
// =============================================================================

export const DISCHARGE_STEPS = [
  'charge_reconciliation',
  'bill_build',
  'settlement_presentation',
  'payment_collection',
  'document_pack',
  'bill_close',
] as const;
export type DischargeStep = typeof DISCHARGE_STEPS[number];

export const DISCHARGE_STEP_STATUSES = ['pending', 'in_progress', 'complete', 'error', 'skipped'] as const;
export type DischargeStepStatus = typeof DISCHARGE_STEP_STATUSES[number];


// ---------- 1. discharge_billing_steps — per-step status tracking ----------

export const dischargeBillingSteps = pgTable('discharge_billing_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'cascade' }),
  /** Optional FK to the bill this orchestration is closing. Set by step 2. */
  bill_id: uuid('bill_id').references(() => bills.id, { onDelete: 'set null' }),
  /** Step name. CHECK enum enforced. */
  step: text('step').notNull(),
  /** Status. CHECK enum enforced. */
  status: text('status').notNull().default('pending'),
  /** Step output / error detail. */
  result: jsonb('result'),
  error_message: text('error_message'),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  /** Number of times this step has been re-attempted. */
  attempts: integer('attempts').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Each (encounter, step) is unique — one step row per orchestration
  encounterStepIdx: uniqueIndex('idx_discharge_billing_steps_encounter_step').on(t.encounter_id, t.step),
  encounterIdx: index('idx_discharge_billing_steps_encounter').on(t.encounter_id),
  statusIdx: index('idx_discharge_billing_steps_status').on(t.status),
  billIdx: index('idx_discharge_billing_steps_bill').on(t.bill_id),
}));

export type DischargeBillingStep = typeof dischargeBillingSteps.$inferSelect;


// ---------- 2. discharge_billing_audit — fine-grained who/when/what ----------

export const dischargeBillingAudit = pgTable('discharge_billing_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'cascade' }),
  step: text('step').notNull(),
  action: text('action').notNull(), // 'start' / 'advance' / 'complete' / 'error' / 'reset'
  actor_user_id: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  actor_role: text('actor_role'),
  notes: text('notes'),
  details: jsonb('details'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  encounterIdx: index('idx_discharge_billing_audit_encounter').on(t.encounter_id),
  hospitalCreatedIdx: index('idx_discharge_billing_audit_hospital_created').on(t.hospital_id, t.created_at),
}));

export type DischargeBillingAudit = typeof dischargeBillingAudit.$inferSelect;
