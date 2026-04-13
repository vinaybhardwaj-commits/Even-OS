import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb, numeric, date, time,
  uniqueIndex, index, uuid, pgEnum,
} from 'drizzle-orm/pg-core';
import { hospitals } from './00-foundations';
import { users } from './00-foundations';

// ============================================================
// ENUMS
// ============================================================

export const snapshotIntervalEnum = pgEnum('snapshot_interval', ['hourly', 'daily']);
export const alertSeverityLevelEnum = pgEnum('alert_severity_level', ['1', '2', '3', '4']); // 1=critical, 2=high, 3=medium, 4=low
export const alertStatusEnum = pgEnum('alert_status', ['open', 'acknowledged', 'in_progress', 'resolved', 'dismissed']);
export const kpiFormulaTypeEnum = pgEnum('kpi_formula_type', ['sql_query', 'aggregation', 'derived']);
export const kpiRefreshCadenceEnum = pgEnum('kpi_refresh_cadence', ['real_time', 'hourly', 'daily']);
export const kpiDisplayFormatEnum = pgEnum('kpi_display_format', ['integer', 'decimal_2', 'percentage', 'currency']);
export const kpiCategoryEnum = pgEnum('kpi_category', [
  'census', 'finance', 'quality', 'staffing', 'infection', 'los', 'billing', 'compliance', 'incidents',
]);
export const trendDirectionEnum = pgEnum('trend_direction', ['up', 'down', 'stable']);
export const kpiStatusEnum = pgEnum('kpi_status', ['green', 'amber', 'red', 'neutral']);
export const dashboardAccessActionEnum = pgEnum('dashboard_access_action', [
  'view', 'drill_down', 'export', 'escalate', 'acknowledge',
]);
export const huddleTranscriptStatusEnum = pgEnum('huddle_transcript_status', [
  'pending', 'transcribing', 'complete', 'error',
]);
export const emailDigestFrequencyEnum = pgEnum('email_digest_frequency', ['real_time', 'hourly', 'daily', 'none']);

// ============================================================
// 1. DASHBOARD SNAPSHOTS — Pre-computed KPI aggregates
// ============================================================

export const dashboardSnapshots = pgTable('dashboard_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: uuid('hospital_id').notNull().references(() => hospitals.id),
  snapshot_date: date('snapshot_date').notNull(),
  snapshot_time: time('snapshot_time').notNull(),
  snapshot_interval: varchar('snapshot_interval', { length: 10 }).notNull(), // 'hourly' | 'daily'

  // Tier 1 — Real-time Census
  census_current: integer('census_current'),
  census_target: integer('census_target'),
  occupancy_pct: numeric('occupancy_pct', { precision: 5, scale: 2 }),
  pending_admissions_count: integer('pending_admissions_count'),
  pending_admissions_overdue_count: integer('pending_admissions_overdue_count'),
  pending_discharges_count: integer('pending_discharges_count'),
  pending_discharges_overdue_count: integer('pending_discharges_overdue_count'),
  critical_alerts_count: integer('critical_alerts_count'),
  critical_alerts_unacked_count: integer('critical_alerts_unacked_count'),

  // Staffing (Tier 1)
  staffing_summary: jsonb('staffing_summary'), // { icu: { target, current, status }, ... }

  // Overdue Tasks (Tier 1)
  overdue_tasks_count: integer('overdue_tasks_count'),
  overdue_tasks_by_type: jsonb('overdue_tasks_by_type'), // { medication: 2, wound_check: 1, ... }

  // Incidents (Tier 1)
  incidents_24h_count: integer('incidents_24h_count'),
  incidents_critical_count: integer('incidents_critical_count'),

  // Tier 2 — MOD
  incident_queue_open: integer('incident_queue_open'),
  vc_signature_backlog_count: integer('vc_signature_backlog_count'),
  pharmacy_oos_count: integer('pharmacy_oos_count'),
  billing_holds_count: integer('billing_holds_count'),

  // Tier 3 — GM
  admissions_yesterday: integer('admissions_yesterday'),
  discharges_yesterday: integer('discharges_yesterday'),
  revenue_yesterday: numeric('revenue_yesterday', { precision: 12, scale: 2 }),
  revenue_ytd: numeric('revenue_ytd', { precision: 12, scale: 2 }),
  claim_rejection_rate: numeric('claim_rejection_rate', { precision: 5, scale: 2 }),
  staff_attendance_pct: numeric('staff_attendance_pct', { precision: 5, scale: 2 }),
  complaint_resolution_rate: numeric('complaint_resolution_rate', { precision: 5, scale: 2 }),
  los_avg_current: numeric('los_avg_current', { precision: 5, scale: 2 }),
  los_target: numeric('los_target', { precision: 5, scale: 2 }),
  infection_rate: numeric('infection_rate', { precision: 5, scale: 2 }),
  nabh_compliance_pct: numeric('nabh_compliance_pct', { precision: 5, scale: 2 }),

  // Tier 4 — CEO (daily snapshots only)
  revenue_month_to_date: numeric('revenue_month_to_date', { precision: 12, scale: 2 }),
  revenue_budget: numeric('revenue_budget', { precision: 12, scale: 2 }),
  ebitda: numeric('ebitda', { precision: 12, scale: 2 }),
  ebitda_margin_pct: numeric('ebitda_margin_pct', { precision: 5, scale: 2 }),
  admission_volume_ytd: integer('admission_volume_ytd'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalDateIdx: index('idx_dashboard_snapshots_hospital_date').on(table.hospital_id, table.snapshot_date, table.snapshot_interval),
  createdAtIdx: index('idx_dashboard_snapshots_created_at').on(table.created_at),
}));

