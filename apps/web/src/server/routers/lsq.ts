import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { getDb } from '@even-os/db';
import { lsqSyncLog, lsqApiLog, lsqSyncState, patients } from '@db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { isLsqConfigured } from '@/lib/lsq/client';
import { runLsqSync } from '@/lib/lsq/sync-engine';

export const lsqRouter = router({

  // ─── OVERVIEW STATS ──────────────────────────────────────
  stats: protectedProcedure.query(async ({ ctx }) => {
    const db = getDb();
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
      const db = getDb();
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
      const db = getDb();
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

  // ─── LIST LEAD MAPPINGS (LSQ lead → patient) ──────────────
  listLeadMappings: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(25),
      status: z.enum(['synced', 'processed', 'merged']).optional(),
    }).optional().default({}))
    .query(async ({ ctx, input }) => {
      const db = getDb();
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
