import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex, time, boolean, date, pgEnum, real } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { hospitals } from './00-foundations';

// ============================================================
// SHIFT & WORKFORCE MANAGEMENT — SM.1–SM.3
// 7 tables: shift_templates, shift_instances, shift_roster,
//   shift_swaps, leave_requests, staffing_targets, overtime_log
// ============================================================

// ── Enums ──────────────────────────────────────────────────────────────────

export const shiftNameEnum = pgEnum('shift_name', [
  'morning', 'evening', 'night', 'general', 'custom',
]);

export const shiftInstanceStatusEnum = pgEnum('shift_instance_status', [
  'planned', 'active', 'completed', 'cancelled',
]);

export const rosterStatusEnum = pgEnum('roster_status', [
  'scheduled', 'confirmed', 'absent', 'swapped', 'cancelled',
]);

export const swapStatusEnum = pgEnum('swap_status', [
  'pending_target', 'pending_approval', 'approved', 'denied', 'cancelled',
]);

export const leaveTypeEnum = pgEnum('leave_type', [
  'sick', 'casual', 'privilege', 'emergency', 'compensatory', 'maternity', 'other',
]);

export const leaveStatusEnum = pgEnum('leave_status', [
  'pending', 'approved', 'denied', 'cancelled',
]);

export const wardTypeEnum = pgEnum('ward_type_applicability', [
  'icu', 'general', 'step_down', 'ot', 'er', 'all',
]);

// ── shift_templates ────────────────────────────────────────────────────────
// Defines shift patterns (Morning/Evening/Night + custom).
// Default 3 shifts: 06:00–14:00, 14:00–22:00, 22:00–06:00.

export const shiftTemplates = pgTable('shift_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  shift_name: shiftNameEnum('shift_name').notNull().default('custom'),
  start_time: time('start_time').notNull(),
  end_time: time('end_time').notNull(),
  duration_hours: real('duration_hours').notNull().default(8),
  ward_type: wardTypeEnum('ward_type').notNull().default('all'),
  is_default: boolean('is_default').notNull().default(false),
  is_active: boolean('is_active').notNull().default(true),
  color: text('color').default('#3B82F6'), // For calendar display
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_shift_templates_hospital').on(table.hospital_id),
  nameIdx: uniqueIndex('idx_shift_templates_name_hospital').on(table.name, table.hospital_id),
  defaultIdx: index('idx_shift_templates_default').on(table.is_default),
}));

// ── shift_instances ────────────────────────────────────────────────────────
// One row per ward per shift per day. Created from templates.

export const shiftInstances = pgTable('shift_instances', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  template_id: uuid('template_id').notNull().references(() => shiftTemplates.id, { onDelete: 'restrict' }),
  ward_id: uuid('ward_id').notNull(), // references locations(id) where location_type='ward'
  shift_date: date('shift_date').notNull(),
  charge_nurse_id: uuid('charge_nurse_id'), // references users(id)
  status: shiftInstanceStatusEnum('status').notNull().default('planned'),
  actual_start: timestamp('actual_start', { withTimezone: true }),
  actual_end: timestamp('actual_end', { withTimezone: true }),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_shift_instances_hospital').on(table.hospital_id),
  wardDateIdx: index('idx_shift_instances_ward_date').on(table.ward_id, table.shift_date),
  dateIdx: index('idx_shift_instances_date').on(table.shift_date),
  templateIdx: index('idx_shift_instances_template').on(table.template_id),
  chargeNurseIdx: index('idx_shift_instances_charge_nurse').on(table.charge_nurse_id),
  statusIdx: index('idx_shift_instances_status').on(table.status),
  // Unique: one instance per template+ward+date
  uniqueShiftIdx: uniqueIndex('idx_shift_instances_unique').on(table.template_id, table.ward_id, table.shift_date),
}));

// ── shift_roster ───────────────────────────────────────────────────────────
// Assigns staff members to shift instances.

export const shiftRoster = pgTable('shift_roster', {
  id: uuid('id').defaultRandom().primaryKey(),
  shift_instance_id: uuid('shift_instance_id').notNull().references(() => shiftInstances.id, { onDelete: 'cascade' }),
  user_id: uuid('user_id').notNull(), // references users(id)
  role_during_shift: text('role_during_shift').notNull().default('nurse'), // nurse, charge_nurse, rmo, consultant, etc.
  status: rosterStatusEnum('status').notNull().default('scheduled'),
  assigned_by: uuid('assigned_by'), // admin/charge nurse who made the assignment
  assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  instanceIdx: index('idx_shift_roster_instance').on(table.shift_instance_id),
  userIdx: index('idx_shift_roster_user').on(table.user_id),
  statusIdx: index('idx_shift_roster_status').on(table.status),
  // Unique: one user per shift instance
  uniqueAssignmentIdx: uniqueIndex('idx_shift_roster_unique').on(table.shift_instance_id, table.user_id),
}));

// ── shift_swaps ────────────────────────────────────────────────────────────
// Swap requests between staff members.