// ============================================================
// 2. DASHBOARD CONFIG — Per-user layout customization
// ============================================================

export const dashboardConfig = pgTable('dashboard_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  hospital_id: uuid('hospital_id').notNull().references(() => hospitals.id),
  dashboard_tier: integer('dashboard_tier').notNull(), // 1=wall, 2=MOD, 3=GM, 4=CEO

  // Layout
  layout_config: jsonb('layout_config').notNull().default({}),

  // Preferences
  auto_refresh_enabled: boolean('auto_refresh_enabled').default(true),
  refresh_interval_seconds: integer('refresh_interval_seconds').default(30),
  alert_severity_filter: integer('alert_severity_filter').default(1), // 0=all, 1=critical, 2=high+
  department_filters: jsonb('department_filters').default([]), // UUID array as JSON
  kpi_bookmarks: jsonb('kpi_bookmarks').default([]),

  // Notification prefs
  slack_notifications_enabled: boolean('slack_notifications_enabled').default(false),
  slack_webhook_url: text('slack_webhook_url'),
  sms_notifications_enabled: boolean('sms_notifications_enabled').default(false),
  email_digest_frequency: varchar('email_digest_frequency', { length: 20 }).default('daily'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  created_by: uuid('created_by').references(() => users.id),
  updated_by: uuid('updated_by').references(() => users.id),
}, (table) => ({
  userHospitalTierIdx: uniqueIndex('idx_dashboard_config_user_hospital_tier').on(table.user_id, table.hospital_id, table.dashboard_tier),
  userIdIdx: index('idx_dashboard_config_user_id').on(table.user_id),
}));

// ============================================================
// 3. KPI DEFINITIONS — Formula, target, thresholds
// ============================================================

export const kpiDefinitions = pgTable('kpi_definitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: uuid('hospital_id').references(() => hospitals.id), // NULL = network-wide
  kpi_name: varchar('kpi_name', { length: 100 }).notNull(),
  kpi_code: varchar('kpi_code', { length: 50 }).notNull().unique(),
  description: text('description'),

  // Formula
  formula_type: varchar('formula_type', { length: 50 }).notNull(), // 'sql_query', 'aggregation', 'derived'
  formula_query: text('formula_query'),
  data_source: varchar('data_source', { length: 100 }),
  refresh_cadence: varchar('refresh_cadence', { length: 20 }).default('hourly'),

  // Target & thresholds
  target_value: numeric('target_value', { precision: 12, scale: 2 }),
  warning_threshold: numeric('warning_threshold', { precision: 12, scale: 2 }),
  critical_threshold: numeric('critical_threshold', { precision: 12, scale: 2 }),

  // Display
  unit: varchar('unit', { length: 50 }), // 'count', '%', 'INR', 'minutes'
  display_format: varchar('display_format', { length: 50 }), // 'integer', 'decimal_2', 'percentage', 'currency'
  dashboard_tiers: jsonb('dashboard_tiers').notNull(), // [1, 2, 3, 4]
  category: varchar('category', { length: 50 }),

  // Benchmarking
  benchmark_national: numeric('benchmark_national', { precision: 12, scale: 2 }),
  benchmark_network_avg: numeric('benchmark_network_avg', { precision: 12, scale: 2 }),

  enabled: boolean('enabled').default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  created_by: uuid('created_by').references(() => users.id),
  updated_by: uuid('updated_by').references(() => users.id),
}, (table) => ({
  kpiCodeIdx: index('idx_kpi_definitions_kpi_code').on(table.kpi_code),
  hospitalIdIdx: index('idx_kpi_definitions_hospital_id').on(table.hospital_id),
  categoryIdx: index('idx_kpi_definitions_category').on(table.category),
}));

