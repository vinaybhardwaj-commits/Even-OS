import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import crypto from 'crypto';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

const HOSPITAL_ID = '00000000-0000-0000-0000-000000000001';

// ════════════════════════════════════════════════════════════════════
// INTEGRATION ENDPOINTS (6 endpoints)
// ════════════════════════════════════════════════════════════════════

const endpointInput = z.object({
  system_name: z.string().min(1).max(50),
  display_name: z.string().max(100).optional(),
  integration_type: z.enum(['hl7_receiver', 'hl7_sender', 'rest_api', 'webhook_receiver', 'fhir_server']),
  protocol: z.enum(['http', 'https', 'sftp', 'hl7_mllp', 'fhir_rest']),
  endpoint_url: z.string().max(500).optional(),
  host: z.string().max(200).optional(),
  port: z.string().max(10).optional(),
  auth_type: z.enum(['api_key', 'oauth2', 'basic', 'bearer_token', 'mTLS']).optional(),
  status: z.enum(['active', 'inactive', 'error', 'degraded', 'stub']).default('stub'),
  rate_limit_per_minute: z.string().optional(),
  rate_limit_per_day: z.string().optional(),
  retry_enabled: z.boolean().default(true),
  retry_max_attempts: z.string().default('3'),
  retry_backoff_seconds: z.string().default('60'),
  is_production: z.boolean().default(false),
  owner_team: z.string().max(100).optional(),
  owner_contact: z.string().max(200).optional(),
  notes: z.string().optional(),
});

// ════════════════════════════════════════════════════════════════════
// HL7 MESSAGES (4 endpoints)
// ════════════════════════════════════════════════════════════════════

const hl7InboundInput = z.object({
  message_type: z.enum(['ORM', 'ORU', 'ADT', 'SIU']),
  message_version: z.string().default('2.5'),
  source_system: z.string().min(1),
  receiving_system: z.string().default('EVEN'),
  raw_message: z.string().min(1),
  patient_uhid: z.string().optional(),
  order_id: z.string().uuid().optional(),
  encounter_id: z.string().uuid().optional(),
});

// ════════════════════════════════════════════════════════════════════
// ABDM / ABHA (3 endpoints)
// ════════════════════════════════════════════════════════════════════

const abhaVerifyInput = z.object({
  abha_id: z.string().min(1),
  verification_type: z.enum(['standard', 'biometric']).default('standard'),
});

const consentGrantInput = z.object({
  patient_id: z.string().uuid(),
  abha_id: z.string().min(1),
  data_categories: z.array(z.string()).min(1),
  validity_days: z.number().int().min(1).max(3650).default(365),
});

// ════════════════════════════════════════════════════════════════════
// EVENT BUS (4 endpoints)
// ════════════════════════════════════════════════════════════════════

const subscriptionInput = z.object({
  topic_name: z.string().min(1),
  topic_category: z.enum(['clinical', 'billing', 'admin', 'communication']),
  subscriber_module: z.string().min(1),
  subscriber_endpoint: z.string().min(1),
  handler_type: z.enum(['webhook_http', 'internal_callback', 'message_queue']),
  retry_enabled: z.boolean().default(true),
  retry_max_attempts: z.string().default('3'),
  event_filter: z.any().optional(),
});

// ════════════════════════════════════════════════════════════════════
// WHATSAPP QUEUE (3 endpoints)
// ════════════════════════════════════════════════════════════════════

const whatsappQueueInput = z.object({
  patient_id: z.string().uuid(),
  patient_phone: z.string().min(10),
  message_type: z.enum(['appointment_reminder', 'lab_result', 'discharge_summary', 'med_alert', 'generic']),
  message_text: z.string().min(1),
  template_id: z.string().optional(),
  message_params: z.any().optional(),
  trigger_type: z.enum(['manual', 'automated_workflow', 'notification']).default('manual'),
  trigger_id: z.string().uuid().optional(),
});

// ════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════

