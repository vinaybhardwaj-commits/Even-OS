import { pgTable, pgEnum, uuid, text, varchar, integer, boolean, timestamp, date, numeric, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';

// ═══════════════════════════════════════════════════════════════
// ENUMS — Safety Rounds, Audits & Complaints (S8d)
// ═══════════════════════════════════════════════════════════════

export const safetyRoundStatusEnum = pgEnum('safety_round_status', [
  'scheduled', 'in_progress', 'completed', 'cancelled',
]);

export const findingSeverityEnum = pgEnum('finding_severity', [
  'minor', 'major',
]);

export const findingStatusEnum = pgEnum('finding_status', [
  'open', 'in_progress', 'closed',
]);

export const auditTypeEnum = pgEnum('audit_type', [
  'concurrent', 'retrospective',
]);

export const auditStatusEnum = pgEnum('clinical_audit_status', [
  'scheduled', 'in_progress', 'completed',
]);

export const auditFindingStatusEnum = pgEnum('audit_finding_status', [
  'open', 'closed',
]);

export const complaintSeverityEnum = pgEnum('complaint_severity', [
  'minor', 'moderate', 'major',
]);

export const complaintStatusEnum = pgEnum('complaint_status', [
  'open', 'acknowledged', 'in_progress', 'resolved', 'escalated', 'closed',
]);

export const indicatorFrequencyEnum = pgEnum('indicator_frequency', [
  'daily', 'weekly', 'monthly', 'quarterly',
]);

export const indicatorDataSourceEnum = pgEnum('indicator_data_source', [
  'auto_computed', 'manual_entry', 'hybrid',
]);

export const definitionStatusEnum = pgEnum('definition_status', [
  'assumed', 'confirmed', 'not_applicable',
]);

// ═══════════════════════════════════════════════════════════════
// QUALITY INDICATOR DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export const qualityIndicatorDefinitions = pgTable('quality_indicator_definitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  indicatorId: varchar('qid_indicator_id', { length: 20 }).notNull(),
  indicatorName: varchar('indicator_name', { length: 255 }).notNull(),
  nabhChapter: varchar('qid_nabh_chapter', { length: 50 }),
  department: varchar('qid_department', { length: 100 }),
  numeratorQuery: text('numerator_query'),
  denominatorQuery: text('denominator_query'),
  targetValue: numeric('target_value', { precision: 10, scale: 2 }),
  frequency: indicatorFrequencyEnum('qid_frequency'),
  dataSource: indicatorDataSourceEnum('qid_data_source'),
  definitionStatus: definitionStatusEnum('definition_status').default('assumed'),
  definitionAuthoredByUserId: uuid('definition_authored_by_user_id'),
  definitionAuthoredAt: timestamp('definition_authored_at'),
  definitionConfirmedByUserId: uuid('definition_confirmed_by_user_id'),
  definitionConfirmedAt: timestamp('definition_confirmed_at'),
  notes: text('qid_notes'),
  createdAt: timestamp('qid_created_at').defaultNow().notNull(),
  updatedAt: timestamp('qid_updated_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// SAFETY ROUNDS
// ═══════════════════════════════════════════════════════════════

export const safetyRounds = pgTable('safety_rounds', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  department: varchar('sr_department', { length: 100 }),
  scheduledDate: timestamp('scheduled_date').notNull(),
  templateName: varchar('template_name', { length: 255 }),
  assignedToUserId: uuid('sr_assigned_to_user_id'),
  status: safetyRoundStatusEnum('sr_status').default('scheduled'),
  completedAt: timestamp('sr_completed_at'),
  completedByUserId: uuid('sr_completed_by_user_id'),
  notes: text('sr_notes'),
  createdAt: timestamp('sr_created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// SAFETY ROUND FINDINGS
// ═══════════════════════════════════════════════════════════════

export const safetyRoundFindings = pgTable('safety_round_findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  safetyRoundId: uuid('srf_safety_round_id').notNull(),
  checklistItem: varchar('checklist_item', { length: 255 }),
  findingDescription: text('finding_description').notNull(),
  severity: findingSeverityEnum('srf_severity'),
  photoAttachmentUrl: varchar('photo_attachment_url', { length: 512 }),
  responsibleUserId: uuid('srf_responsible_user_id'),
  assignedByUserId: uuid('srf_assigned_by_user_id'),
  targetClosureDate: date('target_closure_date'),
  status: findingStatusEnum('srf_status').default('open'),
  closureNotes: text('closure_notes'),
  closureEvidenceUrl: varchar('closure_evidence_url', { length: 512 }),
  closedAt: timestamp('srf_closed_at'),
  closedByUserId: uuid('srf_closed_by_user_id'),
  escalated: boolean('escalated').default(false),
  escalatedAt: timestamp('escalated_at'),
  createdAt: timestamp('srf_created_at').defaultNow().notNull(),
  updatedAt: timestamp('srf_updated_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// SAFETY ROUND TEMPLATES
// ═══════════════════════════════════════════════════════════════

export const safetyRoundTemplates = pgTable('safety_round_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  templateName: varchar('srt_template_name', { length: 255 }).notNull(),
  description: text('srt_description'),
  checklistItems: jsonb('checklist_items'), // JSON array of checklist items
  isActive: boolean('srt_is_active').default(true),
  createdAt: timestamp('srt_created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// CLINICAL AUDITS
// ═══════════════════════════════════════════════════════════════

export const clinicalAudits = pgTable('clinical_audits', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  nabhChapter: varchar('ca_nabh_chapter', { length: 50 }),
  auditType: auditTypeEnum('audit_type').notNull(),
  scheduledDate: timestamp('ca_scheduled_date').notNull(),
  sampleSize: integer('sample_size'),
  status: auditStatusEnum('ca_status').default('scheduled'),
  completedAt: timestamp('ca_completed_at'),
  complianceScore: numeric('compliance_score', { precision: 5, scale: 2 }),
  auditorUserId: uuid('auditor_user_id'),
  notes: text('ca_notes'),
  createdAt: timestamp('ca_created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// CLINICAL AUDIT FINDINGS
// ═══════════════════════════════════════════════════════════════

export const clinicalAuditFindings = pgTable('clinical_audit_findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  clinicalAuditId: uuid('caf_clinical_audit_id').notNull(),
  checklistItem: varchar('caf_checklist_item', { length: 255 }),
  findingDescription: text('caf_finding_description').notNull(),
  severity: findingSeverityEnum('caf_severity'),
  responsibleUserId: uuid('caf_responsible_user_id'),
  assignedAt: timestamp('caf_assigned_at'),
  targetClosureDate: date('caf_target_closure_date'),
  status: auditFindingStatusEnum('caf_status').default('open'),
  closedAt: timestamp('caf_closed_at'),
  closureNotes: text('caf_closure_notes'),
  createdAt: timestamp('caf_created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════
// SEWA COMPLAINTS
// ═══════════════════════════════════════════════════════════════

export const sewaComplaints = pgTable('sewa_complaints', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  patientId: uuid('sc_patient_id'),
  complaintId: varchar('complaint_id', { length: 50 }),
  complaintCategory: varchar('complaint_category', { length: 100 }),
  complaintDescription: text('complaint_description').notNull(),
  departmentInvolved: varchar('department_involved', { length: 100 }),
  staffMemberInvolvedName: varchar('staff_member_involved_name', { length: 255 }),
  incidentDate: timestamp('sc_incident_date'),
  severity: complaintSeverityEnum('sc_severity'),
  status: complaintStatusEnum('sc_status').default('open'),
  anonymous: boolean('sc_anonymous').default(false),
  submittedAt: timestamp('sc_submitted_at').defaultNow().notNull(),
  acknowledgementSlaDueAt: timestamp('acknowledgement_sla_due_at'),
  acknowledgedAt: timestamp('sc_acknowledged_at'),
  acknowledgementMessage: text('acknowledgement_message'),
  resolutionSlaDueAt: timestamp('resolution_sla_due_at'),
  resolvedAt: timestamp('sc_resolved_at'),
  resolutionMessage: text('resolution_message'),
  escalatedAt: timestamp('sc_escalated_at'),
  escalatedToUserId: uuid('escalated_to_user_id'),
  satisfactionSurveySent: boolean('satisfaction_survey_sent').default(false),
  satisfactionSurveyResponse: varchar('satisfaction_survey_response', { length: 50 }),
  satisfactionNotes: text('satisfaction_notes'),
  submittedByUserId: uuid('sc_submitted_by_user_id'),
  processedByUserId: uuid('sc_processed_by_user_id'),
  createdAt: timestamp('sc_created_at').defaultNow().notNull(),
  updatedAt: timestamp('sc_updated_at').defaultNow().notNull(),
});
