import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb, numeric, uuid,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================
// SECURITY & HARDENING MODULE (29)
// ============================================================

// ─── SECURITY AUDIT FINDINGS ─────────────────────────────────
export const securityAuditFindings = pgTable('security_audit_findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  finding_id: text('finding_id').notNull().unique(), // e.g., 'SEC-2026-0001'
  category: text('category').notNull(), // owasp_a1, owasp_a2, ..., owasp_a10, custom
  severity: text('severity').notNull(), // critical, high, medium, low, info
  title: text('title').notNull(),
  description: text('description'),
  affected_module: text('affected_module'),
  affected_endpoint: text('affected_endpoint'),
  remediation_status: text('remediation_status').notNull().default('open'), // open, in_progress, resolved, accepted_risk, false_positive
  remediation_notes: text('remediation_notes'),
  assigned_to: uuid('assigned_to'), // user_id
  found_at: timestamp('found_at', { withTimezone: true }).notNull().defaultNow(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  verified_by: uuid('verified_by'), // user_id
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  findingIdIdx: uniqueIndex('idx_security_findings_finding_id').on(table.finding_id),
  categoryIdx: index('idx_security_findings_category').on(table.category),
  severityIdx: index('idx_security_findings_severity').on(table.severity),
  statusIdx: index('idx_security_findings_status').on(table.remediation_status),
  foundAtIdx: index('idx_security_findings_found_at').on(table.found_at),
}));

// ─── RATE LIMIT EVENTS ───────────────────────────────────────
export const rateLimitEvents = pgTable('rate_limit_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  ip_address: text('ip_address').notNull(),
  user_id: uuid('user_id'), // nullable
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull(), // GET, POST, etc.
  window_key: text('window_key').notNull(),
  request_count: integer('request_count').notNull(),
  limit_threshold: integer('limit_threshold').notNull(),
  action_taken: text('action_taken').notNull(), // warn, block, captcha
  blocked_at: timestamp('blocked_at', { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ipAddressIdx: index('idx_rate_limit_ip').on(table.ip_address),
  userIdIdx: index('idx_rate_limit_user').on(table.user_id),
  endpointIdx: index('idx_rate_limit_endpoint').on(table.endpoint),
  blockedAtIdx: index('idx_rate_limit_blocked_at').on(table.blocked_at),
}));

// ─── PII ACCESS LOG ──────────────────────────────────────────
export const piiAccessLog = pgTable('pii_access_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull(),
  patient_id: uuid('patient_id'), // nullable for system access
  access_type: text('access_type').notNull(), // view_unmasked, export, download, print
  resource_type: text('resource_type').notNull(), // patient, record, document, etc.
  resource_id: text('resource_id').notNull(),
  fields_accessed: text('fields_accessed').array(), // [ssn, phone, address, etc.]
  justification: text('justification'),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_pii_access_user').on(table.user_id),
  patientIdIdx: index('idx_pii_access_patient').on(table.patient_id),
  accessTypeIdx: index('idx_pii_access_type').on(table.access_type),
  createdAtIdx: index('idx_pii_access_created_at').on(table.created_at),
}));

// ─── DISASTER RECOVERY DRILLS ────────────────────────────────
export const disasterRecoveryDrills = pgTable('disaster_recovery_drills', {
  id: uuid('id').defaultRandom().primaryKey(),
  drill_type: text('drill_type').notNull(), // db_failover, app_rollback, ransomware, full_dr
  scenario_name: text('scenario_name').notNull(),
  started_at: timestamp('started_at', { withTimezone: true }).notNull(),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  led_by: uuid('led_by'), // user_id
  participants: text('participants').array(), // [user_id_1, user_id_2, ...]
  target_rto_minutes: integer('target_rto_minutes'),
  actual_rto_minutes: integer('actual_rto_minutes'),
  target_rpo_minutes: integer('target_rpo_minutes'),
  actual_rpo_minutes: integer('actual_rpo_minutes'),
  data_loss_detected: boolean('data_loss_detected').default(false),
  issues_found: jsonb('issues_found'), // [{id, severity, description, remediation}]
  remediation_actions: jsonb('remediation_actions'), // [{action, owner, due_date, status}]
  passed: boolean('passed'),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  drillTypeIdx: index('idx_dr_drills_type').on(table.drill_type),
  startedAtIdx: index('idx_dr_drills_started_at').on(table.started_at),
  passedIdx: index('idx_dr_drills_passed').on(table.passed),
}));

