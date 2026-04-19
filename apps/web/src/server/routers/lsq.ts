import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { lsqSyncLog, lsqApiLog, lsqSyncState, patients } from '@db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { isLsqConfigured } from '@/lib/lsq/client';
import { runLsqSync } from '@/lib/lsq/sync-engine';

export const lsqRouter = router({

  // ─── OVERVIEW STATS ──────────────────────────────────────
  stats: protectedProcedure.query(async ({ ctx }) => {
    const hospitalId = ctx.user.hospital_id;

    const result = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM lsq_sync_state WHERE hospital_id = ${hospitalId}) as total_leads_mapped,
        (SELECT count(*)::int FROM lsq_sync_state WHERE hospital_id = ${hospitalId} AND patient_id IS NOT NULL) as leads_with_patients,
        (SELECT count(*)::int FROM lsq_sync_log WHERE hospital_id = ${hospitalId}) as total_sync_runs,
        (SELECT count(*)::int FROM lsq_sync_log WHERE hospital_id = ${hospitalId} AND status = 'success') as successful_syncs,
        (SELECT count(*)::int FROM lsq_sync_log WHERE hospital_id = ${hospitalId} AND status = 'failed') as failed_syncs,
        (SELECT MAX(sync_at) FROM lsq_sync_log WHERE hospital_id = ${hospitalId} AND status = 'success') as last_successful_sync,
        (SELECT count(*)::int FROM lsq_api_log WHERE hospital_id = ${hospitalId}) as total_api_calls,
        (SELECT coalesce(avg(latency_ms)::int, 0) FROM lsq_api_log WHERE hospital_id = ${hospitalId} AND latency_ms > 0) as avg_api_latency_ms,
        (SELECT count(*)::int FROM patients WHERE hospital_id = ${hospitalId} AND source_type = 'lsq_lead') as patients_from_lsq
    `);

    const rows = (result as any).rows || result;
    return {
      ...rows[0],
      api_configured: isLsqConfigured(),
    };
  }),

  // ─── TRIGGER MANUAL SYNC ─────────────────────────────────
  triggerSync: protectedProcedure.mutation(async ({ ctx }) => {
    return runLsqSync(ctx.user.hospital_id, ctx.user.sub);
  }),

  // ─── LIST SYNC RUNS ──────────────────────────────────────
  listSyncRuns: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const { page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const result = await db.execute(sql`
        SELECT *
        FROM lsq_sync_log
        WHERE hospital_id = ${hospitalId}
        ORDER BY sync_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM lsq_sync_log
        WHERE hospital_id = ${hospitalId}
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── LIST API CALLS ───────────────────────────────────────
  listApiCalls: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(50),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const { page, pageSize } = input;
      const offset = (page - 1) * pageSize;

      const result = await db.execute(sql`
        SELECT *
        FROM lsq_api_log
        WHERE hospital_id = ${hospitalId}
        ORDER BY logged_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM lsq_api_log
        WHERE hospital_id = ${hospitalId}
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),

  // ─── BY-PATIENT (PC.4.A.5) ───────────────────────────────────────
  // Used by the chart header chip + CCE Overview LSQ tile. Resolves
  // whether a patient originated from LSQ, and if so returns the
  // mapping row for display. Hospital-scoped, preview-role-compat.
  getByPatient: protectedProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;

      const result = await db.execute(sql`
        SELECT
          p.source_type,
          p.lsq_lead_id               as patient_lsq_lead_id,
          ls.id                       as sync_state_id,
          ls.lsq_lead_id              as sync_lsq_lead_id,
          ls.status                   as sync_status,
          ls.synced_at                as sync_synced_at
        FROM patients p
        LEFT JOIN lsq_sync_state ls
          ON ls.patient_id = p.id
          AND ls.hospital_id = p.hospital_id
        WHERE p.id = ${input.patient_id}
          AND p.hospital_id = ${hospitalId}
        LIMIT 1
      `);

      const rows = (result as any).rows || result;
      const row = rows?.[0];
      if (!row) return null;

      const leadId: string | null =
        row.sync_lsq_lead_id ?? row.patient_lsq_lead_id ?? null;

      // If neither source nor sync state says LSQ, this patient isn't
      // from LSQ — return null so the chip/card stays hidden.
      const isLsq = row.source_type === 'lsq_lead' || !!leadId;
      if (!isLsq) return null;

      return {
        lsq_lead_id: leadId,
        status: (row.sync_status as 'synced' | 'processed' | 'merged' | null) ?? 'synced',
        synced_at: row.sync_synced_at ?? null,
        source_type: row.source_type ?? null,
        has_sync_state: !!row.sync_state_id,
      };
    }),

  // ─── LIST LEAD MAPPINGS (LSQ lead → patient) ──────────────
  listLeadMappings: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
      status: z.enum(['synced', 'processed', 'merged']).optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const { page, pageSize, status } = input;
      const offset = (page - 1) * pageSize;

      const statusFilter = status ? sql`AND ls.status = ${status}` : sql``;

      const result = await db.execute(sql`
        SELECT
          ls.id, ls.lsq_lead_id, ls.status as sync_status, ls.synced_at,
          p.id as patient_id, p.uhid, p.name_full, p.phone, p.patient_category, p.source_type
        FROM lsq_sync_state ls
        LEFT JOIN patients p ON ls.patient_id = p.id
        WHERE ls.hospital_id = ${hospitalId}
          ${statusFilter}
        ORDER BY ls.synced_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const countResult = await db.execute(sql`
        SELECT count(*)::int as count
        FROM lsq_sync_state ls
        WHERE ls.hospital_id = ${hospitalId}
          ${statusFilter}
      `);

      const items = (result as any).rows || result;
      const countRows = (countResult as any).rows || countResult;
      const total = Number(countRows[0]?.count ?? 0);

      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }),
});
