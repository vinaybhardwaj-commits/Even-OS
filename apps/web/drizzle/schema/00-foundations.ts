import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb, numeric,
  uniqueIndex, index, uuid, pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================
// ENUMS
// ============================================================

export const userRoleEnum = pgEnum('user_role', [
  'super_admin', 'hospital_admin', 'system_super_admin',
  'medical_director', 'department_head',
  'coo', 'cfo', 'hospital_director',
  'operations_manager', 'hr_manager', 'compliance_officer', 'data_officer',
  'senior_resident', 'resident', 'intern', 'visiting_consultant',
  'specialist_cardiologist', 'specialist_neurologist', 'specialist_orthopedic', 'hospitalist',
  'senior_nurse', 'nurse', 'nursing_assistant', 'charge_nurse', 'nursing_supervisor', 'nursing_manager',
  'chief_pharmacist', 'senior_pharmacist', 'pharmacist', 'pharmacy_technician',
  'lab_director', 'senior_lab_technician', 'lab_technician', 'phlebotomist', 'lab_manager',
  'chief_radiologist', 'senior_radiologist', 'radiologist', 'radiology_technician',
  'billing_manager', 'billing_executive', 'insurance_coordinator', 'financial_analyst', 'accounts_manager',
  'receptionist', 'ip_coordinator', 'security_personnel', 'housekeeping_supervisor',
  'surgeon', 'anaesthetist', 'ot_nurse',
  'staff',
]);

export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'deleted']);
export const sessionStatusEnum = pgEnum('session_status', ['active', 'expired', 'revoked']);
export const auditActionEnum = pgEnum('audit_action', ['INSERT', 'UPDATE', 'DELETE', 'META_AUDIT']);
export const roleGroupEnum = pgEnum('role_group', [
  'clinical', 'nursing', 'admin', 'billing', 'pharmacy', 'lab', 'radiology', 'support', 'executive', 'system'
]);
export const eventTypeEnum = pgEnum('event_type', ['CREATED', 'UPDATED', 'DELETED', 'CORRECTED']);
export const errorSeverityEnum = pgEnum('error_severity', ['error', 'warning', 'info']);

// ============================================================
// HOSPITALS (Multi-tenancy root)
// ============================================================

export const hospitals = pgTable('hospitals', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().unique(), // e.g., 'EVEN-RACE-COURSE', 'INDI-01'
  name: text('name').notNull(),
  country: text('country').notNull().default('India'),
  state: text('state').notNull(),
  city: text('city').notNull(),
  zipcode: text('zipcode'),
  address: text('address'),
  nabh_certified: boolean('nabh_certified').notNull().default(false),
  abha_enabled: boolean('abha_enabled').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalIdIdx: index('idx_hospitals_hospital_id').on(table.hospital_id),
  nabhIdx: index('idx_hospitals_nabh_certified').on(table.nabh_certified),
}));

// ============================================================
// INVOICE SEQUENCES (atomically-incremented sequence numbers per hospital)
// ============================================================

export const invoiceSequences = pgTable('invoice_sequences', {
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }).primaryKey(),
  prefix: varchar('prefix', { length: 10 }).notNull().default('INV'),
  next_value: integer('next_value').notNull().default(1),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hospitalPrefixIdx: index('idx_invoice_sequences_hospital_prefix').on(table.hospital_id, table.prefix),
}));

// ============================================================
// USERS
// ============================================================

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  email: text('email').notNull(),
  password_hash: text('password_hash'), // bcrypt, nullable for SSO-only (v2)
  full_name: text('full_name').notNull(),
  department: text('department').notNull(),
  roles: text('roles').array(), // Array of role names, e.g., ["senior_resident", "teaching"]
  status: userStatusEnum('status').notNull().default('active'),
  device_fingerprints: jsonb('device_fingerprints').default([]), // Array of {fingerprint_hash, device_name, first_seen_at, last_seen_at}
  biometric_enrolled: boolean('biometric_enrolled').notNull().default(false),
  biometric_template_hash: text('biometric_template_hash'), // Hash of biometric template
  must_change_password: boolean('must_change_password').notNull().default(false),
  first_login_at: timestamp('first_login_at', { withTimezone: true }),
  last_active_at: timestamp('last_active_at', { withTimezone: true }),
  login_count: integer('login_count').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailHospitalIdx: uniqueIndex('idx_users_email_hospital').on(table.email, table.hospital_id),
  statusIdx: index('idx_users_status').on(table.status),
  departmentIdx: index('idx_users_department').on(table.department),
  biometricIdx: index('idx_users_biometric_enrolled').on(table.biometric_enrolled),
}));

