/**
 * Patient Chart Overhaul — PC.1a — chartLocks tRPC router
 *
 * Pessimistic lock surface for clinical write paths (PRD v2.0 decision #19).
 * TTL-backed (default 5 minutes); application-enforced. Callers are any
 * clinical editor that opens a write surface.
 *
 * Contract:
 *   - acquire(patient, encounter?, surface, reason?) →
 *       ok:true with lock row  OR  ok:false with current holder (409 contention)
 *       Overwrites an expired row silently (same slot, past expires_at).
 *   - getCurrent(patient, encounter?, surface) →
 *       null | lock row (never errors — used by banners on render)
 *   - extend(lockId) → bumps expires_at to now+5min (caller must be holder)
 *   - release(lockId) → deletes the row (caller must be holder)
 *   - listForPatient(patient) → all active locks for a patient (admin overlay/PC.3)
 *
 * Notes:
 *   - expires_at is application-enforced. The `acquire` implementation checks
 *     `expires_at <= now()` before treating a row as stealable, so clock skew
 *     between client and DB is irrelevant (DB `now()` is authoritative).
 *   - We use raw SQL via the Neon HTTP driver to match the repo's dominant
 *     pattern (conditions, clinical-notes, etc.).
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { emitChartNotificationEvent } from '@/lib/chart/notification-events';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// Surface identifier: short string, lowercase + colon-delimited. e.g. "note:progress"
const surfaceSchema = z.string().min(2).max(64).regex(/^[a-z][a-z0-9:_-]*$/i);

// Lock TTL — 5 minutes per PRD #19. Centralised so extend/acquire agree.
const LOCK_TTL_SECONDS = 5 * 60;

type LockRow = {
  id: string;
  hospital_id: string;
  patient_id: string;
  encounter_id: string | null;
  surface: string;
  locked_by_user_id: string;
  locked_by_user_name: string;
  locked_by_user_role: string;
  reason: string | null;
  locked_at: string;
  expires_at: string;
};

export const chartLocksRouter = router({
  // ─── ACQUIRE ────────────────────────────────────────────────
  // Tries to take the lock. If an un-expired lock is held by someone else,
  // returns { ok: false, current } so the UI can show the banner.
  acquire: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().nullable().optional(),
      surface: surfaceSchema,
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const userName = ctx.user.name || ctx.user.email || 'Unknown';
      const userRole = ctx.user.role || 'unknown';
      if (!hospitalId || !userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session missing identity' });
      }

      const sql = getSql();
      const encounterId = input.encounter_id ?? null;

      // Look up current slot
      const existing = await sql`
        SELECT * FROM chart_edit_locks
        WHERE patient_id = ${input.patient_id}
          AND encounter_id IS NOT DISTINCT FROM ${encounterId}
          AND surface = ${input.surface}
        LIMIT 1
      ` as unknown as LockRow[];

      const now = new Date();

      if (existing.length > 0) {
        const row = existing[0];
        const expiresAt = new Date(row.expires_at);
        const isSameHolder = row.locked_by_user_id === userId;
        const isExpired = expiresAt.getTime() <= now.getTime();

        if (!isSameHolder && !isExpired) {
          // Contention — return current holder (don't throw; UI shows banner)
          return { ok: false as const, current: row };
        }

        // Same holder OR expired — refresh this row and hand it back
        const newExpires = new Date(now.getTime() + LOCK_TTL_SECONDS * 1000);
        const refreshed = await sql`
          UPDATE chart_edit_locks
          SET locked_by_user_id = ${userId},
              locked_by_user_name = ${userName},
              locked_by_user_role = ${userRole},
              reason = ${input.reason ?? null},
              locked_at = ${now.toISOString()},
              expires_at = ${newExpires.toISOString()},
              updated_at = ${now.toISOString()}
          WHERE id = ${row.id}
          RETURNING *
        ` as unknown as LockRow[];
        return { ok: true as const, lock: refreshed[0] };
      }

      // No row — insert a fresh lock
      const newExpires = new Date(now.getTime() + LOCK_TTL_SECONDS * 1000);
      const inserted = await sql`
        INSERT INTO chart_edit_locks (
          hospital_id, patient_id, encounter_id, surface,
          locked_by_user_id, locked_by_user_name, locked_by_user_role,
          reason, locked_at, expires_at
        ) VALUES (
          ${hospitalId}, ${input.patient_id}, ${encounterId}, ${input.surface},
          ${userId}, ${userName}, ${userRole},
          ${input.reason ?? null}, ${now.toISOString()}, ${newExpires.toISOString()}
        )
        RETURNING *
      ` as unknown as LockRow[];
      return { ok: true as const, lock: inserted[0] };
    }),

  // ─── GET CURRENT ────────────────────────────────────────────
  // Non-throwing read. Returns null if no active (non-expired) lock.
  getCurrent: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().nullable().optional(),
      surface: surfaceSchema,
    }))
    .query(async ({ input }) => {
      const sql = getSql();
      const encounterId = input.encounter_id ?? null;
      const rows = await sql`
        SELECT * FROM chart_edit_locks
        WHERE patient_id = ${input.patient_id}
          AND encounter_id IS NOT DISTINCT FROM ${encounterId}
          AND surface = ${input.surface}
          AND expires_at > now()
        LIMIT 1
      ` as unknown as LockRow[];
      return rows[0] ?? null;
    }),

  // ─── EXTEND ─────────────────────────────────────────────────
  // Bump expires_at by LOCK_TTL_SECONDS. Only the holder may extend.
  extend: protectedProcedure
    .input(z.object({ lock_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.sub;
      const sql = getSql();
      const now = new Date();
      const newExpires = new Date(now.getTime() + LOCK_TTL_SECONDS * 1000);
      const rows = await sql`
        UPDATE chart_edit_locks
        SET expires_at = ${newExpires.toISOString()},
            updated_at = ${now.toISOString()}
        WHERE id = ${input.lock_id}
          AND locked_by_user_id = ${userId}
          AND expires_at > now()
        RETURNING *
      ` as unknown as LockRow[];
      if (rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Lock not found or not held by you (may have expired — please re-acquire).',
        });
      }
      return rows[0];
    }),

  // ─── RELEASE ────────────────────────────────────────────────
  // Delete the lock. Holder-only. Returns { ok: true } even if already gone.
  release: protectedProcedure
    .input(z.object({ lock_id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.sub;
      const sql = getSql();
      await sql`
        DELETE FROM chart_edit_locks
        WHERE id = ${input.lock_id}
          AND locked_by_user_id = ${userId}
      `;
      return { ok: true as const };
    }),

  // ─── LIST FOR PATIENT ───────────────────────────────────────
  // All active (non-expired) locks for a patient. Admin overlay + PC.3 use.
  listForPatient: protectedProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const sql = getSql();
      const rows = await sql`
        SELECT * FROM chart_edit_locks
        WHERE patient_id = ${input.patient_id}
          AND expires_at > now()
        ORDER BY locked_at DESC
      ` as unknown as LockRow[];
      return rows;
    }),

  // ─── RELEASE WITH ADMIN OVERRIDE (PC.4.B.2) ─────────────────
  // Super-admin / admin break-glass: force-release someone else's lock and
  // emit an edit_lock_override event. Mandatory prose reason (4–500 chars);
  // the reason is captured both in the event payload and the audit trail.
  releaseWithAdminOverride: protectedProcedure
    .input(z.object({
      lock_id: z.string().uuid(),
      reason: z.string().min(4).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = (ctx.user.role ?? '').toLowerCase();
      if (role !== 'super_admin' && role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admin override requires super_admin or admin role.',
        });
      }
      const sql = getSql();

      const locked = await sql`
        SELECT * FROM chart_edit_locks WHERE id = ${input.lock_id} LIMIT 1
      ` as unknown as LockRow[];
      if (locked.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lock not found.' });
      }
      const lock = locked[0];

      await sql`
        DELETE FROM chart_edit_locks WHERE id = ${input.lock_id}
      `;

      void emitChartNotificationEvent({
        hospital_id: lock.hospital_id,
        patient_id: lock.patient_id,
        encounter_id: lock.encounter_id,
        event_type: 'edit_lock_override',
        severity: 'high',
        source_kind: 'chart_edit_locks',
        source_id: lock.id,
        dedup_key: `edit_lock_override:${lock.id}`,
        fired_by_user_id: ctx.user.sub,
        payload: {
          surface: lock.surface,
          overridden_user_id: lock.locked_by_user_id,
          overridden_user_name: lock.locked_by_user_name,
          overridden_user_role: lock.locked_by_user_role,
          original_reason: lock.reason,
          override_reason: input.reason,
        },
      }).catch(() => {});

      return { ok: true as const, overridden_user_id: lock.locked_by_user_id };
    }),
});
