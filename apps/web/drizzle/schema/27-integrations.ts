import { pgTable, text, timestamp, uuid, index, jsonb, boolean } from 'drizzle-orm/pg-core';

// ── 1. HL7 Integration Messages (Module 15 — extends 25-hl7-analyzer) ────
// NOTE: The base hl7_messages table is defined in 25-hl7-analyzer.ts.
// This export uses a different name to avoid conflict; both map to the same DB table.
export const hl7IntegrationMessages = pgTable(
  'hl7_integration_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    message_control_id: text('message_control_id').unique().notNull(),
    message_type: text('message_type').notNull(), // ORM, ORU, ADT, SIU
    message_version: text('message_version').notNull(),
    direction: text('direction').notNull(), // inbound, outbound
    source_system: text('source_system').notNull(),
    receiving_system: text('receiving_system').notNull(),
    raw_message: text('raw_message').notNull(),
    raw_message_hash: text('raw_message_hash').notNull(),
    parsed_segments: jsonb('parsed_segments').notNull(),
    patient_id: uuid('patient_id'),
    patient_uhid: text('patient_uhid'),
    order_id: uuid('order_id'),
    result_id: uuid('result_id'),
    encounter_id: uuid('encounter_id'),
    status: text('status').notNull(), // received, parsed, validated, transformed, stored, error, duplicate_skipped
    processing_error: text('processing_error'),
    is_valid: boolean('is_valid').default(false),
    validation_errors: jsonb('validation_errors'),
    is_duplicate: boolean('is_duplicate').default(false),
    duplicate_of_id: uuid('duplicate_of_id'),
    created_at: timestamp('created_at').defaultNow(),
    processed_at: timestamp('processed_at'),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    messageControlIdIdx: index('hl7_messages_control_id_idx').on(table.message_control_id),
    messageTypeIdx: index('hl7_messages_type_idx').on(table.message_type),
    directionIdx: index('hl7_messages_direction_idx').on(table.direction),
    sourceSystemIdx: index('hl7_messages_source_system_idx').on(table.source_system),
    patientIdIdx: index('hl7_messages_patient_id_idx').on(table.patient_id),
    statusIdx: index('hl7_messages_status_idx').on(table.status),
    isDuplicateIdx: index('hl7_messages_is_duplicate_idx').on(table.is_duplicate),
    createdAtIdx: index('hl7_messages_created_at_idx').on(table.created_at),
  })
);

// ── 2. Integration Endpoints ─────────────────────────────────────────────
export const integrationEndpoints = pgTable(
  'integration_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    system_name: text('system_name').unique().notNull(),
    display_name: text('display_name'),
    integration_type: text('integration_type').notNull(), // hl7_receiver, hl7_sender, rest_api, webhook_receiver, fhir_server
    protocol: text('protocol').notNull(), // http, https, sftp, hl7_mllp, fhir_rest
    endpoint_url: text('endpoint_url'),
    host: text('host'),
    port: text('port'),
    auth_type: text('auth_type'), // api_key, oauth2, basic, bearer_token, mTLS
    auth_config: jsonb('auth_config'),
    status: text('status').notNull(), // active, inactive, error, degraded, stub
    last_heartbeat_at: timestamp('last_heartbeat_at'),
    heartbeat_interval_minutes: text('heartbeat_interval_minutes').default('15'),
    consecutive_failures: text('consecutive_failures').default('0'),
    last_error_message: text('last_error_message'),
    rate_limit_per_minute: text('rate_limit_per_minute'),
    rate_limit_per_day: text('rate_limit_per_day'),
    retry_enabled: boolean('retry_enabled').default(true),
    retry_max_attempts: text('retry_max_attempts').default('3'),
    retry_backoff_seconds: text('retry_backoff_seconds').default('60'),
    use_mtls: boolean('use_mtls').default(false),
    client_cert_vault_ref: text('client_cert_vault_ref'),
    server_ca_cert_vault_ref: text('server_ca_cert_vault_ref'),
    is_production: boolean('is_production').default(false),
    owner_team: text('owner_team'),
    owner_contact: text('owner_contact'),
    notes: text('notes'),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    systemNameIdx: index('endpoints_system_name_idx').on(table.system_name),
    statusIdx: index('endpoints_status_idx').on(table.status),
    protocolIdx: index('endpoints_protocol_idx').on(table.protocol),
    lastHeartbeatIdx: index('endpoints_last_heartbeat_idx').on(table.last_heartbeat_at),
  })
);