// ============================================================
// SESSIONS
// ============================================================

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  device_fingerprint: text('device_fingerprint').notNull(),
  device_name: text('device_name'), // e.g., "Chrome on Windows", "Safari on iPad"
  access_token_hash: text('access_token_hash').notNull(),
  refresh_token_hash: text('refresh_token_hash').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  last_activity_at: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_sessions_user_id').on(table.user_id),
  expiresAtIdx: index('idx_sessions_expires_at').on(table.expires_at),
  revokedAtIdx: index('idx_sessions_revoked_at').on(table.revoked_at),
  hospitalIdIdx: index('idx_sessions_hospital_id').on(table.hospital_id),
}));

// ============================================================
// ROLES
// ============================================================

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').references(() => hospitals.hospital_id, { onDelete: 'cascade' }), // NULL for system roles
  name: text('name').notNull(),
  description: text('description'),
  role_group: roleGroupEnum('role_group').notNull(),
  session_timeout_minutes: integer('session_timeout_minutes').notNull().default(480),
  is_active: boolean('is_active').notNull().default(true),
  is_system_role: boolean('is_system_role').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  nameHospitalIdx: index('idx_roles_name_hospital').on(table.name, table.hospital_id),
  roleGroupIdx: index('idx_roles_role_group').on(table.role_group),
  isActiveIdx: index('idx_roles_is_active').on(table.is_active),
}));

// ============================================================
// PERMISSIONS
// ============================================================

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  resource: text('resource').notNull(),
  action: text('action').notNull(),
  description: text('description'),
  is_system_permission: boolean('is_system_permission').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  resourceActionIdx: uniqueIndex('idx_permissions_resource_action').on(table.resource, table.action),
}));

// ============================================================
// ROLE PERMISSIONS
// ============================================================

export const rolePermissions = pgTable('role_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  role_id: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permission_id: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  rolePermissionIdx: uniqueIndex('idx_role_permissions_unique').on(table.role_id, table.permission_id),
  roleIdIdx: index('idx_role_permissions_role_id').on(table.role_id),
  permissionIdIdx: index('idx_role_permissions_permission_id').on(table.permission_id),
}));

// ============================================================
// AUDIT LOG (append-only, immutable)
// ============================================================

export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  table_name: text('table_name').notNull(),
  row_id: text('row_id').notNull(),
  action: auditActionEnum('action').notNull(),
  old_data: jsonb('old_data'), // Previous row state (NULL for INSERT)
  new_data: jsonb('new_data'), // Current row state (NULL for DELETE)
  delta: jsonb('delta'), // Changed fields only for UPDATE
  actor_id: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actor_email: text('actor_email'), // Denormalized for easier querying
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  reason: text('reason'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tableNameIdx: index('idx_audit_log_table_name').on(table.table_name),
  rowIdIdx: index('idx_audit_log_row_id').on(table.row_id),
  actorIdIdx: index('idx_audit_log_actor_id').on(table.actor_id),
  timestampIdx: index('idx_audit_log_timestamp').on(table.timestamp),
  hospitalIdIdx: index('idx_audit_log_hospital_id').on(table.hospital_id),
  compositeIdx: index('idx_audit_log_table_row_timestamp').on(table.table_name, table.row_id, table.timestamp),
}));

// ============================================================
// EVENT LOG (clinical resource versioning, append-only)
// ============================================================

export const eventLog = pgTable('event_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  resource_type: text('resource_type').notNull(), // e.g., "Patient", "MedicationRequest", "LabResult"
  resource_id: uuid('resource_id').notNull(),
  version: integer('version').notNull(),
  event_type: eventTypeEnum('event_type').notNull(),
  data: jsonb('data').notNull(), // Full resource state at this version
  delta: jsonb('delta'), // Changed fields only
  actor_id: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'set null' }),
  actor_email: text('actor_email'),
  reason: text('reason'),
  ip_address: text('ip_address'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  resourceIdIdx: index('idx_event_log_resource_id').on(table.resource_id),
  resourceTypeIdx: index('idx_event_log_resource_type').on(table.resource_type),
  versionIdx: index('idx_event_log_version').on(table.version),
  actorIdIdx: index('idx_event_log_actor_id').on(table.actor_id),
  timestampIdx: index('idx_event_log_timestamp').on(table.timestamp),
  hospitalIdIdx: index('idx_event_log_hospital_id').on(table.hospital_id),
  resourceVersionIdx: uniqueIndex('idx_event_log_resource_version').on(table.resource_id, table.version),
}));

