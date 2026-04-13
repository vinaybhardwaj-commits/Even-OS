/**
 * HL7 Analyzer Integration Framework — Module 8 LIS (L.8)
 *
 * Adapter configuration, message ingestion/parsing, health monitoring,
 * dead-letter queue, and analyzer dashboard.
 *
 * Endpoints:
 *   1.  createAdapter     — Register a new analyzer adapter
 *   2.  listAdapters      — List adapters with status
 *   3.  getAdapter        — Full adapter details
 *   4.  updateAdapter     — Edit adapter config/status
 *   5.  recordHeartbeat   — Analyzer heartbeat ping
 *   6.  ingestMessage     — Receive & parse HL7 message
 *   7.  listMessages      — Message log with filters
 *   8.  getMessage        — Full message details + raw
 *   9.  retryMessage      — Retry failed/dead-letter message
 *  10.  listDeadLetters   — Dead-letter queue
 *  11.  logEvent          — Record adapter event
 *  12.  listEvents        — Adapter event history
 *  13.  stats             — Analyzer health dashboard
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { hl7Adapters, hl7Messages, hl7AdapterEvents } from '@db/schema';
import { eq, and, desc, count, sql, gte, lte, asc } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/*  Minimal HL7 v2 Parser                                              */
/* ------------------------------------------------------------------ */

interface ParsedSegments {
  [segment: string]: Record<string, string | string[]>[] | Record<string, string | string[]>;
}

function parseHL7(raw: string): { segments: ParsedSegments; messageType: string; controlId: string; version: string } {
  const lines = raw.replace(/\r\n/g, '\r').replace(/\n/g, '\r').split('\r').filter(l => l.length > 0);
  const segments: ParsedSegments = {};
  let messageType = 'other';
  let controlId = '';
  let version = '2.5.1';

  for (const line of lines) {
    const fields = line.split('|');
    const segName = fields[0];

    const segData: Record<string, string | string[]> = {};
    fields.forEach((f, i) => {
      if (i === 0) return;
      segData[`${segName}_${i}`] = f.includes('^') ? f.split('^') : f;
    });

    if (segName === 'MSH') {
      // MSH-9 = message type, MSH-10 = control ID, MSH-12 = version
      const typeField = fields[8] || '';
      const parts = typeField.split('^');
      messageType = parts.length >= 2 ? `${parts[0]}_${parts[1]}` : typeField;
      controlId = fields[9] || '';
      version = fields[11] || '2.5.1';
      segments.MSH = segData;
    } else if (['OBX', 'OBR', 'NTE', 'AL1', 'DG1'].includes(segName)) {
      // Repeating segments → array
      if (!segments[segName]) segments[segName] = [];
      (segments[segName] as Record<string, string | string[]>[]).push(segData);
    } else {
      segments[segName] = segData;
    }
  }

  return { segments, messageType, controlId, version };
}

function generateACK(controlId: string, ackCode: 'AA' | 'AE' | 'AR', errorMsg?: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const lines = [
    `MSH|^~\\&|EVEN_OS|EHRC|ANALYZER|LAB|${ts}||ACK|${ts}|P|2.5.1`,
    `MSA|${ackCode}|${controlId}${errorMsg ? `|${errorMsg}` : ''}`,
  ];
  return lines.join('\r');
}

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