// ── 3. Integration Audit Log (immutable) ─────────────────────────────────
export const integrationAuditLog = pgTable(
  'integration_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    event_type: text('event_type').notNull(), // message_received, message_sent, message_processed, transformation_error, auth_failure, rate_limit_exceeded
    endpoint_id: uuid('endpoint_id').notNull(),
    hl7_message_id: uuid('hl7_message_id'),
    message_control_id: text('message_control_id'),
    message_type: text('message_type'),
    direction: text('direction'),
    patient_uhid: text('patient_uhid'),
    http_method: text('http_method'),
    http_status_code: text('http_status_code'),
    processing_status: text('processing_status'), // success, failure, partial, timeout
    processing_duration_ms: text('processing_duration_ms'),
    error_code: text('error_code'),
    error_message: text('error_message'),
    payload_size_bytes: text('payload_size_bytes'),
    masked_payload_preview: text('masked_payload_preview'),
    source_ip_address: text('source_ip_address'),
    user_agent: text('user_agent'),
    audit_timestamp: timestamp('audit_timestamp').defaultNow(),
    retention_expires_at: timestamp('retention_expires_at'),
    created_at: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    eventTypeIdx: index('audit_log_event_type_idx').on(table.event_type),
    endpointIdIdx: index('audit_log_endpoint_id_idx').on(table.endpoint_id),
    messageControlIdIdx: index('audit_log_control_id_idx').on(table.message_control_id),
    patientUhidIdx: index('audit_log_patient_uhid_idx').on(table.patient_uhid),
    processingStatusIdx: index('audit_log_status_idx').on(table.processing_status),
    auditTimestampIdx: index('audit_log_timestamp_idx').on(table.audit_timestamp),
    retentionExpiresIdx: index('audit_log_retention_idx').on(table.retention_expires_at),
  })
);

// ── 4. ABHA Verification Log (immutable) ─────────────────────────────────
export const abhaVerificationLog = pgTable(
  'abha_verification_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    verification_id: text('verification_id').unique(),
    abha_id: text('abha_id'),
    patient_id: uuid('patient_id'),
    patient_uhid: text('patient_uhid'),
    verification_method: text('verification_method').notNull(), // standard, biometric
    verification_type: text('verification_type').notNull(), // format_check, checksum_validation, nha_lookup
    verified: boolean('verified').notNull(),
    verification_status: text('verification_status').notNull(), // verified, not_verified, expired, invalid_format, error
    error_code: text('error_code'),
    error_message: text('error_message'),
    verification_metadata: jsonb('verification_metadata'),
    ip_address: text('ip_address'),
    rate_limit_exceeded: boolean('rate_limit_exceeded').default(false),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    verificationIdIdx: index('abha_log_verification_id_idx').on(table.verification_id),
    abhaIdIdx: index('abha_log_abha_id_idx').on(table.abha_id),
    patientIdIdx: index('abha_log_patient_id_idx').on(table.patient_id),
    verifiedIdx: index('abha_log_verified_idx').on(table.verified),
    createdAtIdx: index('abha_log_created_at_idx').on(table.created_at),
  })
);

// ── 5. LSQ Integration Sync Log (Module 15 — extends 03-registration) ────
// NOTE: The base lsq_sync_log table is defined in 03-registration.ts.
// This export uses a different name to avoid conflict.
export const lsqIntegrationSyncLog = pgTable(
  'lsq_integration_sync_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sync_batch_id: text('sync_batch_id'),
    sync_type: text('sync_type').notNull(), // opd_inquiry, admission, pre_auth, follow_up, generic_update
    patient_id: uuid('patient_id'),
    patient_uhid: text('patient_uhid'),
    win_capture_id: uuid('win_capture_id'),
    encounter_id: uuid('encounter_id'),
    lsq_lead_id: text('lsq_lead_id'),
    lsq_contact_id: text('lsq_contact_id'),
    event_data: jsonb('event_data').notNull(),
    dedup_checked: boolean('dedup_checked').default(true),
    dedup_match_uhid: text('dedup_match_uhid'),
    dedup_action: text('dedup_action'), // none, marked_duplicate, merged
    sync_status: text('sync_status').notNull(), // success, failure, partial, skipped_duplicate
    http_status_code: text('http_status_code'),
    error_message: text('error_message'),
    retry_count: text('retry_count').default('0'),
    next_retry_at: timestamp('next_retry_at'),
    lsq_response: jsonb('lsq_response'),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    syncBatchIdIdx: index('lsq_sync_batch_id_idx').on(table.sync_batch_id),
    syncTypeIdx: index('lsq_sync_type_idx').on(table.sync_type),
    patientIdIdx: index('lsq_sync_patient_id_idx').on(table.patient_id),
    lsqLeadIdIdx: index('lsq_sync_lsq_lead_id_idx').on(table.lsq_lead_id),
    syncStatusIdx: index('lsq_sync_status_idx').on(table.sync_status),
    dedupMatchIdx: index('lsq_sync_dedup_match_idx').on(table.dedup_match_uhid),
    createdAtIdx: index('lsq_sync_created_at_idx').on(table.created_at),
  })
);

