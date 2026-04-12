import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum, real,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ============================================================
// ENUMS — Care Pathways Engine (Module 06)
// ============================================================

export const pathwayStatusEnum = pgEnum('pathway_status', [
  'draft', 'active', 'archived',
]);

export const pathwayNodeTypeEnum = pgEnum('pathway_node_type', [
  'assessment', 'order_set', 'task', 'decision_point', 'clinical_milestone',
]);

export const carePlanStatusEnum = pgEnum('care_plan_status', [
  'draft', 'active', 'on_hold', 'completed', 'revoked', 'entered_in_error',
]);

export const milestoneStatusEnum = pgEnum('milestone_status', [
  'not_started', 'in_progress', 'completed', 'overdue', 'skipped',
]);

export const varianceTypeEnum = pgEnum('variance_type', [
  'timing', 'omission', 'complication', 'patient_refusal',
]);

export const varianceSeverityEnum = pgEnum('variance_severity', [
  'low', 'medium', 'high',
]);

export const escalationLevelEnum = pgEnum('escalation_level', [
  'level_1', 'level_2', 'level_3',
]);

export const escalationStatusEnum = pgEnum('escalation_status', [
  'triggered', 'acknowledged', 'resolved', 'snoozed',
]);

// ============================================================
// PATHWAY TEMPLATES (DAG definitions — versioned)
// ============================================================

export const pathwayTemplates = pgTable('pathway_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),

  name: text('pathway_name').notNull(),
  description: text('pathway_description'),
  category: varchar('pathway_category', { length: 100 }),    // e.g. "Orthopedics", "General Surgery"
  icd10_codes: jsonb('icd10_codes'),                          // ["Z96.641", "Z96.642"] for auto-matching

  status: pathwayStatusEnum('pathway_status').default('draft').notNull(),
  version: integer('pathway_version').default(1).notNull(),
  previous_version_id: uuid('previous_version_id'),

  // DAG structure stored as JSON
  dag_definition: jsonb('dag_definition'),                    // { nodes: [...], edges: [...] }
  node_count: integer('node_count').default(0),
  expected_los_days: integer('expected_los_days'),
  expected_cost: real('expected_cost'),

  published_at: timestamp('published_at'),
  published_by: uuid('published_by').references(() => users.id),

  created_by: uuid('pathway_created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('pathway_created_at').defaultNow().notNull(),
  updated_at: timestamp('pathway_updated_at').defaultNow().notNull(),
}, (t) => ({
  hospitalIdx: index('idx_pt_hospital').on(t.hospital_id),
  statusIdx: index('idx_pt_status').on(t.status),
  categoryIdx: index('idx_pt_category').on(t.category),
  nameIdx: index('idx_pt_name').on(t.name),
}));

// ============================================================
// PATHWAY NODES (denormalized for query efficiency)
// ============================================================

export const pathwayNodes = pgTable('pathway_nodes', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  template_id: uuid('template_id').notNull().references(() => pathwayTemplates.id, { onDelete: 'cascade' }),

  node_key: varchar('node_key', { length: 50 }).notNull(),   // unique within template
  node_type: pathwayNodeTypeEnum('node_type').notNull(),
  name: text('node_name').notNull(),
  description: text('node_description'),

  // Timing
  timing_expression: varchar('timing_expression', { length: 100 }),  // "+0d", "+1d", "+3d", "from_surgery_end+2h"
  timing_offset_hours: integer('timing_offset_hours'),                // computed offset in hours from admission

  // Configuration
  responsible_role: varchar('responsible_role', { length: 50 }),       // "nurse", "surgeon", "anesthetist"
  order_set_id: uuid('order_set_id'),                                  // FK to orderSets if node_type='order_set'
  auto_fire: boolean('auto_fire').default(false),
  is_required: boolean('is_required').default(true),

  // Escalation rules
  escalation_rules: jsonb('escalation_rules'),                         // [{threshold_hours: 4, notify_role: "nurse"}, ...]

  // Decision point config
  condition_expression: jsonb('condition_expression'),                  // { field: "observation.hb", operator: "<", value: 10 }
  true_branch_node_key: varchar('true_branch_node_key', { length: 50 }),
  false_branch_node_key: varchar('false_branch_node_key', { length: 50 }),

  sort_order: integer('sort_order').default(0),

  created_at: timestamp('pn_created_at').defaultNow().notNull(),
}, (t) => ({
  templateIdx: index('idx_pn_template').on(t.template_id),
  hospitalIdx: index('idx_pn_hospital').on(t.hospital_id),
  nodeTypeIdx: index('idx_pn_node_type').on(t.node_type),
}));

// ============================================================
// PATHWAY EDGES (dependency graph)
// ============================================================

