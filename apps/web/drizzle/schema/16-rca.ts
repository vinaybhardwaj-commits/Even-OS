import { pgTable, pgEnum, uuid, text, varchar, integer, boolean, timestamp, date, numeric, index } from 'drizzle-orm/pg-core';

// ═══════════════════════════════════════════════════════════════
// ENUMS — RCA (Module 13, Part 2: S8b)
// ═══════════════════════════════════════════════════════════════

export const rcaStatusEnum = pgEnum('rca_status', [
  'not_started', 'timeline_in_progress', 'timeline_complete',
  'fishbone_in_progress', 'fishbone_complete',
  'five_why_in_progress', 'five_why_complete',
  'draft_report', 'rca_complete',
]);

export const rcaTeamRoleEnum = pgEnum('rca_team_role', [
  'quality_head', 'department_head', 'clinical_expert',
  'pharmacy', 'nursing', 'admin', 'observer',
]);

export const fishboneCategoryEnum = pgEnum('fishbone_category', [
  'people', 'process', 'systems', 'environment', 'training', 'communication',
]);

export const capaTypeEnum = pgEnum('capa_type', [
  'corrective', 'preventive',
]);

export const capaStatusEnum = pgEnum('capa_status', [
  'planned', 'in_progress', 'implemented', 'pending_effectiveness_review',
  'effectiveness_verified', 'ineffective', 'closed',
]);

export const effectivenessReviewStatusEnum = pgEnum('effectiveness_review_status', [
  'pending', 'effective', 'ineffective',
]);

// ═══════════════════════════════════════════════════════════════
// RCA INVESTIGATIONS
// ═══════════════════════════════════════════════════════════════

export const rcaInvestigations = pgTable('rca_investigations', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  adverseEventId: uuid('adverse_event_id').notNull(),
  incidentType: varchar('rca_incident_type', { length: 50 }).notNull(),
  severity: varchar('rca_severity', { length: 50 }),
  incidentDate: timestamp('rca_incident_date').notNull(),
  status: rcaStatusEnum('rca_inv_status').default('not_started'),
  investigationStartDate: timestamp('investigation_start_date').defaultNow().notNull(),
  investigationDeadline: timestamp('investigation_deadline').notNull(),
  rcaCompletedAt: timestamp('rca_completed_at'),
  finalReportUrl: varchar('final_report_url', { length: 512 }),
  signedByQualityHeadAt: timestamp('signed_by_quality_head_at'),
  signedByCeoAt: timestamp('signed_by_ceo_at'),
  createdAt: timestamp('rca_created_at').defaultNow().notNull(),
  updatedAt: timestamp('rca_updated_at').defaultNow().notNull(),
});

export const rcaTeamMembers = pgTable('rca_team_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  rcaId: uuid('rtm_rca_id').notNull(),
  userId: uuid('rtm_user_id').notNull(),
  role: rcaTeamRoleEnum('rtm_role').notNull(),
  addedAt: timestamp('rtm_added_at').defaultNow().notNull(),
  addedByUserId: uuid('rtm_added_by_user_id').notNull(),
});

export const rcaTimelineEvents = pgTable('rca_timeline_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  rcaId: uuid('rte_rca_id').notNull(),
  eventTime: timestamp('event_time').notNull(),
  eventDescription: text('event_description').notNull(),
  sequenceOrder: integer('sequence_order').notNull(),
  dataSource: varchar('data_source', { length: 100 }),
  addedByUserId: uuid('rte_added_by_user_id').notNull(),
  addedAt: timestamp('rte_added_at').defaultNow().notNull(),
});

export const rcaFishboneFactors = pgTable('rca_fishbone_factors', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  rcaId: uuid('rff_rca_id').notNull(),
  category: fishboneCategoryEnum('rff_category').notNull(),
  factorDescription: text('factor_description').notNull(),
  isContributingFactor: boolean('is_contributing_factor').default(true),
  addedByUserId: uuid('rff_added_by_user_id').notNull(),
  addedAt: timestamp('rff_added_at').defaultNow().notNull(),
});

export const rcaFiveWhy = pgTable('rca_five_why', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  rcaId: uuid('rfw_rca_id').notNull(),
  questionSequence: integer('question_sequence').notNull(),
  question: text('rfw_question').notNull(),
  answer: text('rfw_answer').notNull(),
  contributingFactor: text('contributing_factor'),
  isRootCause: boolean('is_root_cause').default(false),
  addedByUserId: uuid('rfw_added_by_user_id').notNull(),
  addedAt: timestamp('rfw_added_at').defaultNow().notNull(),
});

export const rcaCapaItems = pgTable('rca_capa_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospitalId: text('hospital_id').notNull(),
  rcaId: uuid('rci_rca_id').notNull(),
  actionDescription: text('action_description').notNull(),
  actionType: capaTypeEnum('action_type').notNull(),
  responsibleUserId: uuid('responsible_user_id').notNull(),
  assignedAt: timestamp('rci_assigned_at').defaultNow().notNull(),
  assignedByUserId: uuid('rci_assigned_by_user_id').notNull(),
  targetImplementationDate: date('target_implementation_date').notNull(),
  status: capaStatusEnum('capa_status').default('planned'),
  completionEstimatePercent: integer('completion_estimate_percent').default(0),
  statusUpdatedAt: timestamp('capa_status_updated_at'),
  updatedByUserId: uuid('capa_updated_by_user_id'),
  implementationNotes: text('implementation_notes'),
  implementedAt: timestamp('implemented_at'),
  effectivenessReviewDueAt: timestamp('effectiveness_review_due_at'),
  effectivenessReviewStatus: effectivenessReviewStatusEnum('effectiveness_review_status'),
  effectivenessEvidence: text('effectiveness_evidence'),
  effectivenessReviewedByUserId: uuid('effectiveness_reviewed_by_user_id'),
  effectivenessReviewedAt: timestamp('effectiveness_reviewed_at'),
  createdAt: timestamp('rci_created_at').defaultNow().notNull(),
  updatedAt: timestamp('rci_updated_at').defaultNow().notNull(),
});