// ============================================================
// CONFIG ENTITIES (hospital-wide settings with effective dating)
// ============================================================

export const configEntities = pgTable('config_entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  value_type: text('value_type').notNull(), // 'int', 'string', 'boolean', 'object', 'array'
  effective_date: timestamp('effective_date', { withTimezone: true }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  description: text('description'),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  keyHospitalEffectiveIdx: index('idx_config_entities_key_hospital_effective').on(
    table.key,
    table.hospital_id,
    table.effective_date
  ),
  hospitalIdIdx: index('idx_config_entities_hospital_id').on(table.hospital_id),
  isActiveIdx: index('idx_config_entities_is_active').on(table.is_active),
}));

// ============================================================
// PUSH SUBSCRIPTIONS (web push notifications)
// ============================================================

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  auth_encrypted: text('auth_encrypted').notNull(), // Encrypted at rest
  p256dh_encrypted: text('p256dh_encrypted').notNull(), // Encrypted at rest
  browser: text('browser'), // e.g., "Chrome", "Safari"
  device_name: text('device_name'), // e.g., "Work Laptop", "Personal iPad"
  is_active: boolean('is_active').notNull().default(true),
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_push_subscriptions_user_id').on(table.user_id),
  hospitalIdIdx: index('idx_push_subscriptions_hospital_id').on(table.hospital_id),
  isActiveIdx: index('idx_push_subscriptions_is_active').on(table.is_active),
}));

// ============================================================
// ERROR LOG (client + server error capture)
// ============================================================

export const errorLog = pgTable('error_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  session_id: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  error_type: text('error_type').notNull(),
  error_message: text('error_message'),
  stack_trace: text('stack_trace'),
  url: text('url'),
  user_agent: text('user_agent'),
  ip_address: text('ip_address'),
  browser: text('browser'),
  os: text('os'),
  context: jsonb('context'), // Additional context
  severity: errorSeverityEnum('severity').notNull().default('error'),
  is_resolved: boolean('is_resolved').notNull().default(false),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  resolved_by: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolution_notes: text('resolution_notes'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_error_log_user_id').on(table.user_id),
  errorTypeIdx: index('idx_error_log_error_type').on(table.error_type),
  timestampIdx: index('idx_error_log_timestamp').on(table.timestamp),
  hospitalIdIdx: index('idx_error_log_hospital_id').on(table.hospital_id),
  sessionIdIdx: index('idx_error_log_session_id').on(table.session_id),
}));

// ============================================================
// LOGIN ATTEMPTS (rate limiting + fraud detection)
// ============================================================

export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  email: text('email').notNull(),
  ip_address: text('ip_address').notNull(),
  user_agent: text('user_agent'),
  attempted_at: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  success: boolean('success').notNull(),
  failure_reason: text('failure_reason'), // 'password_mismatch', 'user_not_found', 'account_suspended', 'device_mismatch'
}, (table) => ({
  emailIpIdx: index('idx_login_attempts_email_ip').on(table.email, table.ip_address),
  attemptedAtIdx: index('idx_login_attempts_attempted_at').on(table.attempted_at),
  hospitalIdIdx: index('idx_login_attempts_hospital_id').on(table.hospital_id),
}));

// ============================================================
// VERIFICATION CODES (OTP + password reset tokens)
// ============================================================

export const verificationCodes = pgTable('verification_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  code_hash: text('code_hash').notNull(),
  purpose: text('purpose').notNull(), // 'device_verification', 'password_reset'
  metadata: jsonb('metadata').default({}),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  used_at: timestamp('used_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_verification_codes_user_id').on(table.user_id),
  purposeIdx: index('idx_verification_codes_purpose').on(table.purpose),
  expiresAtIdx: index('idx_verification_codes_expires_at').on(table.expires_at),
}));

// ============================================================
// BREAK GLASS LOG (emergency access audit)
// ============================================================

export const breakGlassLog = pgTable('break_glass_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  user_email: text('user_email').notNull(),
  user_role: text('user_role').notNull(),
  reason: text('reason').notNull(),
  elevated_to: text('elevated_to').notNull().default('emergency_access'),
  granted_at: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  revoked_by: uuid('revoked_by').references(() => users.id),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
  reviewed_by: uuid('reviewed_by').references(() => users.id),
  review_notes: text('review_notes'),
}, (table) => ({
  userIdIdx: index('idx_break_glass_log_user_id').on(table.user_id),
  hospitalIdIdx: index('idx_break_glass_log_hospital_id').on(table.hospital_id),
  expiresAtIdx: index('idx_break_glass_log_expires_at').on(table.expires_at),
}));

