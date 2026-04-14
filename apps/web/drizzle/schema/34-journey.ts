import {
  pgTable, text, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// ENUMS — Journey Engine
// ============================================================

export const journeyTypeEnum = pgEnum('journey_type', [
  'elective_surgical', 'emergency', 'day_care', 'medical',
]);

export const journeyPhaseEnum = pgEnum('journey_phase', [
  'PHASE_1_PRE_ADMISSION',
  'PHASE_2_ADMISSION',
  'PHASE_3_CLINICAL_ASSESSMENT',
  'PHASE_4_PRE_OP',
  'PHASE_5_INTRA_OP',
  'PHASE_6_POST_OP',
  'PHASE_7_WARD_CARE',
  'PHASE_8_DISCHARGE',
  'PHASE_9_BILLING_CLOSURE',
]);

export const journeyStepStatusEnum = pgEnum('journey_step_status', [
  'pending', 'in_progress', 'completed', 'blocked', 'skipped', 'not_applicable',
]);

export const journeyNotificationTypeEnum = pgEnum('journey_notification_type', [
  'step_assigned', 'step_completed', 'tat_warning', 'tat_exceeded', 'escalation',
]);

// ============================================================
// JOURNEY TEMPLATES
// Defines the step sequence for each journey type.
// Seeded once, hospital-specific. Each row = one step definition.
// ============================================================

export const journeyTemplates = pgTable('journey_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  journey_type: journeyTypeEnum('journey_type').notNull(),
  phase: journeyPhaseEnum('phase').notNull(),
  step_number: text('step_number').notNull(),             // e.g., '1.1', '2.5', '8.4'
  step_name: text('step_name').notNull(),                 // e.g., 'Financial Counselling Call'
  step_description: text('step_description'),             // Detailed description of what happens
  owner_role: text('owner_role').notNull(),                // Role from userRoleEnum that owns this step
  tat_target_mins: integer('tat_target_mins'),            // Target time to complete (minutes)
  preconditions: jsonb('preconditions'),                  // What must be true before step can start
  is_required: boolean('is_required').notNull().default(true),
  is_auto_advance: boolean('is_auto_advance').notNull().default(false), // Does completing this auto-start next?
  sort_order: integer('sort_order').notNull(),             // Global sort order across all phases
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_journey_templates_hospital').on(table.hospital_id),
  typeIdx: index('idx_journey_templates_type').on(table.journey_type),
  phaseIdx: index('idx_journey_templates_phase').on(table.phase),
  sortIdx: index('idx_journey_templates_sort').on(table.hospital_id, table.journey_type, table.sort_order),
}));

// ============================================================
// PATIENT JOURNEY STEPS
// One row per step per patient encounter. Instantiated from templates
// when a journey starts. Tracks actual completion state.
// ============================================================

export const patientJourneySteps = pgTable('patient_journey_steps', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }), // nullable: pre-admission steps have no encounter yet
  template_step_id: uuid('template_step_id').references(() => journeyTemplates.id, { onDelete: 'set null' }),
  phase: journeyPhaseEnum('phase').notNull(),
  step_number: text('step_number').notNull(),
  step_name: text('step_name').notNull(),
  status: journeyStepStatusEnum('status').notNull().default('pending'),
  owner_role: text('owner_role').notNull(),
  owner_user_id: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }), // Specific assigned user (nullable = role-based)
  tat_target_mins: integer('tat_target_mins'),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  completed_by: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
  tat_actual_mins: integer('tat_actual_mins'),            // Computed on completion
  blocked_reason: text('blocked_reason'),
  skipped_reason: text('skipped_reason'),
  step_data: jsonb('step_data'),                          // Step-specific form data, selections, notes
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_pjs_hospital').on(table.hospital_id),
  patientIdx: index('idx_pjs_patient').on(table.patient_id),
  encounterIdx: index('idx_pjs_encounter').on(table.encounter_id),
  statusIdx: index('idx_pjs_status').on(table.status),
  ownerRoleIdx: index('idx_pjs_owner_role').on(table.owner_role),
  ownerUserIdx: index('idx_pjs_owner_user').on(table.owner_user_id),
  phaseStepIdx: index('idx_pjs_phase_step').on(table.hospital_id, table.patient_id, table.phase, table.step_number),
}));

// ============================================================
// JOURNEY NOTIFICATIONS
// In-app notifications replacing Slack/WhatsApp for handoffs.
// Created by the step engine on step completion/assignment.
// ============================================================

export const journeyNotifications = pgTable('journey_notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  step_number: text('step_number').notNull(),
  step_name: text('step_name').notNull(),
  recipient_user_id: uuid('recipient_user_id').references(() => users.id, { onDelete: 'cascade' }),
  recipient_role: text('recipient_role'),                 // Fallback: notify all users with this role
  notification_type: journeyNotificationTypeEnum('notification_type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  read_at: timestamp('read_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_jn_hospital').on(table.hospital_id),
  recipientIdx: index('idx_jn_recipient').on(table.recipient_user_id),
  recipientRoleIdx: index('idx_jn_recipient_role').on(table.recipient_role),
  unreadIdx: index('idx_jn_unread').on(table.recipient_user_id, table.read_at),
  patientIdx: index('idx_jn_patient').on(table.patient_id),
}));

// ============================================================
// JOURNEY ESCALATIONS
// Auto-created when step exceeds TAT target. Tracks escalation chain.
// ============================================================

export const journeyEscalations = pgTable('journey_escalations', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  step_number: text('step_number').notNull(),
  step_name: text('step_name').notNull(),
  step_id: uuid('step_id').references(() => patientJourneySteps.id, { onDelete: 'cascade' }),
  escalation_level: integer('escalation_level').notNull().default(1), // 1=first alert, 2=supervisor, 3=GM
  escalated_to_role: text('escalated_to_role').notNull(),
  escalated_to_user_id: uuid('escalated_to_user_id').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(),                       // 'TAT exceeded: 45 min target, 68 min actual'
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  resolved_by: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_je_hospital').on(table.hospital_id),
  patientIdx: index('idx_je_patient').on(table.patient_id),
  stepIdx: index('idx_je_step').on(table.step_id),
  unresolvedIdx: index('idx_je_unresolved').on(table.hospital_id, table.resolved_at),
}));
