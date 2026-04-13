import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb, numeric,
  uuid, pgEnum, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { paymentMethodEnum } from './04-clinical';

// ============================================================
// ENUMS
// ============================================================

export const notificationMethodEnum = pgEnum('notification_method', ['sms', 'email', 'push']);
export const delegationRelationshipEnum = pgEnum('delegation_relationship', ['spouse', 'child', 'parent', 'sibling', 'poa', 'other']);
export const delegationStatusEnum = pgEnum('delegation_status', ['invited', 'active', 'revoked']);
export const feedbackTypeEnum = pgEnum('feedback_type', ['csat', 'nps', 'department', 'anonymous']);
export const paymentStatusEnum = pgEnum('payment_status', ['initiated', 'processing', 'success', 'failed', 'refunded']);
export const preAdmissionFormTypeEnum = pgEnum('pre_admission_form_type', ['medical_history', 'consent', 'insurance', 'emergency_contact', 'demographics']);
export const preAdmissionFormStatusEnum = pgEnum('pre_admission_form_status', ['draft', 'submitted', 'verified', 'expired']);
export const medicationRefillStatusEnum = pgEnum('medication_refill_status', ['requested', 'pharmacy_review', 'approved', 'denied', 'picked_up']);
export const postDischargeTaskTypeEnum = pgEnum('post_discharge_task_type', ['medication_reminder', 'appointment_followup', 'lab_reminder', 'red_flag_check', 'rehab_exercise']);
export const postDischargeTaskStatusEnum = pgEnum('post_discharge_task_status', ['pending', 'completed', 'snoozed', 'dismissed', 'escalated']);
export const patientPortalActionEnum = pgEnum('patient_portal_action', [
  'login', 'viewed_bill', 'viewed_result', 'initiated_payment', 'completed_payment',
  'downloaded_form', 'added_guardian', 'revoked_guardian', 'submitted_feedback', 'requested_refill',
]);

// ============================================================
// PATIENT_PORTAL_PREFERENCES
// ============================================================

export const patientPortalPreferences = pgTable('patient_portal_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  patient_id: uuid('patient_id').notNull(),
  language: text('language').notNull().default('en'),
  notification_sms: boolean('notification_sms').notNull().default(true),
  notification_email: boolean('notification_email').notNull().default(true),
  notification_push: boolean('notification_push').notNull().default(false),
  preferred_contact_method: notificationMethodEnum('preferred_contact_method').notNull().default('sms'),
  two_factor_enabled: boolean('two_factor_enabled').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: uniqueIndex('idx_patient_portal_pref_patient').on(table.patient_id),
}));

// ============================================================
// DELEGATED_USERS
// ============================================================

export const delegatedUsers = pgTable('delegated_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  patient_id: uuid('patient_id').notNull(),
  delegated_user_name: text('delegated_user_name').notNull(),
  delegated_user_phone: text('delegated_user_phone').notNull(),
  delegated_user_email: text('delegated_user_email'),
  relationship: delegationRelationshipEnum('relationship').notNull(),
  can_view_bills: boolean('can_view_bills').notNull().default(true),
  can_pay_bills: boolean('can_pay_bills').notNull().default(false),
  can_view_results: boolean('can_view_results').notNull().default(true),
  can_schedule_appointments: boolean('can_schedule_appointments').notNull().default(false),
  can_view_medical_records: boolean('can_view_medical_records').notNull().default(false),
  invited_at: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
  confirmed_at: timestamp('confirmed_at', { withTimezone: true }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  status: delegationStatusEnum('status').notNull().default('invited'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: index('idx_delegated_users_patient').on(table.patient_id),
  statusIdx: index('idx_delegated_users_status').on(table.status),
}));

// ============================================================
// PATIENT_FEEDBACK
// ============================================================

export const patientFeedback = pgTable('patient_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  patient_id: uuid('patient_id'),
  encounter_id: uuid('encounter_id'),
  feedback_type: feedbackTypeEnum('feedback_type').notNull(),
  department: text('department'),
  clinician_name: text('clinician_name'),
  rating_score: integer('rating_score'),
  nps_score: integer('nps_score'),
  feedback_text: text('feedback_text'),
  is_anonymous: boolean('is_anonymous').notNull().default(false),
  department_response: text('department_response'),
  responded_by: text('responded_by'),
  responded_at: timestamp('responded_at', { withTimezone: true }),
  escalated: boolean('escalated').notNull().default(false),
  escalated_at: timestamp('escalated_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: index('idx_patient_feedback_patient').on(table.patient_id),
  encounterIdIdx: index('idx_patient_feedback_encounter').on(table.encounter_id),
  typeIdx: index('idx_patient_feedback_type').on(table.feedback_type),
  escalatedIdx: index('idx_patient_feedback_escalated').on(table.escalated),
}));

