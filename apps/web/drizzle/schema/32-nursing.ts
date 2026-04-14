import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex, jsonb, pgEnum, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { hospitals, users } from './00-foundations';
import { patients, encounters, locations } from './03-registration';
import { shiftInstances } from './31-shifts';

// ============================================================
// NURSING — NS.1: Patient Assignments, Shift Handoffs,
//   Nursing Assessments
// 3 tables + 4 enums
// ============================================================

// ── Enums ──────────────────────────────────────────────────────────────────

export const assignmentStatusEnum = pgEnum('assignment_status', [
  'active', 'completed', 'transferred', 'cancelled',
]);

export const handoffStatusEnum = pgEnum('handoff_status', [
  'draft', 'submitted', 'acknowledged', 'flagged',
]);

export const handoffPriorityEnum = pgEnum('handoff_priority', [
  'routine', 'watch', 'critical',
]);

export const assessmentTypeEnum = pgEnum('nursing_assessment_type', [
  'admission', 'shift_start', 'routine', 'focused', 'discharge',
]);

// ── patient_assignments ──────────────────────────────────────────────────
// Maps a nurse → patient → shift. Charge nurse assigns patients at shift start.
// One patient can only be assigned to one nurse per shift instance.

export const patientAssignments = pgTable('patient_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  shift_instance_id: uuid('shift_instance_id').notNull().references(() => shiftInstances.id, { onDelete: 'cascade' }),
  nurse_id: uuid('nurse_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  ward_id: uuid('ward_id').notNull().references(() => locations.id, { onDelete: 'restrict' }),
  bed_label: text('bed_label'), // denormalized for display: "ICU-3B"
  status: assignmentStatusEnum('status').notNull().default('active'),
  assigned_by: uuid('assigned_by').notNull().references(() => users.id, { onDelete: 'restrict' }), // charge nurse or admin
  assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_patient_assignments_hospital').on(table.hospital_id),
  shiftIdx: index('idx_patient_assignments_shift').on(table.shift_instance_id),
  nurseIdx: index('idx_patient_assignments_nurse').on(table.nurse_id),
  patientIdx: index('idx_patient_assignments_patient').on(table.patient_id),
  encounterIdx: index('idx_patient_assignments_encounter').on(table.encounter_id),
  wardIdx: index('idx_patient_assignments_ward').on(table.ward_id),
  statusIdx: index('idx_patient_assignments_status').on(table.status),
  // One patient per nurse per shift (prevent double-assign)
  uniquePatientShift: uniqueIndex('idx_patient_assignments_unique_patient_shift')
    .on(table.shift_instance_id, table.patient_id),
}));

// ── shift_handoffs ───────────────────────────────────────────────────────
// SBAR-style handoff notes passed between shifts for continuity of care.
// One row per patient per outgoing shift.

export const shiftHandoffs = pgTable('shift_handoffs', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  outgoing_shift_id: uuid('outgoing_shift_id').notNull().references(() => shiftInstances.id, { onDelete: 'cascade' }),
  incoming_shift_id: uuid('incoming_shift_id').references(() => shiftInstances.id, { onDelete: 'set null' }),
  outgoing_nurse_id: uuid('outgoing_nurse_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  incoming_nurse_id: uuid('incoming_nurse_id').references(() => users.id, { onDelete: 'set null' }),
  // SBAR fields
  situation: text('situation'), // What's going on with the patient
  background: text('background'), // Relevant history/context
  assessment: text('assessment'), // Nurse's clinical assessment
  recommendation: text('recommendation'), // What needs to happen next
  priority: handoffPriorityEnum('priority').notNull().default('routine'),
  status: handoffStatusEnum('status').notNull().default('draft'),
  pending_tasks: jsonb('pending_tasks'), // [{task, due_by, priority}]
  acknowledged_at: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledged_by: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_shift_handoffs_hospital').on(table.hospital_id),
  patientIdx: index('idx_shift_handoffs_patient').on(table.patient_id),
  encounterIdx: index('idx_shift_handoffs_encounter').on(table.encounter_id),
  outgoingShiftIdx: index('idx_shift_handoffs_outgoing').on(table.outgoing_shift_id),
  incomingShiftIdx: index('idx_shift_handoffs_incoming').on(table.incoming_shift_id),
  outgoingNurseIdx: index('idx_shift_handoffs_outgoing_nurse').on(table.outgoing_nurse_id),
  statusIdx: index('idx_shift_handoffs_status').on(table.status),
  priorityIdx: index('idx_shift_handoffs_priority').on(table.priority),
  // One handoff per patient per outgoing shift
  uniqueHandoff: uniqueIndex('idx_shift_handoffs_unique')
    .on(table.outgoing_shift_id, table.patient_id),
}));

