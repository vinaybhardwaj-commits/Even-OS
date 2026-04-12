import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, numeric,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients } from './03-registration';
import { labOrders, labResults } from './13-lab-radiology';

// ============================================================
// ENUMS — Critical Value Communication (Module 8 — LIS)
// ============================================================

export const criticalAlertStatusEnum = pgEnum('critical_alert_status', [
  'pending',         // Alert detected, not yet sent
  'sent',            // Notifications dispatched
  'acknowledged',    // Clinician acknowledged
  'read_back_done',  // Read-back confirmed
  'released',        // Result released to EHR
  'escalated_l1',    // 15-min timeout → MOD notified
  'escalated_l2',    // 30-min timeout → MD notified
  'escalated_l3',    // 45-min timeout → Hospital Director notified
  'expired',         // Never acknowledged (audit flag)
]);

export const alertMethodEnum = pgEnum('alert_method', [
  'push',    // In-app push notification
  'sms',     // SMS fallback
  'call',    // Phone call (future)
  'in_app',  // In-app modal
]);

export const ackMethodEnum = pgEnum('ack_method', [
  'pin',        // PIN entry
  'password',   // Password
  'biometric',  // Future: fingerprint/face
]);

export const resultVerificationActionEnum = pgEnum('result_verification_action', [
  'accept',
  'reject',
  'flag',
]);

// ============================================================
// CRITICAL VALUE ALERTS (immutable audit trail)
// ============================================================

export const criticalValueAlerts = pgTable('critical_value_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  // Source
  lab_order_id: uuid('cva_lab_order_id').notNull().references(() => labOrders.id, { onDelete: 'restrict' }),
  lab_result_id: uuid('cva_lab_result_id').notNull().references(() => labResults.id, { onDelete: 'restrict' }),
  patient_id: uuid('cva_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  // What was critical
  test_code: varchar('cva_test_code', { length: 30 }).notNull(),
  test_name: text('cva_test_name').notNull(),
  value_numeric: numeric('cva_value_numeric', { precision: 12, scale: 4 }),
  value_text: text('cva_value_text'),
  unit: varchar('cva_unit', { length: 30 }),
  critical_low: numeric('cva_critical_low', { precision: 12, scale: 4 }),
  critical_high: numeric('cva_critical_high', { precision: 12, scale: 4 }),
  flag: varchar('cva_flag', { length: 20 }).notNull(),  // critical_low or critical_high

  // Alert dispatch
  status: criticalAlertStatusEnum('cva_status').default('pending').notNull(),
  alert_sent_at: timestamp('cva_alert_sent_at'),
  alert_method: alertMethodEnum('cva_alert_method'),
  alert_sent_to: jsonb('cva_alert_sent_to').$type<string[]>(),  // user IDs of recipients

  // Acknowledgment
  ack_at: timestamp('cva_ack_at'),
  ack_by: uuid('cva_ack_by').references(() => users.id, { onDelete: 'set null' }),
  ack_method: ackMethodEnum('cva_ack_method'),

  // Read-back confirmation
  read_back_text: text('cva_read_back_text'),           // What clinician read back
  read_back_value: numeric('cva_read_back_value', { precision: 12, scale: 4 }),
  read_back_matched: boolean('cva_read_back_matched'),   // Within 0.5% tolerance
  read_back_at: timestamp('cva_read_back_at'),

  // Escalation chain
  escalation_chain: jsonb('cva_escalation_chain').$type<Array<{
    level: number;
    role: string;
    user_id: string;
    escalated_at: string;
    acknowledged_at: string | null;
  }>>(),

  // Release
  released_at: timestamp('cva_released_at'),
  released_by: uuid('cva_released_by').references(() => users.id, { onDelete: 'set null' }),

  // Context
  ordering_clinician_id: uuid('cva_ordering_clinician_id').references(() => users.id, { onDelete: 'set null' }),
  ward: varchar('cva_ward', { length: 50 }),
  notes: text('cva_notes'),

  // Timestamps
  created_at: timestamp('cva_created_at').defaultNow().notNull(),
  updated_at: timestamp('cva_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_cva_hospital').on(t.hospital_id),
  patientIdx: index('idx_cva_patient').on(t.patient_id),
  orderIdx: index('idx_cva_order').on(t.lab_order_id),
  resultIdx: index('idx_cva_result').on(t.lab_result_id),
  statusIdx: index('idx_cva_status').on(t.status),
  createdIdx: index('idx_cva_created').on(t.created_at),
  ackByIdx: index('idx_cva_ack_by').on(t.ack_by),
}));

// ============================================================
// RESULT VERIFICATIONS (accept/reject/flag audit trail)
// ============================================================

export const resultVerifications = pgTable('result_verifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  lab_order_id: uuid('rv_lab_order_id').notNull().references(() => labOrders.id, { onDelete: 'restrict' }),
  lab_result_id: uuid('rv_lab_result_id').notNull().references(() => labResults.id, { onDelete: 'restrict' }),

  action: resultVerificationActionEnum('rv_action').notNull(),
  comment: text('rv_comment'),
  rejection_reason: text('rv_rejection_reason'),

  verified_by: uuid('rv_verified_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  verified_at: timestamp('rv_verified_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_rv_hospital').on(t.hospital_id),
  orderIdx: index('idx_rv_order').on(t.lab_order_id),
  resultIdx: index('idx_rv_result').on(t.lab_result_id),
  verifiedByIdx: index('idx_rv_verified_by').on(t.verified_by),
}));