// ============================================================
// PATIENT_PAYMENTS
// ============================================================

export const patientPayments = pgTable('patient_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  bill_id: uuid('bill_id'),
  patient_id: uuid('patient_id').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  payment_method: paymentMethodEnum('payment_method').notNull(),
  payment_reference: text('payment_reference'),
  gateway_reference: text('gateway_reference'),
  gateway_provider: text('gateway_provider').notNull().default('razorpay'),
  status: paymentStatusEnum('status').notNull(),
  failure_reason: text('failure_reason'),
  receipt_url: text('receipt_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: index('idx_patient_payments_patient').on(table.patient_id),
  billIdIdx: index('idx_patient_payments_bill').on(table.bill_id),
  statusIdx: index('idx_patient_payments_status').on(table.status),
}));

// ============================================================
// PRE_ADMISSION_FORMS
// ============================================================

export const preAdmissionForms = pgTable('pre_admission_forms', {
  id: uuid('id').defaultRandom().primaryKey(),
  patient_id: uuid('patient_id').notNull(),
  encounter_id: uuid('encounter_id'),
  form_type: preAdmissionFormTypeEnum('form_type').notNull(),
  form_data: jsonb('form_data').notNull().default('{}'),
  form_version: integer('form_version').notNull().default(1),
  signed_by: text('signed_by'),
  signed_at: timestamp('signed_at', { withTimezone: true }),
  consent_acknowledged: boolean('consent_acknowledged').notNull().default(false),
  status: preAdmissionFormStatusEnum('status').notNull().default('draft'),
  verified_by: text('verified_by'),
  verified_at: timestamp('verified_at', { withTimezone: true }),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: index('idx_pre_admission_forms_patient').on(table.patient_id),
  encounterIdIdx: index('idx_pre_admission_forms_encounter').on(table.encounter_id),
  statusIdx: index('idx_pre_admission_forms_status').on(table.status),
  typeIdx: index('idx_pre_admission_forms_type').on(table.form_type),
}));

// ============================================================
// MEDICATION_REFILL_REQUESTS
// ============================================================

export const medicationRefillRequests = pgTable('medication_refill_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  patient_id: uuid('patient_id').notNull(),
  medication_name: text('medication_name').notNull(),
  medication_dose: text('medication_dose'),
  medication_frequency: text('medication_frequency'),
  prescription_id: uuid('prescription_id'),
  status: medicationRefillStatusEnum('status').notNull().default('requested'),
  pharmacy_feedback: text('pharmacy_feedback'),
  pickup_location: text('pickup_location'),
  pickup_ready_at: timestamp('pickup_ready_at', { withTimezone: true }),
  requested_at: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  reviewed_by: text('reviewed_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: index('idx_medication_refill_patient').on(table.patient_id),
  statusIdx: index('idx_medication_refill_status').on(table.status),
}));

// ============================================================
// POST_DISCHARGE_TASKS
// ============================================================

export const postDischargeTasks = pgTable('post_discharge_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  encounter_id: uuid('encounter_id'),
  patient_id: uuid('patient_id').notNull(),
  task_type: postDischargeTaskTypeEnum('task_type').notNull(),
  task_title: text('task_title').notNull(),
  task_data: jsonb('task_data').notNull().default('{}'),
  status: postDischargeTaskStatusEnum('status').notNull().default('pending'),
  next_due_at: timestamp('next_due_at', { withTimezone: true }),
  last_reminded_at: timestamp('last_reminded_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  escalated_at: timestamp('escalated_at', { withTimezone: true }),
  escalation_reason: text('escalation_reason'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: index('idx_post_discharge_tasks_patient').on(table.patient_id),
  encounterIdIdx: index('idx_post_discharge_tasks_encounter').on(table.encounter_id),
  statusIdx: index('idx_post_discharge_tasks_status').on(table.status),
  typeIdx: index('idx_post_discharge_tasks_type').on(table.task_type),
}));

// ============================================================
// PATIENT_PORTAL_AUDIT_LOG
// ============================================================

export const patientPortalAuditLog = pgTable('patient_portal_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  patient_id: uuid('patient_id'),
  delegated_user_id: uuid('delegated_user_id'),
  action: patientPortalActionEnum('action').notNull(),
  resource_type: text('resource_type'),
  resource_id: text('resource_id'),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  patientIdIdx: index('idx_patient_portal_audit_log_patient').on(table.patient_id),
  actionIdx: index('idx_patient_portal_audit_log_action').on(table.action),
  createdAtIdx: index('idx_patient_portal_audit_log_created_at').on(table.created_at),
}));