export const shiftSwaps = pgTable('shift_swaps', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  requesting_user_id: uuid('requesting_user_id').notNull(), // who wants to swap
  target_user_id: uuid('target_user_id').notNull(), // who they want to swap with
  shift_instance_id: uuid('shift_instance_id').notNull().references(() => shiftInstances.id, { onDelete: 'cascade' }),
  swap_shift_instance_id: uuid('swap_shift_instance_id').notNull().references(() => shiftInstances.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  status: swapStatusEnum('status').notNull().default('pending_target'),
  target_confirmed_at: timestamp('target_confirmed_at', { withTimezone: true }),
  approved_by: uuid('approved_by'),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  denial_reason: text('denial_reason'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_shift_swaps_hospital').on(table.hospital_id),
  requestingUserIdx: index('idx_shift_swaps_requesting').on(table.requesting_user_id),
  targetUserIdx: index('idx_shift_swaps_target').on(table.target_user_id),
  statusIdx: index('idx_shift_swaps_status').on(table.status),
  instanceIdx: index('idx_shift_swaps_instance').on(table.shift_instance_id),
}));

// ── leave_requests ─────────────────────────────────────────────────────────
// Staff leave/absence tracking.

export const leaveRequests = pgTable('leave_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  user_id: uuid('user_id').notNull(), // references users(id)
  leave_type: leaveTypeEnum('leave_type').notNull(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date').notNull(),
  reason: text('reason'),
  status: leaveStatusEnum('status').notNull().default('pending'),
  approved_by: uuid('approved_by'),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  denial_reason: text('denial_reason'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_leave_requests_hospital').on(table.hospital_id),
  userIdx: index('idx_leave_requests_user').on(table.user_id),
  statusIdx: index('idx_leave_requests_status').on(table.status),
  dateRangeIdx: index('idx_leave_requests_dates').on(table.start_date, table.end_date),
}));

// ── staffing_targets ───────────────────────────────────────────────────────
// NABH-compliant nurse:patient ratios per ward type.

export const staffingTargets = pgTable('staffing_targets', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  ward_type: wardTypeEnum('ward_type').notNull(),
  role: text('role').notNull().default('nurse'), // nurse, rmo, consultant
  min_ratio: real('min_ratio').notNull(), // e.g. 0.5 means 1 nurse per 2 patients
  optimal_ratio: real('optimal_ratio').notNull(), // e.g. 0.33 means 1 nurse per 3 patients
  amber_threshold_pct: real('amber_threshold_pct').notNull().default(20), // warn at 20% above min
  notes: text('notes'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_staffing_targets_hospital').on(table.hospital_id),
  wardTypeIdx: uniqueIndex('idx_staffing_targets_ward_role').on(table.hospital_id, table.ward_type, table.role),
}));

// ── overtime_log ───────────────────────────────────────────────────────────
// Weekly/monthly overtime tracking per staff member.

export const overtimeLog = pgTable('overtime_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  user_id: uuid('user_id').notNull(), // references users(id)
  period_start: date('period_start').notNull(),
  period_end: date('period_end').notNull(),
  scheduled_hours: real('scheduled_hours').notNull().default(0),
  actual_hours: real('actual_hours').notNull().default(0),
  overtime_hours: real('overtime_hours').notNull().default(0),
  consecutive_shifts: integer('consecutive_shifts').notNull().default(0),
  is_flagged: boolean('is_flagged').notNull().default(false),
  flag_reason: text('flag_reason'),
  approved_by: uuid('approved_by'),
  approved_at: timestamp('approved_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdx: index('idx_overtime_log_hospital').on(table.hospital_id),
  userIdx: index('idx_overtime_log_user').on(table.user_id),
  periodIdx: index('idx_overtime_log_period').on(table.period_start, table.period_end),
  flaggedIdx: index('idx_overtime_log_flagged').on(table.is_flagged),
  uniquePeriodIdx: uniqueIndex('idx_overtime_log_unique').on(table.user_id, table.period_start, table.period_end),
}));

// ── Relations ──────────────────────────────────────────────────────────────

export const shiftTemplateRelations = relations(shiftTemplates, ({ many }) => ({
  instances: many(shiftInstances),
}));

export const shiftInstanceRelations = relations(shiftInstances, ({ one, many }) => ({
  template: one(shiftTemplates, { fields: [shiftInstances.template_id], references: [shiftTemplates.id] }),
  roster: many(shiftRoster),
  swapsFrom: many(shiftSwaps, { relationName: 'swapFrom' }),
  swapsTo: many(shiftSwaps, { relationName: 'swapTo' }),
}));

export const shiftRosterRelations = relations(shiftRoster, ({ one }) => ({
  shiftInstance: one(shiftInstances, { fields: [shiftRoster.shift_instance_id], references: [shiftInstances.id] }),
}));

export const shiftSwapRelations = relations(shiftSwaps, ({ one }) => ({
  sourceShift: one(shiftInstances, { fields: [shiftSwaps.shift_instance_id], references: [shiftInstances.id], relationName: 'swapFrom' }),
  targetShift: one(shiftInstances, { fields: [shiftSwaps.swap_shift_instance_id], references: [shiftInstances.id], relationName: 'swapTo' }),
}));