// ─── PERFORMANCE BASELINES ───────────────────────────────────
export const performanceBaselines = pgTable('performance_baselines', {
  id: uuid('id').defaultRandom().primaryKey(),
  test_name: text('test_name').notNull(),
  test_type: text('test_type').notNull(), // load, stress, spike, soak
  concurrent_users: integer('concurrent_users'),
  duration_minutes: integer('duration_minutes'),
  avg_response_ms: integer('avg_response_ms'),
  p95_response_ms: integer('p95_response_ms'),
  p99_response_ms: integer('p99_response_ms'),
  error_rate: numeric('error_rate', { precision: 5, scale: 2 }), // percentage
  throughput_rps: numeric('throughput_rps', { precision: 10, scale: 2 }), // requests per second
  endpoints_tested: jsonb('endpoints_tested'), // [{endpoint, method, count}]
  issues: jsonb('issues'), // [{severity, description, impact}]
  tested_by: uuid('tested_by'), // user_id
  tested_at: timestamp('tested_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  testTypeIdx: index('idx_perf_baseline_type').on(table.test_type),
  testedAtIdx: index('idx_perf_baseline_tested_at').on(table.tested_at),
}));

// ─── COMPLIANCE CHECKLIST ITEMS ──────────────────────────────
export const complianceChecklistItems = pgTable('compliance_checklist_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  checklist_type: text('checklist_type').notNull(), // nabh, dpdp, owasp, hipaa
  section: text('section').notNull(), // e.g., "Infection Control", "A1 - Injection Flaws"
  item_code: text('item_code').notNull().unique(), // e.g., "OWASP-A1-001"
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('not_started'), // not_started, in_progress, compliant, non_compliant, na
  evidence_url: text('evidence_url'), // link to evidence document
  assigned_to: uuid('assigned_to'), // user_id
  due_date: timestamp('due_date', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  verified_by: uuid('verified_by'), // user_id
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  checklistTypeIdx: index('idx_compliance_type').on(table.checklist_type),
  itemCodeIdx: uniqueIndex('idx_compliance_item_code').on(table.item_code),
  statusIdx: index('idx_compliance_status').on(table.status),
  sectionIdx: index('idx_compliance_section').on(table.section),
}));

// ─── SYSTEM HEALTH SNAPSHOTS ────────────────────────────────
export const systemHealthSnapshots = pgTable('system_health_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  snapshot_type: text('snapshot_type').notNull(), // hourly, daily, weekly
  api_uptime_pct: numeric('api_uptime_pct', { precision: 5, scale: 2 }),
  avg_response_ms: integer('avg_response_ms'),
  p99_response_ms: integer('p99_response_ms'),
  error_rate_pct: numeric('error_rate_pct', { precision: 5, scale: 2 }),
  active_sessions: integer('active_sessions'),
  db_pool_utilization_pct: numeric('db_pool_utilization_pct', { precision: 5, scale: 2 }),
  db_query_avg_ms: integer('db_query_avg_ms'),
  memory_usage_mb: integer('memory_usage_mb'),
  cpu_usage_pct: numeric('cpu_usage_pct', { precision: 5, scale: 2 }),
  disk_usage_pct: numeric('disk_usage_pct', { precision: 5, scale: 2 }),
  cache_hit_rate_pct: numeric('cache_hit_rate_pct', { precision: 5, scale: 2 }),
  snapshot_at: timestamp('snapshot_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  snapshotTypeIdx: index('idx_health_snapshot_type').on(table.snapshot_type),
  snapshotAtIdx: index('idx_health_snapshot_at').on(table.snapshot_at),
}));