// ── nursing_assessments ──────────────────────────────────────────────────
// Structured nursing assessment entries (admission, routine, focused).
// Links to patient assignment for shift-scoped assessments.

export const nursingAssessments = pgTable('nursing_assessments', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('encounter_id').notNull().references(() => encounters.id, { onDelete: 'restrict' }),
  assignment_id: uuid('assignment_id').references(() => patientAssignments.id, { onDelete: 'set null' }),
  nurse_id: uuid('nurse_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  assessment_type: assessmentTypeEnum('assessment_type').notNull().default('routine'),
  // Structured assessment data
  pain_score: integer('pain_score'), // 0-10
  fall_risk_score: integer('fall_risk_score'), // Morse Fall Scale
  braden_score: integer('braden_score'), // Pressure ulcer risk
  mobility_status: text('mobility_status'), // ambulatory, assisted, bedbound
  diet_compliance: text('diet_compliance'),
  iv_site_status: text('iv_site_status'),
  wound_status: text('wound_status'),
  neuro_status: text('neuro_status'),
  notes: text('notes'),
  assessment_data: jsonb('assessment_data'), // Additional structured fields
  is_flagged: boolean('is_flagged').notNull().default(false),
  flag_reason: text('flag_reason'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_nursing_assessments_hospital').on(table.hospital_id),
  patientIdx: index('idx_nursing_assessments_patient').on(table.patient_id),
  encounterIdx: index('idx_nursing_assessments_encounter').on(table.encounter_id),
  assignmentIdx: index('idx_nursing_assessments_assignment').on(table.assignment_id),
  nurseIdx: index('idx_nursing_assessments_nurse').on(table.nurse_id),
  typeIdx: index('idx_nursing_assessments_type').on(table.assessment_type),
  flaggedIdx: index('idx_nursing_assessments_flagged').on(table.is_flagged),
  createdIdx: index('idx_nursing_assessments_created').on(table.created_at),
}));

// ── Relations ────────────────────────────────────────────────────────────

export const patientAssignmentsRelations = relations(patientAssignments, ({ one }) => ({
  shift: one(shiftInstances, { fields: [patientAssignments.shift_instance_id], references: [shiftInstances.id] }),
  nurse: one(users, { fields: [patientAssignments.nurse_id], references: [users.id], relationName: 'assignment_nurse' }),
  patient: one(patients, { fields: [patientAssignments.patient_id], references: [patients.id] }),
  encounter: one(encounters, { fields: [patientAssignments.encounter_id], references: [encounters.id] }),
  ward: one(locations, { fields: [patientAssignments.ward_id], references: [locations.id] }),
}));

export const shiftHandoffsRelations = relations(shiftHandoffs, ({ one }) => ({
  patient: one(patients, { fields: [shiftHandoffs.patient_id], references: [patients.id] }),
  encounter: one(encounters, { fields: [shiftHandoffs.encounter_id], references: [encounters.id] }),
  outgoingShift: one(shiftInstances, { fields: [shiftHandoffs.outgoing_shift_id], references: [shiftInstances.id], relationName: 'handoff_outgoing' }),
  incomingShift: one(shiftInstances, { fields: [shiftHandoffs.incoming_shift_id], references: [shiftInstances.id], relationName: 'handoff_incoming' }),
}));

export const nursingAssessmentsRelations = relations(nursingAssessments, ({ one }) => ({
  patient: one(patients, { fields: [nursingAssessments.patient_id], references: [patients.id] }),
  encounter: one(encounters, { fields: [nursingAssessments.encounter_id], references: [encounters.id] }),
  assignment: one(patientAssignments, { fields: [nursingAssessments.assignment_id], references: [patientAssignments.id] }),
}));
