import {
  pgTable, text, varchar, boolean, timestamp, integer, jsonb,
  index, uuid, pgEnum,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';

// ============================================================
// ENUMS — HL7 Analyzer Integration (Module 8 — L.8)
// ============================================================

export const hl7AdapterStatusEnum = pgEnum('hl7_adapter_status', [
  'active', 'inactive', 'error', 'maintenance',
]);

export const hl7DirectionEnum = pgEnum('hl7_direction', [
  'inbound', 'outbound', 'bidirectional',
]);

export const hl7MessageStatusEnum = pgEnum('hl7_message_status', [
  'received', 'parsed', 'mapped', 'processed', 'error', 'ack_sent', 'nack_sent', 'retry', 'dead_letter',
]);

export const hl7MessageTypeEnum = pgEnum('hl7_message_type', [
  'ORM_O01', 'ORU_R01', 'OML_O21', 'OUL_R22', 'ADT_A01', 'ADT_A08', 'ACK', 'QBP_Q11', 'RSP_K11', 'other',
]);

export const hl7ProtocolEnum = pgEnum('hl7_protocol', [
  'mllp', 'http', 'file_drop', 'serial', 'astm',
]);

// ============================================================
// TABLE 1 — hl7_adapters: Analyzer connection configurations
// ============================================================

export const hl7Adapters = pgTable('hl7_adapters', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.id),

  // Analyzer identity
  name: varchar('name', { length: 200 }).notNull(),
  manufacturer: varchar('manufacturer', { length: 200 }),
  model: varchar('model', { length: 200 }),
  serial_number: varchar('serial_number', { length: 100 }),
  department: varchar('department', { length: 100 }),
  location: varchar('location', { length: 200 }),

  // Connection
  protocol: hl7ProtocolEnum('protocol').notNull().default('mllp'),
  direction: hl7DirectionEnum('direction').notNull().default('bidirectional'),
  host: varchar('host', { length: 255 }),
  port: integer('port'),
  file_path: text('file_path'),                               // for file_drop / serial
  hl7_version: varchar('hl7_version', { length: 10 }).default('2.5.1'),

  // Mapping
  field_mapping: jsonb('field_mapping'),                       // { OBX_3: 'test_code', OBX_5: 'result_value', ... }
  test_code_map: jsonb('test_code_map'),                       // { "GLU": "glucose", "HB": "hemoglobin", ... }
  unit_conversion: jsonb('unit_conversion'),                   // { "glucose": { from: "mmol/L", to: "mg/dL", factor: 18.0 } }

  // Health & monitoring
  status: hl7AdapterStatusEnum('status').notNull().default('inactive'),
  last_heartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  last_message_at: timestamp('last_message_at', { withTimezone: true }),
  messages_today: integer('messages_today').notNull().default(0),
  errors_today: integer('errors_today').notNull().default(0),
  uptime_percent: integer('uptime_percent'),                   // 0-100

  // Retry config
  retry_max: integer('retry_max').notNull().default(3),
  retry_delay_ms: integer('retry_delay_ms').notNull().default(5000),
  dead_letter_after: integer('dead_letter_after').notNull().default(5),

  created_by: text('created_by').notNull().references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('hl7_adapters_hospital_idx').on(t.hospital_id),
  statusIdx: index('hl7_adapters_status_idx').on(t.status),
}));

// ============================================================
// TABLE 2 — hl7_messages: Message log with full audit trail
// ============================================================

export const hl7Messages = pgTable('hl7_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.id),
  adapter_id: uuid('adapter_id').notNull().references(() => hl7Adapters.id),

  // Message identity
  message_control_id: varchar('message_control_id', { length: 100 }),
  message_type: hl7MessageTypeEnum('message_type').notNull(),
  direction: hl7DirectionEnum('direction').notNull(),
  hl7_version: varchar('hl7_version', { length: 10 }),

  // Content
  raw_message: text('raw_message'),                            // original HL7 message
  parsed_segments: jsonb('parsed_segments'),                   // { MSH: {...}, PID: {...}, OBR: [...], OBX: [...] }
  mapped_data: jsonb('mapped_data'),                           // normalized data after field mapping

  // Processing
  status: hl7MessageStatusEnum('status').notNull().default('received'),
  error_message: text('error_message'),
  error_segment: varchar('error_segment', { length: 10 }),     // which segment failed

  // Linking
  patient_id: uuid('patient_id'),
  encounter_id: uuid('encounter_id'),
  order_id: uuid('order_id'),
  result_id: uuid('result_id'),

  // ACK tracking
  ack_code: varchar('ack_code', { length: 5 }),                // AA, AE, AR
  ack_message: text('ack_message'),
  ack_sent_at: timestamp('ack_sent_at', { withTimezone: true }),

  // Retry
  retry_count: integer('retry_count').notNull().default(0),
  next_retry_at: timestamp('next_retry_at', { withTimezone: true }),

  // Timing
  received_at: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  parsed_at: timestamp('parsed_at', { withTimezone: true }),
  processed_at: timestamp('processed_at', { withTimezone: true }),
  processing_time_ms: integer('processing_time_ms'),

  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hospitalIdx: index('hl7_messages_hospital_idx').on(t.hospital_id),
  adapterIdx: index('hl7_messages_adapter_idx').on(t.adapter_id),
  statusIdx: index('hl7_messages_status_idx').on(t.status),
  typeIdx: index('hl7_messages_type_idx').on(t.message_type),
  receivedIdx: index('hl7_messages_received_idx').on(t.received_at),
  controlIdx: index('hl7_messages_control_idx').on(t.message_control_id),
}));

// ============================================================
// TABLE 3 — hl7_adapter_events: Health monitoring event log
// ============================================================

export const hl7AdapterEvents = pgTable('hl7_adapter_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  hospital_id: text('hospital_id').notNull().references(() => hospitals.id),
  adapter_id: uuid('adapter_id').notNull().references(() => hl7Adapters.id),

  event_type: varchar('event_type', { length: 50 }).notNull(),  // connected, disconnected, error, heartbeat, config_change, maintenance_start, maintenance_end
  severity: varchar('severity', { length: 20 }).notNull().default('info'),  // info, warning, error, critical
  message: text('message'),
  metadata: jsonb('metadata'),                                   // extra context

  recorded_at: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recorded_by: text('recorded_by').references(() => users.id),
}, (t) => ({
  adapterIdx: index('hl7_events_adapter_idx').on(t.adapter_id),
  typeIdx: index('hl7_events_type_idx').on(t.event_type),
  recordedIdx: index('hl7_events_recorded_idx').on(t.recorded_at),
}));