// ── 6. WhatsApp Queue ────────────────────────────────────────────────────
export const whatsappQueue = pgTable(
  'whatsapp_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    message_uuid: text('message_uuid').unique(),
    patient_id: uuid('patient_id').notNull(),
    patient_phone: text('patient_phone').notNull(),
    message_type: text('message_type').notNull(), // appointment_reminder, lab_result, discharge_summary, med_alert, generic
    template_id: text('template_id'),
    message_text: text('message_text'),
    message_params: jsonb('message_params'),
    trigger_type: text('trigger_type'), // manual, automated_workflow, notification
    trigger_id: uuid('trigger_id'),
    status: text('status').notNull(), // queued, sent, delivered, failed, bounced, opt_out, v2_only
    attempt_count: text('attempt_count').default('0'),
    max_attempts: text('max_attempts').default('3'),
    sent_at: timestamp('sent_at'),
    delivered_at: timestamp('delivered_at'),
    twilio_message_sid: text('twilio_message_sid'),
    last_error_code: text('last_error_code'),
    last_error_message: text('last_error_message'),
    next_retry_at: timestamp('next_retry_at'),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
    expires_at: timestamp('expires_at'),
  },
  (table) => ({
    patientIdIdx: index('whatsapp_patient_id_idx').on(table.patient_id),
    statusIdx: index('whatsapp_status_idx').on(table.status),
    messageTypeIdx: index('whatsapp_message_type_idx').on(table.message_type),
    createdAtIdx: index('whatsapp_created_at_idx').on(table.created_at),
    expiresAtIdx: index('whatsapp_expires_at_idx').on(table.expires_at),
    nextRetryIdx: index('whatsapp_next_retry_idx').on(table.next_retry_at),
  })
);

// ── 7. Event Bus Subscriptions ───────────────────────────────────────────
export const eventBusSubscriptions = pgTable(
  'event_bus_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscription_id: text('subscription_id').unique(),
    topic_name: text('topic_name').notNull(), // order.created, result.finalized, patient.admitted, etc.
    topic_category: text('topic_category').notNull(), // clinical, billing, admin, communication
    subscriber_module: text('subscriber_module').notNull(),
    subscriber_endpoint: text('subscriber_endpoint').notNull(),
    handler_type: text('handler_type').notNull(), // webhook_http, internal_callback, message_queue
    retry_enabled: boolean('retry_enabled').default(true),
    retry_max_attempts: text('retry_max_attempts').default('3'),
    retry_backoff_seconds: text('retry_backoff_seconds').default('60'),
    dlq_enabled: boolean('dlq_enabled').default(true),
    dlq_topic: text('dlq_topic').default('event_bus.dlq'),
    event_filter: jsonb('event_filter'),
    is_active: boolean('is_active').default(true),
    last_event_received_at: timestamp('last_event_received_at'),
    consecutive_failures: text('consecutive_failures').default('0'),
    last_error_message: text('last_error_message'),
    created_at: timestamp('created_at').defaultNow(),
    updated_at: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    topicNameIdx: index('event_sub_topic_idx').on(table.topic_name),
    subscriberModuleIdx: index('event_sub_module_idx').on(table.subscriber_module),
    isActiveIdx: index('event_sub_active_idx').on(table.is_active),
    lastEventReceivedIdx: index('event_sub_last_received_idx').on(table.last_event_received_at),
  })
);