// ============================================================
// 4. KPI DAILY VALUES — Materialized daily per hospital
// ============================================================

export const kpiDailyValues = pgTable('kpi_daily_values', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: uuid('hospital_id').notNull().references(() => hospitals.id),
  kpi_id: uuid('kpi_id').notNull().references(() => kpiDefinitions.id),
  value_date: date('value_date').notNull(),

  // Value & variance
  actual_value: numeric('actual_value', { precision: 12, scale: 2 }).notNull(),
  target_value: numeric('target_value', { precision: 12, scale: 2 }),
  variance_pct: numeric('variance_pct', { precision: 5, scale: 2 }),
  status: varchar('status', { length: 20 }), // 'green', 'amber', 'red', 'neutral'

  // Comparisons
  previous_day_value: numeric('previous_day_value', { precision: 12, scale: 2 }),
  previous_week_value: numeric('previous_week_value', { precision: 12, scale: 2 }),
  previous_month_value: numeric('previous_month_value', { precision: 12, scale: 2 }),
  ytd_value: numeric('ytd_value', { precision: 12, scale: 2 }),

  // Trend
  trend_direction: varchar('trend_direction', { length: 20 }), // 'up', 'down', 'stable'
  trend_pct: numeric('trend_pct', { precision: 5, scale: 2 }),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalKpiDateIdx: uniqueIndex('idx_kpi_daily_values_hospital_kpi_date').on(table.hospital_id, table.kpi_id, table.value_date),
  hospitalDateIdx: index('idx_kpi_daily_values_hospital_date').on(table.hospital_id, table.value_date),
  kpiIdIdx: index('idx_kpi_daily_values_kpi_id').on(table.kpi_id),
}));

// ============================================================
// 5. ALERT QUEUE — Active alerts with severity & escalation
// ============================================================

export const alertQueue = pgTable('alert_queue', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: uuid('hospital_id').notNull().references(() => hospitals.id),

  // Alert metadata
  alert_type: varchar('alert_type', { length: 100 }).notNull(),
  alert_source: varchar('alert_source', { length: 100 }).notNull(),
  alert_code: varchar('alert_code', { length: 50 }),
  alert_title: varchar('alert_title', { length: 255 }).notNull(),
  alert_description: text('alert_description'),

  // Entity references (nullable — not all alerts are patient-specific)
  patient_id: uuid('patient_id'),
  order_id: uuid('order_id'),
  ward_id: uuid('ward_id'),
  assigned_to_role: varchar('assigned_to_role', { length: 50 }),
  assigned_to_user_id: uuid('assigned_to_user_id').references(() => users.id),

  // Severity & urgency
  severity_level: integer('severity_level').notNull(), // 1=critical, 2=high, 3=medium, 4=low
  urgency_score: integer('urgency_score'), // 0-100

  // Timeline
  raised_at: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
  raised_by_user_id: uuid('raised_by_user_id').references(() => users.id),
  acknowledged_at: timestamp('acknowledged_at', { withTimezone: true }),
  acknowledged_by_user_id: uuid('acknowledged_by_user_id').references(() => users.id),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  resolved_by_user_id: uuid('resolved_by_user_id').references(() => users.id),

  // Escalation chain
  escalation_chain: jsonb('escalation_chain').default([]),
  escalation_attempts: integer('escalation_attempts').default(0),
  escalated_to_ceo: boolean('escalated_to_ceo').default(false),

  // Status
  status: varchar('status', { length: 20 }).notNull().default('open'),
  dismissal_reason: text('dismissal_reason'),

  // Metadata
  metadata: jsonb('metadata').default({}),
  related_alerts: jsonb('related_alerts').default([]),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalStatusIdx: index('idx_alert_queue_hospital_status').on(table.hospital_id, table.status),
  severityIdx: index('idx_alert_queue_severity').on(table.severity_level),
  assignedUserIdx: index('idx_alert_queue_assigned_user').on(table.assigned_to_user_id),
  patientIdx: index('idx_alert_queue_patient_id').on(table.patient_id),
  raisedAtIdx: index('idx_alert_queue_raised_at').on(table.raised_at),
}));

// ============================================================
// 6. DASHBOARD ACCESS AUDIT — Compliance logging
// ============================================================