export const pathwayEdges = pgTable('pathway_edges', {
  id: uuid('id').defaultRandom().primaryKey(),
  template_id: uuid('edge_template_id').notNull().references(() => pathwayTemplates.id, { onDelete: 'cascade' }),
  from_node_id: uuid('from_node_id').notNull().references(() => pathwayNodes.id, { onDelete: 'cascade' }),
  to_node_id: uuid('to_node_id').notNull().references(() => pathwayNodes.id, { onDelete: 'cascade' }),

  condition_label: text('condition_label'),    // e.g. "HB >= 10", "true", "false"
  is_default: boolean('is_default').default(true),

  created_at: timestamp('pe_created_at').defaultNow().notNull(),
}, (t) => ({
  templateIdx: index('idx_pe_template').on(t.template_id),
  fromNodeIdx: index('idx_pe_from_node').on(t.from_node_id),
  toNodeIdx: index('idx_pe_to_node').on(t.to_node_id),
}));

// ============================================================
// CARE PLANS (FHIR CarePlan — activated pathway instance)
// ============================================================

export const carePlans = pgTable('care_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  patient_id: uuid('cp_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  encounter_id: uuid('cp_encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  template_id: uuid('cp_template_id').notNull().references(() => pathwayTemplates.id, { onDelete: 'restrict' }),

  status: carePlanStatusEnum('care_plan_status').default('active').notNull(),

  activated_at: timestamp('activated_at').defaultNow().notNull(),
  activated_by: uuid('activated_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  completed_at: timestamp('cp_completed_at'),
  revoked_at: timestamp('revoked_at'),
  revoke_reason: text('revoke_reason'),

  // Computed metrics
  total_milestones: integer('total_milestones').default(0),
  completed_milestones: integer('completed_milestones').default(0),
  overdue_milestones: integer('overdue_milestones').default(0),
  actual_los_days: integer('actual_los_days'),
  actual_cost: real('actual_cost'),

  created_at: timestamp('cp_created_at').defaultNow().notNull(),
  updated_at: timestamp('cp_updated_at').defaultNow().notNull(),
}, (t) => ({
  patientIdx: index('idx_cp_patient').on(t.patient_id),
  hospitalIdx: index('idx_cp_hospital').on(t.hospital_id),
  encounterIdx: index('idx_cp_encounter').on(t.encounter_id),
  templateIdx: index('idx_cp_template').on(t.template_id),
  statusIdx: index('idx_cp_status').on(t.status),
}));

// ============================================================
// CARE PLAN MILESTONES (FHIR Task — per node instance)
// ============================================================

export const carePlanMilestones = pgTable('care_plan_milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  care_plan_id: uuid('care_plan_id').notNull().references(() => carePlans.id, { onDelete: 'cascade' }),
  patient_id: uuid('ms_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),
  pathway_node_id: uuid('ms_pathway_node_id').references(() => pathwayNodes.id, { onDelete: 'set null' }),

  // Node info (denormalized for display)
  node_key: varchar('ms_node_key', { length: 50 }).notNull(),
  node_type: pathwayNodeTypeEnum('ms_node_type').notNull(),
  name: text('ms_name').notNull(),
  responsible_role: varchar('ms_responsible_role', { length: 50 }),

  // Status & timing
  status: milestoneStatusEnum('ms_status').default('not_started').notNull(),
  due_datetime: timestamp('due_datetime'),
  started_at: timestamp('ms_started_at'),
  completed_at: timestamp('ms_completed_at'),
  completed_by: uuid('ms_completed_by').references(() => users.id),

  // Skip
  skipped_at: timestamp('skipped_at'),
  skip_reason: text('skip_reason'),
  skipped_by: uuid('skipped_by').references(() => users.id),

  // Auto-fired orders
  auto_fired_order_ids: jsonb('auto_fired_order_ids'),       // UUID[] of orders created

  sort_order: integer('ms_sort_order').default(0),

  created_at: timestamp('ms_created_at').defaultNow().notNull(),
  updated_at: timestamp('ms_updated_at').defaultNow().notNull(),
}, (t) => ({
  carePlanIdx: index('idx_ms_care_plan').on(t.care_plan_id),
  patientIdx: index('idx_ms_patient').on(t.patient_id),
  hospitalIdx: index('idx_ms_hospital').on(t.hospital_id),
  statusIdx: index('idx_ms_status').on(t.status),
  dueIdx: index('idx_ms_due').on(t.due_datetime),
}));

// ============================================================
// CARE TEAMS (FHIR CareTeam)
// ============================================================

export const careTeams = pgTable('care_teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  care_plan_id: uuid('ct_care_plan_id').notNull().references(() => carePlans.id, { onDelete: 'cascade' }),
  patient_id: uuid('ct_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  member_user_id: uuid('member_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  role: varchar('ct_role', { length: 50 }).notNull(),         // surgeon, anesthetist, nurse, dietician
  is_lead: boolean('is_lead').default(false),

  added_at: timestamp('ct_added_at').defaultNow().notNull(),
  removed_at: timestamp('ct_removed_at'),
}, (t) => ({
  carePlanIdx: index('idx_ct_care_plan').on(t.care_plan_id),
  memberIdx: index('idx_ct_member').on(t.member_user_id),
  hospitalIdx: index('idx_ct_hospital').on(t.hospital_id),
}));

// ============================================================
// VARIANCE LOG
// ============================================================

export const varianceLog = pgTable('variance_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  care_plan_id: uuid('vl_care_plan_id').notNull().references(() => carePlans.id, { onDelete: 'cascade' }),
  milestone_id: uuid('vl_milestone_id').notNull().references(() => carePlanMilestones.id, { onDelete: 'cascade' }),
  patient_id: uuid('vl_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  variance_type: varianceTypeEnum('variance_type').notNull(),
  severity: varianceSeverityEnum('vl_severity').notNull(),

  expected_datetime: timestamp('expected_datetime'),
  actual_datetime: timestamp('actual_datetime'),
  delay_hours: real('delay_hours'),

  reason: text('vl_reason'),
  notes: text('vl_notes'),

  documented_by: uuid('documented_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('vl_created_at').defaultNow().notNull(),
}, (t) => ({
  carePlanIdx: index('idx_vl_care_plan').on(t.care_plan_id),
  milestoneIdx: index('idx_vl_milestone').on(t.milestone_id),
  patientIdx: index('idx_vl_patient').on(t.patient_id),
  hospitalIdx: index('idx_vl_hospital').on(t.hospital_id),
  varianceTypeIdx: index('idx_vl_type').on(t.variance_type),
  severityIdx: index('idx_vl_severity').on(t.severity),
}));

// ============================================================
// ESCALATION EVENTS
// ============================================================

export const escalationEvents = pgTable('escalation_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  care_plan_id: uuid('ee_care_plan_id').notNull().references(() => carePlans.id, { onDelete: 'cascade' }),
  milestone_id: uuid('ee_milestone_id').notNull().references(() => carePlanMilestones.id, { onDelete: 'cascade' }),
  patient_id: uuid('ee_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  level: escalationLevelEnum('escalation_level').notNull(),
  status: escalationStatusEnum('ee_status').default('triggered').notNull(),

  triggered_at: timestamp('triggered_at').defaultNow().notNull(),
  notify_user_id: uuid('notify_user_id').references(() => users.id),
  notify_role: varchar('notify_role', { length: 50 }),

  acknowledged_at: timestamp('acknowledged_at'),
  acknowledged_by: uuid('acknowledged_by').references(() => users.id),
  resolved_at: timestamp('ee_resolved_at'),
  resolved_by: uuid('ee_resolved_by').references(() => users.id),
  resolution_notes: text('resolution_notes'),

  snoozed_until: timestamp('snoozed_until'),

  created_at: timestamp('ee_created_at').defaultNow().notNull(),
}, (t) => ({
  carePlanIdx: index('idx_ee_care_plan').on(t.care_plan_id),
  milestoneIdx: index('idx_ee_milestone').on(t.milestone_id),
  patientIdx: index('idx_ee_patient').on(t.patient_id),
  hospitalIdx: index('idx_ee_hospital').on(t.hospital_id),
  levelIdx: index('idx_ee_level').on(t.level),
  statusIdx: index('idx_ee_status').on(t.status),
}));

// ============================================================
// DECISION EVENTS (branch logging at decision points)
// ============================================================

export const decisionEvents = pgTable('decision_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  care_plan_id: uuid('de_care_plan_id').notNull().references(() => carePlans.id, { onDelete: 'cascade' }),
  milestone_id: uuid('de_milestone_id').notNull().references(() => carePlanMilestones.id, { onDelete: 'cascade' }),
  patient_id: uuid('de_patient_id').notNull().references(() => patients.id, { onDelete: 'restrict' }),

  condition_expression: jsonb('de_condition_expression'),     // the rule evaluated
  patient_data_used: jsonb('patient_data_used'),              // snapshot of observation/condition values
  result: boolean('decision_result').notNull(),                // true/false branch taken
  branch_taken_node_key: varchar('branch_taken_node_key', { length: 50 }),

  decided_by: uuid('decided_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  created_at: timestamp('de_created_at').defaultNow().notNull(),
}, (t) => ({
  carePlanIdx: index('idx_de_care_plan').on(t.care_plan_id),
  milestoneIdx: index('idx_de_milestone').on(t.milestone_id),
  hospitalIdx: index('idx_de_hospital').on(t.hospital_id),
}));