// ============================================================
// TRUSTED DEVICES (device binding)
// ============================================================

export const trustedDevices = pgTable('trusted_devices', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  device_id: text('device_id').notNull(),
  device_name: text('device_name'),
  browser: text('browser'),
  os: text('os'),
  ip_address: text('ip_address'),
  first_seen_at: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  is_active: boolean('is_active').notNull().default(true),
}, (table) => ({
  userIdIdx: index('idx_trusted_devices_user_id').on(table.user_id),
  userDeviceIdx: uniqueIndex('idx_trusted_devices_user_device').on(table.user_id, table.device_id),
}));

// ============================================================
// RELATIONS
// ============================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [users.hospital_id], references: [hospitals.hospital_id] }),
  sessions: many(sessions),
  auditLogEntries: many(auditLog),
  eventLogEntries: many(eventLog),
  pushSubscriptions: many(pushSubscriptions),
  errorLogEntries: many(errorLog),
  configEntitiesCreated: many(configEntities, { relationName: 'created_by' }),
  configEntitiesUpdated: many(configEntities, { relationName: 'updated_by' }),
}));

export const hospitalsRelations = relations(hospitals, ({ many }) => ({
  users: many(users),
  sessions: many(sessions),
  roles: many(roles),
  auditLog: many(auditLog),
  eventLog: many(eventLog),
  configEntities: many(configEntities),
  pushSubscriptions: many(pushSubscriptions),
  errorLog: many(errorLog),
  loginAttempts: many(loginAttempts),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, { fields: [sessions.user_id], references: [users.id] }),
  hospital: one(hospitals, { fields: [sessions.hospital_id], references: [hospitals.hospital_id] }),
  errorLogEntries: many(errorLog),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  hospital: one(hospitals, { fields: [roles.hospital_id], references: [hospitals.hospital_id] }),
  permissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  roles: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.role_id], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permission_id], references: [permissions.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  hospital: one(hospitals, { fields: [auditLog.hospital_id], references: [hospitals.hospital_id] }),
  actor: one(users, { fields: [auditLog.actor_id], references: [users.id] }),
}));

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  hospital: one(hospitals, { fields: [eventLog.hospital_id], references: [hospitals.hospital_id] }),
  actor: one(users, { fields: [eventLog.actor_id], references: [users.id] }),
}));

export const configEntitiesRelations = relations(configEntities, ({ one }) => ({
  hospital: one(hospitals, { fields: [configEntities.hospital_id], references: [hospitals.hospital_id] }),
  createdBy: one(users, { fields: [configEntities.created_by], references: [users.id], relationName: 'created_by' }),
  updatedBy: one(users, { fields: [configEntities.updated_by], references: [users.id], relationName: 'updated_by' }),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.user_id], references: [users.id] }),
  hospital: one(hospitals, { fields: [pushSubscriptions.hospital_id], references: [hospitals.hospital_id] }),
}));

export const errorLogRelations = relations(errorLog, ({ one }) => ({
  user: one(users, { fields: [errorLog.user_id], references: [users.id] }),
  hospital: one(hospitals, { fields: [errorLog.hospital_id], references: [hospitals.hospital_id] }),
  session: one(sessions, { fields: [errorLog.session_id], references: [sessions.id] }),
  resolvedBy: one(users, { fields: [errorLog.resolved_by], references: [users.id] }),
}));

export const loginAttemptsRelations = relations(loginAttempts, ({ one }) => ({
  hospital: one(hospitals, { fields: [loginAttempts.hospital_id], references: [hospitals.hospital_id] }),
}));

export const verificationCodesRelations = relations(verificationCodes, ({ one }) => ({
  user: one(users, { fields: [verificationCodes.user_id], references: [users.id] }),
}));

export const breakGlassLogRelations = relations(breakGlassLog, ({ one }) => ({
  hospital: one(hospitals, { fields: [breakGlassLog.hospital_id], references: [hospitals.hospital_id] }),
  user: one(users, { fields: [breakGlassLog.user_id], references: [users.id] }),
}));

export const trustedDevicesRelations = relations(trustedDevices, ({ one }) => ({
  user: one(users, { fields: [trustedDevices.user_id], references: [users.id] }),
}));