export const dashboardAccessAudit = pgTable('dashboard_access_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id),
  hospital_id: uuid('hospital_id').notNull().references(() => hospitals.id),

  action_type: varchar('action_type', { length: 100 }).notNull(),
  action_detail: varchar('action_detail', { length: 255 }),
  dashboard_tier: integer('dashboard_tier'),
  kpi_accessed: varchar('kpi_accessed', { length: 100 }),

  // Export actions
  export_format: varchar('export_format', { length: 20 }),
  export_scope: varchar('export_scope', { length: 100 }),

  // Escalation actions
  alert_id: uuid('alert_id').references(() => alertQueue.id),
  escalated_to_role: varchar('escalated_to_role', { length: 50 }),
  escalation_message: text('escalation_message'),

  ip_address: text('ip_address'),
  user_agent: text('user_agent'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userHospitalIdx: index('idx_dashboard_access_audit_user_hospital').on(table.user_id, table.hospital_id, table.created_at),
  actionTypeIdx: index('idx_dashboard_access_audit_action_type').on(table.action_type),
  createdAtIdx: index('idx_dashboard_access_audit_created_at').on(table.created_at),
}));

// ============================================================
// 7. HUDDLE RECORDINGS — Shift huddle audio & transcript
// ============================================================

export const huddleRecordings = pgTable('huddle_recordings', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: uuid('hospital_id').notNull().references(() => hospitals.id),
  ward_id: uuid('ward_id'),

  // Recording metadata
  recording_date: date('recording_date').notNull(),
  recording_time: time('recording_time').notNull(),
  recording_start_at: timestamp('recording_start_at', { withTimezone: true }).notNull().defaultNow(),
  recording_end_at: timestamp('recording_end_at', { withTimezone: true }),
  duration_seconds: integer('duration_seconds'),

  // File storage
  media_file_url: text('media_file_url'),
  media_file_duration_seconds: integer('media_file_duration_seconds'),
  media_file_size_bytes: integer('media_file_size_bytes'),

  // Transcription
  transcript_status: varchar('transcript_status', { length: 50 }).default('pending'),
  transcript_text: text('transcript_text'),
  transcript_language: varchar('transcript_language', { length: 10 }).default('en-IN'),

  // Speaker identification
  speaker_count: integer('speaker_count'),
  speakers: jsonb('speakers').default([]),

  // Metadata
  recorded_by_user_id: uuid('recorded_by_user_id').references(() => users.id),
  initiated_by_user_id: uuid('initiated_by_user_id').references(() => users.id),
  notes: text('notes'),

  // Quality
  audio_quality_score: integer('audio_quality_score'),
  transcription_confidence_score: numeric('transcription_confidence_score', { precision: 3, scale: 2 }),

  // Retention
  retention_until: date('retention_until'),
  is_archived: boolean('is_archived').default(false),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalWardDateIdx: index('idx_huddle_recordings_hospital_ward_date').on(table.hospital_id, table.ward_id, table.recording_date),
  statusIdx: index('idx_huddle_recordings_status').on(table.transcript_status),
}));

// ============================================================
// 8. HUDDLE SPEAKERS — Speaker diarization
// ============================================================

export const huddleSpeakers = pgTable('huddle_speakers', {
  id: uuid('id').defaultRandom().primaryKey(),
  recording_id: uuid('recording_id').notNull().references(() => huddleRecordings.id, { onDelete: 'cascade' }),

  user_id: uuid('user_id').references(() => users.id),
  speaker_name: varchar('speaker_name', { length: 255 }),
  speaker_role: varchar('speaker_role', { length: 100 }),

  // Timestamps
  first_spoken_at: timestamp('first_spoken_at', { withTimezone: true }),
  last_spoken_at: timestamp('last_spoken_at', { withTimezone: true }),
  total_speaking_time_seconds: integer('total_speaking_time_seconds'),
  turn_count: integer('turn_count'),

  // Quality
  speech_clarity_score: numeric('speech_clarity_score', { precision: 3, scale: 2 }),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  recordingIdIdx: index('idx_huddle_speakers_recording_id').on(table.recording_id),
}));

// ============================================================
// 9. HUDDLE TRANSCRIPT EDITS — Manual corrections
// ============================================================

export const huddleTranscriptEdits = pgTable('huddle_transcript_edits', {
  id: uuid('id').defaultRandom().primaryKey(),
  recording_id: uuid('recording_id').notNull().references(() => huddleRecordings.id, { onDelete: 'cascade' }),

  original_text: text('original_text'),
  corrected_text: text('corrected_text'),

  // Edit context
  timestamp_in_recording: integer('timestamp_in_recording'), // Seconds offset
  edited_by_user_id: uuid('edited_by_user_id').notNull().references(() => users.id),
  edit_reason: varchar('edit_reason', { length: 255 }),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  recordingIdIdx: index('idx_huddle_transcript_edits_recording_id').on(table.recording_id),
}));