export const hl7AnalyzerRouter = router({

  // 1. CREATE ADAPTER
  createAdapter: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      name: z.string().min(1),
      manufacturer: z.string().optional(),
      model: z.string().optional(),
      serial_number: z.string().optional(),
      department: z.string().optional(),
      location: z.string().optional(),
      protocol: z.enum(['mllp', 'http', 'file_drop', 'serial', 'astm']).default('mllp'),
      direction: z.enum(['inbound', 'outbound', 'bidirectional']).default('bidirectional'),
      host: z.string().optional(),
      port: z.number().optional(),
      file_path: z.string().optional(),
      hl7_version: z.string().default('2.5.1'),
      field_mapping: z.record(z.string()).optional(),
      test_code_map: z.record(z.string()).optional(),
      retry_max: z.number().min(0).max(10).default(3),
      retry_delay_ms: z.number().min(1000).max(60000).default(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const [adapter] = await db.insert(hl7Adapters).values({
        hospital_id: input.hospital_id,
        name: input.name,
        manufacturer: input.manufacturer ?? null,
        model: input.model ?? null,
        serial_number: input.serial_number ?? null,
        department: input.department ?? null,
        location: input.location ?? null,
        protocol: input.protocol,
        direction: input.direction,
        host: input.host ?? null,
        port: input.port ?? null,
        file_path: input.file_path ?? null,
        hl7_version: input.hl7_version,
        field_mapping: input.field_mapping ?? null,
        test_code_map: input.test_code_map ?? null,
        status: 'inactive',
        retry_max: input.retry_max,
        retry_delay_ms: input.retry_delay_ms,
        created_by: ctx.user.sub,
      }).returning();

      // Log creation event
      await db.insert(hl7AdapterEvents).values({
        hospital_id: input.hospital_id,
        adapter_id: adapter.id,
        event_type: 'config_change',
        severity: 'info',
        message: `Adapter "${input.name}" created`,
        recorded_by: ctx.user.sub,
      });

      return adapter;
    }),

  // 2. LIST ADAPTERS
  listAdapters: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      status: z.enum(['active', 'inactive', 'error', 'maintenance']).optional(),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(hl7Adapters.hospital_id, input.hospital_id)];
      if (input.status) conditions.push(eq(hl7Adapters.status, input.status));

      const adapters = await db.select()
        .from(hl7Adapters)
        .where(and(...conditions))
        .orderBy(asc(hl7Adapters.name));

      return adapters;
    }),

  // 3. GET ADAPTER
  getAdapter: protectedProcedure
    .input(z.object({ adapter_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [adapter] = await db.select()
        .from(hl7Adapters)
        .where(eq(hl7Adapters.id, input.adapter_id))
        .limit(1);

      if (!adapter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Adapter not found' });
      return adapter;
    }),

  // 4. UPDATE ADAPTER
  updateAdapter: protectedProcedure
    .input(z.object({
      adapter_id: z.string().uuid(),
      name: z.string().optional(),
      status: z.enum(['active', 'inactive', 'error', 'maintenance']).optional(),
      host: z.string().optional(),
      port: z.number().optional(),
      field_mapping: z.record(z.string()).optional(),
      test_code_map: z.record(z.string()).optional(),
      unit_conversion: z.record(z.unknown()).optional(),
      retry_max: z.number().optional(),
      retry_delay_ms: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (input.name) updates.name = input.name;
      if (input.status) updates.status = input.status;
      if (input.host !== undefined) updates.host = input.host;
      if (input.port !== undefined) updates.port = input.port;
      if (input.field_mapping) updates.field_mapping = input.field_mapping;
      if (input.test_code_map) updates.test_code_map = input.test_code_map;
      if (input.unit_conversion) updates.unit_conversion = input.unit_conversion;
      if (input.retry_max !== undefined) updates.retry_max = input.retry_max;
      if (input.retry_delay_ms !== undefined) updates.retry_delay_ms = input.retry_delay_ms;

      const [updated] = await db.update(hl7Adapters)
        .set(updates)
        .where(eq(hl7Adapters.id, input.adapter_id))
        .returning();

      // Log status change
      if (input.status) {
        await db.insert(hl7AdapterEvents).values({
          hospital_id: updated.hospital_id,
          adapter_id: updated.id,
          event_type: input.status === 'maintenance' ? 'maintenance_start' : 'config_change',
          severity: input.status === 'error' ? 'error' : 'info',
          message: `Status changed to ${input.status}`,
          recorded_by: ctx.user.sub,
        });
      }

      return updated;
    }),

  // 5. RECORD HEARTBEAT
  recordHeartbeat: protectedProcedure
    .input(z.object({ adapter_id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [updated] = await db.update(hl7Adapters)
        .set({
          last_heartbeat: new Date(),
          status: 'active',
          updated_at: new Date(),
        })
        .where(eq(hl7Adapters.id, input.adapter_id))
        .returning();

      return { ok: true, adapter_id: updated?.id };
    }),

  // 6. INGEST MESSAGE — receive, parse, store
  ingestMessage: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      adapter_id: z.string().uuid(),
      raw_message: z.string().min(1),
      direction: z.enum(['inbound', 'outbound']).default('inbound'),
    }))
    .mutation(async ({ input }) => {
      const startTime = Date.now();

      // Fetch adapter for mapping config
      const [adapter] = await db.select()
        .from(hl7Adapters)
        .where(eq(hl7Adapters.id, input.adapter_id))
        .limit(1);

      if (!adapter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Adapter not found' });

      let parsed: ReturnType<typeof parseHL7>;
      let status: 'parsed' | 'error' = 'parsed';
      let errorMessage: string | null = null;
      let errorSegment: string | null = null;

      try {
        parsed = parseHL7(input.raw_message);
      } catch (e) {
        parsed = { segments: {}, messageType: 'other', controlId: '', version: '2.5.1' };
        status = 'error';
        errorMessage = e instanceof Error ? e.message : 'Parse error';
        errorSegment = 'MSH';
      }

      // Map message type to enum
      const validTypes = ['ORM_O01', 'ORU_R01', 'OML_O21', 'OUL_R22', 'ADT_A01', 'ADT_A08', 'ACK', 'QBP_Q11', 'RSP_K11'];
      const msgType = validTypes.includes(parsed.messageType) ? parsed.messageType : 'other';

      // Apply field mapping if available
      let mappedData: Record<string, unknown> | null = null;
      if (status === 'parsed' && adapter.field_mapping) {
        mappedData = {};
        const mapping = adapter.field_mapping as Record<string, string>;
        for (const [hl7Field, appField] of Object.entries(mapping)) {
          const [seg, idx] = hl7Field.split('_');
          const segData = parsed.segments[seg];
          if (segData && !Array.isArray(segData)) {
            (mappedData as Record<string, unknown>)[appField] = segData[hl7Field] ?? null;
          }
        }
      }

      const processingTime = Date.now() - startTime;

      const [message] = await db.insert(hl7Messages).values({
        hospital_id: input.hospital_id,
        adapter_id: input.adapter_id,
        message_control_id: parsed.controlId || null,
        message_type: msgType as typeof hl7Messages.$inferInsert.message_type,
        direction: input.direction,
        hl7_version: parsed.version,
        raw_message: input.raw_message,
        parsed_segments: parsed.segments,
        mapped_data: mappedData,
        status: status,
        error_message: errorMessage,
        error_segment: errorSegment,
        parsed_at: status === 'parsed' ? new Date() : null,
        processing_time_ms: processingTime,
      }).returning();

      // Update adapter stats
      await db.update(hl7Adapters)
        .set({
          last_message_at: new Date(),
          messages_today: sql`${hl7Adapters.messages_today} + 1`,
          errors_today: status === 'error' ? sql`${hl7Adapters.errors_today} + 1` : sql`${hl7Adapters.errors_today}`,
          updated_at: new Date(),
        })
        .where(eq(hl7Adapters.id, input.adapter_id));

      // Generate ACK
      const ackCode = status === 'error' ? 'AE' : 'AA';
      const ack = generateACK(parsed.controlId, ackCode as 'AA' | 'AE', errorMessage ?? undefined);

      return { message, ack, processing_time_ms: processingTime };
    }),

  // 7. LIST MESSAGES
  listMessages: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      adapter_id: z.string().uuid().optional(),
      status: z.enum(['received', 'parsed', 'mapped', 'processed', 'error', 'ack_sent', 'nack_sent', 'retry', 'dead_letter']).optional(),
      message_type: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(hl7Messages.hospital_id, input.hospital_id)];
      if (input.adapter_id) conditions.push(eq(hl7Messages.adapter_id, input.adapter_id));
      if (input.status) conditions.push(eq(hl7Messages.status, input.status));

      const messages = await db.select({
        id: hl7Messages.id,
        adapter_id: hl7Messages.adapter_id,
        message_control_id: hl7Messages.message_control_id,
        message_type: hl7Messages.message_type,
        direction: hl7Messages.direction,
        status: hl7Messages.status,
        error_message: hl7Messages.error_message,
        ack_code: hl7Messages.ack_code,
        retry_count: hl7Messages.retry_count,
        processing_time_ms: hl7Messages.processing_time_ms,
        received_at: hl7Messages.received_at,
      })
        .from(hl7Messages)
        .where(and(...conditions))
        .orderBy(desc(hl7Messages.received_at))
        .limit(input.limit)
        .offset(input.offset);

      const [totalRow] = await db.select({ total: count() })
        .from(hl7Messages)
        .where(and(...conditions));

      return { messages, total: totalRow?.total ?? 0 };
    }),

  // 8. GET MESSAGE — full details
  getMessage: protectedProcedure
    .input(z.object({ message_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [msg] = await db.select()
        .from(hl7Messages)
        .where(eq(hl7Messages.id, input.message_id))
        .limit(1);

      if (!msg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
      return msg;
    }),

  // 9. RETRY MESSAGE
  retryMessage: protectedProcedure
    .input(z.object({ message_id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [msg] = await db.select()
        .from(hl7Messages)
        .where(eq(hl7Messages.id, input.message_id))
        .limit(1);

      if (!msg) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!['error', 'dead_letter'].includes(msg.status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot retry message in status: ${msg.status}` });
      }

      const [adapter] = await db.select()
        .from(hl7Adapters)
        .where(eq(hl7Adapters.id, msg.adapter_id))
        .limit(1);

      const maxRetries = adapter?.dead_letter_after ?? 5;
      const newRetry = (msg.retry_count ?? 0) + 1;
      const newStatus = newRetry >= maxRetries ? 'dead_letter' : 'retry';

      const [updated] = await db.update(hl7Messages)
        .set({
          status: newStatus,
          retry_count: newRetry,
          next_retry_at: newStatus === 'retry' ? new Date(Date.now() + (adapter?.retry_delay_ms ?? 5000)) : null,
        })
        .where(eq(hl7Messages.id, input.message_id))
        .returning();

      return updated;
    }),

  // 10. LIST DEAD LETTERS
  listDeadLetters: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const messages = await db.select()
        .from(hl7Messages)
        .where(and(
          eq(hl7Messages.hospital_id, input.hospital_id),
          eq(hl7Messages.status, 'dead_letter'),
        ))
        .orderBy(desc(hl7Messages.received_at))
        .limit(input.limit);

      return messages;
    }),

  // 11. LOG EVENT
  logEvent: protectedProcedure
    .input(z.object({
      hospital_id: z.string(),
      adapter_id: z.string().uuid(),
      event_type: z.string().min(1),
      severity: z.enum(['info', 'warning', 'error', 'critical']).default('info'),
      message: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [event] = await db.insert(hl7AdapterEvents).values({
        hospital_id: input.hospital_id,
        adapter_id: input.adapter_id,
        event_type: input.event_type,
        severity: input.severity,
        message: input.message ?? null,
        metadata: input.metadata ?? null,
        recorded_by: ctx.user.sub,
      }).returning();

      // If critical event, update adapter status to error
      if (input.severity === 'critical') {
        await db.update(hl7Adapters)
          .set({ status: 'error', updated_at: new Date() })
          .where(eq(hl7Adapters.id, input.adapter_id));
      }

      return event;
    }),

  // 12. LIST EVENTS
  listEvents: protectedProcedure
    .input(z.object({
      adapter_id: z.string().uuid(),
      severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
      limit: z.number().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [eq(hl7AdapterEvents.adapter_id, input.adapter_id)];
      if (input.severity) conditions.push(eq(hl7AdapterEvents.severity, input.severity));

      const events = await db.select()
        .from(hl7AdapterEvents)
        .where(and(...conditions))
        .orderBy(desc(hl7AdapterEvents.recorded_at))
        .limit(input.limit);

      return events;
    }),

  // 13. STATS — analyzer health dashboard
  stats: protectedProcedure
    .input(z.object({ hospital_id: z.string() }))
    .query(async ({ input }) => {
      const [totalAdapters] = await db.select({ total: count() })
        .from(hl7Adapters)
        .where(eq(hl7Adapters.hospital_id, input.hospital_id));

      const [activeAdapters] = await db.select({ total: count() })
        .from(hl7Adapters)
        .where(and(eq(hl7Adapters.hospital_id, input.hospital_id), eq(hl7Adapters.status, 'active')));

      const [errorAdapters] = await db.select({ total: count() })
        .from(hl7Adapters)
        .where(and(eq(hl7Adapters.hospital_id, input.hospital_id), eq(hl7Adapters.status, 'error')));

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [msgsToday] = await db.select({ total: count() })
        .from(hl7Messages)
        .where(and(eq(hl7Messages.hospital_id, input.hospital_id), gte(hl7Messages.received_at, today)));

      const [errorsToday] = await db.select({ total: count() })
        .from(hl7Messages)
        .where(and(
          eq(hl7Messages.hospital_id, input.hospital_id),
          eq(hl7Messages.status, 'error'),
          gte(hl7Messages.received_at, today),
        ));

      const [deadLetters] = await db.select({ total: count() })
        .from(hl7Messages)
        .where(and(eq(hl7Messages.hospital_id, input.hospital_id), eq(hl7Messages.status, 'dead_letter')));

      const [pendingRetry] = await db.select({ total: count() })
        .from(hl7Messages)
        .where(and(eq(hl7Messages.hospital_id, input.hospital_id), eq(hl7Messages.status, 'retry')));

      return {
        total_adapters: totalAdapters?.total ?? 0,
        active_adapters: activeAdapters?.total ?? 0,
        error_adapters: errorAdapters?.total ?? 0,
        messages_today: msgsToday?.total ?? 0,
        errors_today: errorsToday?.total ?? 0,
        dead_letters: deadLetters?.total ?? 0,
        pending_retry: pendingRetry?.total ?? 0,
      };
    }),
});