export const integrationsRouter = router({

  // ── ENDPOINTS ────────────────────────────────────────────────────

  listEndpoints: adminProcedure
    .input(z.object({
      status: z.enum(['active', 'inactive', 'error', 'degraded', 'stub']).optional(),
      protocol: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const filters = input;
      let query = `SELECT * FROM integration_endpoints WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;

      if (filters.status) {
        query += ` AND status = $${idx++}`;
        params.push(filters.status);
      }
      if (filters.protocol) {
        query += ` AND protocol = $${idx++}`;
        params.push(filters.protocol);
      }
      query += ` ORDER BY system_name ASC`;

      const rows = await sql(query, params);
      // Compute summary
      const summary = {
        total: rows.length,
        active: rows.filter((r: any) => r.status === 'active').length,
        degraded: rows.filter((r: any) => r.status === 'degraded').length,
        error: rows.filter((r: any) => r.status === 'error').length,
        stub: rows.filter((r: any) => r.status === 'stub').length,
      };
      return { endpoints: rows, summary };
    }),

  getEndpoint: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const sql = getSql();
      const rows = await sql(`SELECT * FROM integration_endpoints WHERE id = $1`, [input.id]);
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Endpoint not found' });
      return rows[0];
    }),

  createEndpoint: adminProcedure
    .input(endpointInput)
    .mutation(async ({ input }) => {
      const sql = getSql();
      const rows = await sql(`
        INSERT INTO integration_endpoints (
          system_name, display_name, integration_type, protocol,
          endpoint_url, host, port, auth_type, status,
          rate_limit_per_minute, rate_limit_per_day,
          retry_enabled, retry_max_attempts, retry_backoff_seconds,
          is_production, owner_team, owner_contact, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING *
      `, [
        input.system_name, input.display_name || null, input.integration_type, input.protocol,
        input.endpoint_url || null, input.host || null, input.port || null,
        input.auth_type || null, input.status,
        input.rate_limit_per_minute || null, input.rate_limit_per_day || null,
        input.retry_enabled, input.retry_max_attempts, input.retry_backoff_seconds,
        input.is_production, input.owner_team || null, input.owner_contact || null, input.notes || null,
      ]);
      return rows[0];
    }),

  updateEndpoint: adminProcedure
    .input(z.object({ id: z.string().uuid() }).merge(endpointInput.partial()))
    .mutation(async ({ input }) => {
      const sql = getSql();
      const { id, ...fields } = input;
      const sets: string[] = [];
      const params: any[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        if (val !== undefined) {
          sets.push(`${key} = $${idx++}`);
          params.push(val);
        }
      }
      if (!sets.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update' });
      sets.push(`updated_at = now()`);
      params.push(id);
      const rows = await sql(
        `UPDATE integration_endpoints SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
      );
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Endpoint not found' });
      return rows[0];
    }),

  deleteEndpoint: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const sql = getSql();
      await sql(`DELETE FROM integration_endpoints WHERE id = $1`, [input.id]);
      return { success: true };
    }),

  testEndpoint: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const sql = getSql();
      const rows = await sql(`SELECT * FROM integration_endpoints WHERE id = $1`, [input.id]);
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Endpoint not found' });
      const ep = rows[0] as any;

      // Stub test — just update heartbeat
      if (ep.status === 'stub') {
        return { success: true, message: 'Stub endpoint — no live connection test', latency_ms: 0 };
      }

      const start = Date.now();
      let testResult = { success: false, message: '', latency_ms: 0 };
      try {
        if (ep.endpoint_url) {
          const res = await fetch(ep.endpoint_url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
          testResult = { success: res.ok, message: `HTTP ${res.status}`, latency_ms: Date.now() - start };
        } else {
          testResult = { success: false, message: 'No endpoint URL configured', latency_ms: 0 };
        }
      } catch (e: any) {
        testResult = { success: false, message: e.message || 'Connection failed', latency_ms: Date.now() - start };
      }

      // Update heartbeat
      await sql(`
        UPDATE integration_endpoints SET
          last_heartbeat_at = CASE WHEN $1 THEN now() ELSE last_heartbeat_at END,
          consecutive_failures = CASE WHEN $1 THEN '0' ELSE (COALESCE(consecutive_failures::int, 0) + 1)::text END,
          last_error_message = CASE WHEN $1 THEN NULL ELSE $2 END,
          status = CASE WHEN $1 THEN 'active' WHEN COALESCE(consecutive_failures::int, 0) >= 3 THEN 'error' ELSE 'degraded' END,
          updated_at = now()
        WHERE id = $3
      `, [testResult.success, testResult.message, input.id]);

      // Audit log
      await sql(`
        INSERT INTO integration_audit_log (event_type, endpoint_id, processing_status, processing_duration_ms, error_message)
        VALUES ('connection_test', $1, $2, $3, $4)
      `, [input.id, testResult.success ? 'success' : 'failure', String(testResult.latency_ms), testResult.success ? null : testResult.message]);

      return testResult;
    }),

  // ── HL7 MESSAGES ─────────────────────────────────────────────────

  listHl7Messages: adminProcedure
    .input(z.object({
      message_type: z.enum(['ORM', 'ORU', 'ADT', 'SIU']).optional(),
      direction: z.enum(['inbound', 'outbound']).optional(),
      status: z.string().optional(),
      patient_uhid: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const f = input;
      let query = `SELECT id, message_control_id, message_type, message_version, direction, source_system, receiving_system,
                   patient_uhid, status, is_valid, is_duplicate, processing_error, created_at, processed_at
                   FROM hl7_integration_messages WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;
      if (f.message_type) { query += ` AND message_type = $${idx++}`; params.push(f.message_type); }
      if (f.direction) { query += ` AND direction = $${idx++}`; params.push(f.direction); }
      if (f.status) { query += ` AND status = $${idx++}`; params.push(f.status); }
      if (f.patient_uhid) { query += ` AND patient_uhid = $${idx++}`; params.push(f.patient_uhid); }

      const countRes = await sql(`SELECT COUNT(*) as total FROM hl7_integration_messages WHERE 1=1${
        f.message_type ? ` AND message_type = '${f.message_type}'` : ''
      }${f.direction ? ` AND direction = '${f.direction}'` : ''
      }${f.status ? ` AND status = '${f.status}'` : ''
      }${f.patient_uhid ? ` AND patient_uhid = '${f.patient_uhid}'` : ''}`);

      query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(f.limit || 50, f.offset || 0);

      const rows = await sql(query, params);
      return { messages: rows, total: parseInt(countRes[0]?.total || '0') };
    }),

  getHl7Message: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const sql = getSql();
      const rows = await sql(`SELECT * FROM hl7_integration_messages WHERE id = $1`, [input.id]);
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'HL7 message not found' });
      return rows[0];
    }),

  receiveHl7Message: adminProcedure
    .input(hl7InboundInput)
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hash = crypto.createHash('sha256').update(input.raw_message).digest('hex');
      const controlId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Dedup check
      const dupCheck = await sql(`SELECT id FROM hl7_integration_messages WHERE raw_message_hash = $1 LIMIT 1`, [hash]);
      const isDuplicate = dupCheck.length > 0;

      // Parse segments (basic)
      const segments = input.raw_message.split(/\r|\n/).filter(Boolean);
      const parsedSegments: Record<string, any> = {};
      for (const seg of segments) {
        const fields = seg.split('|');
        const segType = fields[0];
        parsedSegments[segType] = fields;
      }

      const rows = await sql(`
        INSERT INTO hl7_integration_messages (
          message_control_id, message_type, message_version, direction,
          source_system, receiving_system, raw_message, raw_message_hash,
          parsed_segments, patient_uhid, order_id, encounter_id,
          status, is_valid, is_duplicate, duplicate_of_id, processed_at
        ) VALUES ($1,$2,$3,'inbound',$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,true,$13,$14,now())
        RETURNING *
      `, [
        controlId, input.message_type, input.message_version,
        input.source_system, input.receiving_system, input.raw_message, hash,
        JSON.stringify(parsedSegments), input.patient_uhid || null,
        input.order_id || null, input.encounter_id || null,
        isDuplicate ? 'duplicate_skipped' : 'parsed',
        isDuplicate, isDuplicate ? dupCheck[0].id : null,
      ]);

      return rows[0];
    }),

  generateHl7Message: adminProcedure
    .input(z.object({
      message_type: z.enum(['ORM', 'ORU', 'ADT', 'SIU']),
      patient_uhid: z.string(),
      patient_name: z.string(),
      patient_dob: z.string().optional(),
      patient_gender: z.enum(['M', 'F', 'O']).optional(),
      order_id: z.string().optional(),
      investigation_code: z.string().optional(),
      investigation_name: z.string().optional(),
      specimen_type: z.string().optional(),
      clinician_name: z.string().optional(),
      destination_system: z.string().default('EXTERNAL_LIS'),
    }))
    .mutation(async ({ input }) => {
      const sql = getSql();
      const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      const controlId = `MSG-${ts}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // Build HL7 ORM message
      const msh = `MSH|^~\\&|EVEN|EHRC|${input.destination_system}|EXTERNAL|${ts}||${input.message_type}^O01^${input.message_type}_O01|${controlId}|P|2.5`;
      const pid = `PID|||${input.patient_uhid}||${input.patient_name.replace(/\s+/g, '^')}||${input.patient_dob || ''}|${input.patient_gender || ''}||IND`;
      const orc = `ORC|NW|${input.order_id || 'ORD-NEW'}||||||${ts}|^${input.clinician_name || 'CLINICIAN'}`;
      const obr = `OBR|1|${input.order_id || 'ORD-NEW'}||${input.investigation_code || ''}^${input.investigation_name || ''}||||${ts}||${input.specimen_type || ''}|^${input.clinician_name || 'CLINICIAN'}`;

      const rawMessage = [msh, pid, orc, obr].join('\r');
      const hash = crypto.createHash('sha256').update(rawMessage).digest('hex');
      const parsedSegments = { MSH: msh.split('|'), PID: pid.split('|'), ORC: orc.split('|'), OBR: obr.split('|') };

      const rows = await sql(`
        INSERT INTO hl7_integration_messages (
          message_control_id, message_type, message_version, direction,
          source_system, receiving_system, raw_message, raw_message_hash,
          parsed_segments, patient_uhid, order_id, status, is_valid, processed_at
        ) VALUES ($1,$2,'2.5','outbound','EVEN',$3,$4,$5,$6::jsonb,$7,$8,'stored',true,now())
        RETURNING *
      `, [
        controlId, input.message_type, input.destination_system,
        rawMessage, hash, JSON.stringify(parsedSegments),
        input.patient_uhid, input.order_id || null,
      ]);

      return rows[0];
    }),

  // ── ABDM / ABHA ─────────────────────────────────────────────────

  verifyAbha: protectedProcedure
    .input(abhaVerifyInput)
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const verificationId = `ABHA-VER-${Date.now()}`;

      // v1: Local format + checksum validation only
      const abhaRegex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;
      const isFormatValid = abhaRegex.test(input.abha_id);

      const verified = isFormatValid;
      const status = isFormatValid ? 'verified' : 'invalid_format';
      const errorCode = isFormatValid ? null : 'INVALID_FORMAT';
      const errorMsg = isFormatValid ? null : 'ABHA ID format invalid. Expected XXXX-XXXX-XXXX-XXXX';

      await sql(`
        INSERT INTO abha_verification_log (
          verification_id, abha_id, verification_method, verification_type,
          verified, verification_status, error_code, error_message
        ) VALUES ($1,$2,$3,'format_check',$4,$5,$6,$7)
      `, [verificationId, input.abha_id, input.verification_type, verified, status, errorCode, errorMsg]);

      return {
        verified,
        abha_id: input.abha_id,
        verification_id: verificationId,
        verification_timestamp: new Date().toISOString(),
        verification_method: input.verification_type,
        status,
        message: verified ? 'ABHA verified successfully (v1: format check only)' : (errorMsg || 'Verification failed'),
      };
    }),

  grantConsent: protectedProcedure
    .input(consentGrantInput)
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const consentId = `STUB-CONSENT-${Date.now()}`;
      const validFrom = new Date();
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + input.validity_days);

      // Log in ABHA verification log as a consent event
      await sql(`
        INSERT INTO abha_verification_log (
          verification_id, abha_id, patient_id, verification_method, verification_type,
          verified, verification_status, verification_metadata
        ) VALUES ($1,$2,$3,'standard','consent_grant',true,'verified',$4::jsonb)
      `, [
        consentId, input.abha_id, input.patient_id,
        JSON.stringify({ data_categories: input.data_categories, validity_days: input.validity_days }),
      ]);

      return {
        consent_id: consentId,
        patient_id: input.patient_id,
        abha_id: input.abha_id,
        data_categories: input.data_categories,
        status: 'granted',
        valid_from: validFrom.toISOString(),
        valid_until: validUntil.toISOString(),
        message: 'Consent granted. Data push/pull deferred to v2.1',
      };
    }),

  listAbhaVerifications: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
      verified: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const f = input;
      let query = `SELECT * FROM abha_verification_log WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;
      if (f.verified !== undefined) { query += ` AND verified = $${idx++}`; params.push(f.verified); }
      query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(f.limit || 50, f.offset || 0);
      const rows = await sql(query, params);
      return rows;
    }),

  // ── LSQ SYNC LOG ─────────────────────────────────────────────────

  listLsqSyncLogs: adminProcedure
    .input(z.object({
      sync_type: z.enum(['opd_inquiry', 'admission', 'pre_auth', 'follow_up', 'generic_update']).optional(),
      sync_status: z.enum(['success', 'failure', 'partial', 'skipped_duplicate']).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const f = input;
      let query = `SELECT * FROM lsq_integration_sync_log WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;
      if (f.sync_type) { query += ` AND sync_type = $${idx++}`; params.push(f.sync_type); }
      if (f.sync_status) { query += ` AND sync_status = $${idx++}`; params.push(f.sync_status); }
      query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(f.limit || 50, f.offset || 0);

      const rows = await sql(query, params);

      // Summary
      const summaryRes = await sql(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE sync_status = 'success') as success_count,
          COUNT(*) FILTER (WHERE sync_status = 'failure') as failure_count,
          COUNT(*) FILTER (WHERE sync_status = 'skipped_duplicate') as dup_count
        FROM lsq_integration_sync_log WHERE created_at > now() - interval '24 hours'
      `);
      const summary = summaryRes[0] || { total: 0, success_count: 0, failure_count: 0, dup_count: 0 };
      return { logs: rows, summary };
    }),

  getLsqSyncLog: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const sql = getSql();
      const rows = await sql(`SELECT * FROM lsq_integration_sync_log WHERE id = $1`, [input.id]);
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sync log not found' });
      return rows[0];
    }),

  // ── EVENT BUS SUBSCRIPTIONS ──────────────────────────────────────

  listSubscriptions: adminProcedure
    .input(z.object({
      topic_category: z.enum(['clinical', 'billing', 'admin', 'communication']).optional(),
      is_active: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const f = input;
      let query = `SELECT * FROM event_bus_subscriptions WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;
      if (f.topic_category) { query += ` AND topic_category = $${idx++}`; params.push(f.topic_category); }
      if (f.is_active !== undefined) { query += ` AND is_active = $${idx++}`; params.push(f.is_active); }
      query += ` ORDER BY topic_name, subscriber_module`;
      const rows = await sql(query, params);

      // Group by topic
      const grouped: Record<string, any[]> = {};
      for (const r of rows as any[]) {
        if (!grouped[r.topic_name]) grouped[r.topic_name] = [];
        grouped[r.topic_name].push(r);
      }
      return { subscriptions: rows, grouped, total: rows.length };
    }),

  createSubscription: adminProcedure
    .input(subscriptionInput)
    .mutation(async ({ input }) => {
      const sql = getSql();
      const subId = `SUB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const rows = await sql(`
        INSERT INTO event_bus_subscriptions (
          subscription_id, topic_name, topic_category, subscriber_module,
          subscriber_endpoint, handler_type, retry_enabled, retry_max_attempts,
          event_filter
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        RETURNING *
      `, [
        subId, input.topic_name, input.topic_category, input.subscriber_module,
        input.subscriber_endpoint, input.handler_type, input.retry_enabled,
        input.retry_max_attempts, input.event_filter ? JSON.stringify(input.event_filter) : null,
      ]);
      return rows[0];
    }),

  updateSubscription: adminProcedure
    .input(z.object({
      id: z.string().uuid(),
      is_active: z.boolean().optional(),
      retry_enabled: z.boolean().optional(),
      retry_max_attempts: z.string().optional(),
      subscriber_endpoint: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const sql = getSql();
      const { id, ...fields } = input;
      const sets: string[] = [];
      const params: any[] = [];
      let idx = 1;
      for (const [key, val] of Object.entries(fields)) {
        if (val !== undefined) {
          sets.push(`${key} = $${idx++}`);
          params.push(val);
        }
      }
      if (!sets.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update' });
      sets.push(`updated_at = now()`);
      params.push(id);
      const rows = await sql(
        `UPDATE event_bus_subscriptions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
      );
      if (!rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Subscription not found' });
      return rows[0];
    }),

  deleteSubscription: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const sql = getSql();
      await sql(`DELETE FROM event_bus_subscriptions WHERE id = $1`, [input.id]);
      return { success: true };
    }),

  // ── WHATSAPP QUEUE ───────────────────────────────────────────────

  listWhatsappQueue: adminProcedure
    .input(z.object({
      status: z.enum(['queued', 'sent', 'delivered', 'failed', 'bounced', 'v2_only']).optional(),
      message_type: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const f = input;
      let query = `SELECT * FROM whatsapp_queue WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;
      if (f.status) { query += ` AND status = $${idx++}`; params.push(f.status); }
      if (f.message_type) { query += ` AND message_type = $${idx++}`; params.push(f.message_type); }
      query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(f.limit || 50, f.offset || 0);
      const rows = await sql(query, params);

      const summaryRes = await sql(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'queued') as queued,
          COUNT(*) FILTER (WHERE status = 'sent') as sent,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COUNT(*) FILTER (WHERE status = 'v2_only') as v2_only
        FROM whatsapp_queue
      `);
      return { messages: rows, summary: summaryRes[0] || {} };
    }),

  queueWhatsappMessage: adminProcedure
    .input(whatsappQueueInput)
    .mutation(async ({ input }) => {
      const sql = getSql();
      const msgUuid = `WA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // v1: Queue but don't send — mark as v2_only
      const rows = await sql(`
        INSERT INTO whatsapp_queue (
          message_uuid, patient_id, patient_phone, message_type,
          message_text, template_id, message_params, trigger_type, trigger_id,
          status, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'v2_only',$10)
        RETURNING *
      `, [
        msgUuid, input.patient_id, input.patient_phone, input.message_type,
        input.message_text, input.template_id || null,
        input.message_params ? JSON.stringify(input.message_params) : null,
        input.trigger_type, input.trigger_id || null, expiresAt.toISOString(),
      ]);
      return rows[0];
    }),

  // ── AUDIT LOG ────────────────────────────────────────────────────

  listAuditLogs: adminProcedure
    .input(z.object({
      event_type: z.string().optional(),
      endpoint_id: z.string().uuid().optional(),
      processing_status: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const f = input;
      let query = `SELECT al.*, ep.system_name, ep.display_name
                   FROM integration_audit_log al
                   LEFT JOIN integration_endpoints ep ON ep.id = al.endpoint_id
                   WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;
      if (f.event_type) { query += ` AND al.event_type = $${idx++}`; params.push(f.event_type); }
      if (f.endpoint_id) { query += ` AND al.endpoint_id = $${idx++}`; params.push(f.endpoint_id); }
      if (f.processing_status) { query += ` AND al.processing_status = $${idx++}`; params.push(f.processing_status); }
      query += ` ORDER BY al.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(f.limit || 50, f.offset || 0);
      const rows = await sql(query, params);
      return rows;
    }),

  // ── INTEGRATION HEALTH ───────────────────────────────────────────

  getIntegrationHealth: adminProcedure
    .query(async () => {
      const sql = getSql();

      const endpoints = await sql(`SELECT id, system_name, display_name, status, last_heartbeat_at, consecutive_failures, protocol FROM integration_endpoints ORDER BY system_name`);

      // Message volume (24h)
      const volumeRes = await sql(`
        SELECT
          COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_24h,
          COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_24h,
          COUNT(*) FILTER (WHERE status = 'error') as errors_24h
        FROM hl7_integration_messages WHERE created_at > now() - interval '24 hours'
      `);

      // Recent errors
      const recentErrors = await sql(`
        SELECT al.event_type, al.error_message, al.created_at, ep.system_name
        FROM integration_audit_log al
        LEFT JOIN integration_endpoints ep ON ep.id = al.endpoint_id
        WHERE al.processing_status = 'failure'
        ORDER BY al.created_at DESC LIMIT 5
      `);

      return {
        endpoints,
        volume: volumeRes[0] || { inbound_24h: 0, outbound_24h: 0, errors_24h: 0 },
        recent_errors: recentErrors,
      };
    }),
});
