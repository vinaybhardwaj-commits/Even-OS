/**
 * Patient Chart Overhaul — PC.4.B.1 — chartSubscriptions tRPC router
 *
 * Subscription + event-log surface for the patient chart. See
 * 59-chart-subscriptions.ts for table-shape decisions and the three V-locked
 * defaults (19 Apr 2026):
 *   1. Auto-subscribe scope = patient-level; discharge sweep flips
 *      auto_care_team rows to silenced=true (sticky audit trail).
 *   2. Silence = per-patient, persistent across admissions.
 *   3. Consulting specialists subscribed on consult-REQUEST (not accept).
 *
 * Endpoints:
 *   - listByPatient({ patient_id })
 *         Subscribers (+ silence state) on this patient. Used by chart
 *         header "watchers" chip, admin overlay, and PC.4.B.4 subs UI.
 *   - mySubscription({ patient_id })
 *         Current viewer's row. Null if not subscribed. Powers the Watch
 *         toggle and the silence toggle in the chart header.
 *   - watch({ patient_id })
 *         Manual subscribe (source='watch'). Idempotent; if a row exists
 *         under source='auto_care_team' we upgrade to 'watch' (stickier).
 *   - unwatch({ patient_id })
 *         Manual unsubscribe. Auto_care_team rows are NOT deleted — they
 *         flip to silenced=true instead (preserves audit trail). Pure
 *         watch rows are deleted.
 *   - silence({ patient_id, reason? })
 *         Mute notifications on this chart, preserve subscription.
 *   - unsilence({ patient_id })
 *         Re-enable notifications. Works whether current silence came from
 *         user toggle or discharge sweep.
 *   - seedCareTeam({ patient_id, encounter_id })
 *         Internal helper — called by admission / consult-request / nurse
 *         assign hooks to seed auto_care_team rows. Idempotent per
 *         (patient_id, user_id) edge. Safe to call repeatedly.
 *         Called by PC.4.B.2 event emitter + server-side only (protected
 *         procedure; PC.4.B.4 will restrict to system roles via admin gate).
 *   - listEvents({ patient_id, limit?, before? })
 *         Recent events on this chart for the activity feed on header /
 *         Observatory / admin. Descending by fired_at.
 *   - adminListForUser({ user_id })
 *         Admin-only list of all subscriptions owned by a user. Used by
 *         /admin/chart/subscribers in PC.4.B.4.
 *
 * Raw SQL via the Neon HTTP driver — consistent with chart-locks, chat,
 * complaints routers. No Drizzle query-builder to keep the SQL legible.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { seedConsultantSubscription } from '@/lib/chart/notification-events';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

const uuidSchema = z.string().uuid();

// 7 locked event types (PRD §11.2 + §27.3).
const eventTypeEnum = z.enum([
  'critical_vital',
  'critical_lab',
  'cosign_overdue',
  'llm_proposal_new',
  'calc_red_band',
  'encounter_transition',
  'edit_lock_override',
]);

const sourceEnum = z.enum(['auto_care_team', 'watch']);

const severityEnum = z.enum(['critical', 'high', 'normal', 'info']);
const readStateEnum = z.enum(['unread', 'read', 'dismissed']);

// ── Row shapes (DB snake_case preserved for the client) ──────────────
export interface ChartSubscriptionRow {
  id: string;
  hospital_id: string;
  patient_id: string;
  user_id: string;
  source: 'auto_care_team' | 'watch';
  role_snapshot: string;
  silenced: boolean;
  silenced_at: string | null;
  silenced_by_user_id: string | null;
  silenced_reason: string | null;
  event_filters: string[] | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
  // Joined (from users table) for display in UI.
  user_name?: string | null;
  user_role?: string | null;
}

export interface ChartNotificationEventRow {
  id: string;
  hospital_id: string;
  patient_id: string;
  encounter_id: string | null;
  event_type: z.infer<typeof eventTypeEnum>;
  severity: 'critical' | 'high' | 'normal' | 'info';
  source_kind: string;
  source_id: string | null;
  dedup_key: string | null;
  payload: Record<string, unknown> | null;
  fired_at: string;
  fired_by_user_id: string | null;
  // Joined from chart_notification_event_reads (LEFT JOIN). Nullable = unread.
  read_state?: 'unread' | 'read' | 'dismissed' | null;
  seen_at?: string | null;
  dismissed_at?: string | null;
  ack_reason?: string | null;
}

export const chartSubscriptionsRouter = router({
  // ─── listByPatient ───────────────────────────────────────────────
  listByPatient: protectedProcedure
    .input(z.object({ patient_id: uuidSchema }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const rows = (await sql`
        SELECT
          cs.*,
          u.name  AS user_name,
          u.role  AS user_role
        FROM chart_subscriptions cs
        LEFT JOIN users u ON u.id = cs.user_id
        WHERE cs.hospital_id = ${hospitalId}
          AND cs.patient_id  = ${input.patient_id}
        ORDER BY cs.silenced ASC, cs.created_at ASC
      `) as ChartSubscriptionRow[];
      return rows;
    }),

  // ─── mySubscription ──────────────────────────────────────────────
  mySubscription: protectedProcedure
    .input(z.object({ patient_id: uuidSchema }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const [row] = (await sql`
        SELECT * FROM chart_subscriptions
        WHERE hospital_id = ${hospitalId}
          AND patient_id  = ${input.patient_id}
          AND user_id     = ${ctx.user.sub}::uuid
      `) as ChartSubscriptionRow[];
      return row ?? null;
    }),

  // ─── watch (manual subscribe) ────────────────────────────────────
  watch: protectedProcedure
    .input(z.object({ patient_id: uuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const [row] = (await sql`
        INSERT INTO chart_subscriptions (
          hospital_id, patient_id, user_id,
          source, role_snapshot, created_by_user_id
        ) VALUES (
          ${hospitalId}, ${input.patient_id}, ${ctx.user.sub}::uuid,
          'watch'::cs_source, ${ctx.user.role}, ${ctx.user.sub}::uuid
        )
        ON CONFLICT (patient_id, user_id) DO UPDATE SET
          source        = 'watch'::cs_source,     -- upgrade auto→watch (stickier)
          role_snapshot = EXCLUDED.role_snapshot,
          silenced      = false,                   -- re-enable on re-watch
          silenced_at   = NULL,
          silenced_by_user_id = NULL,
          silenced_reason     = NULL,
          updated_at    = now()
        RETURNING *
      `) as ChartSubscriptionRow[];
      return row;
    }),

  // ─── unwatch ─────────────────────────────────────────────────────
  // Pure watch rows are deleted. Auto_care_team rows are flipped to
  // silenced=true to preserve the care-team audit trail.
  unwatch: protectedProcedure
    .input(z.object({ patient_id: uuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const [existing] = (await sql`
        SELECT source FROM chart_subscriptions
        WHERE hospital_id = ${hospitalId}
          AND patient_id  = ${input.patient_id}
          AND user_id     = ${ctx.user.sub}::uuid
      `) as Array<{ source: 'auto_care_team' | 'watch' }>;

      if (!existing) return { deleted: false, silenced: false };

      if (existing.source === 'watch') {
        await sql`
          DELETE FROM chart_subscriptions
          WHERE hospital_id = ${hospitalId}
            AND patient_id  = ${input.patient_id}
            AND user_id     = ${ctx.user.sub}::uuid
        `;
        return { deleted: true, silenced: false };
      }

      // auto_care_team → silence rather than delete.
      await sql`
        UPDATE chart_subscriptions
           SET silenced            = true,
               silenced_at         = now(),
               silenced_by_user_id = ${ctx.user.sub}::uuid,
               silenced_reason     = 'user_unwatch',
               updated_at          = now()
         WHERE hospital_id = ${hospitalId}
           AND patient_id  = ${input.patient_id}
           AND user_id     = ${ctx.user.sub}::uuid
      `;
      return { deleted: false, silenced: true };
    }),

  // ─── silence ─────────────────────────────────────────────────────
  silence: protectedProcedure
    .input(z.object({
      patient_id: uuidSchema,
      reason: z.string().trim().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      // Upsert: if user has no row yet, create a silenced watch row so the
      // silence preference persists even before they actively watch. This
      // supports "mute a patient I was never subscribed to".
      const [row] = (await sql`
        INSERT INTO chart_subscriptions (
          hospital_id, patient_id, user_id,
          source, role_snapshot,
          silenced, silenced_at, silenced_by_user_id, silenced_reason,
          created_by_user_id
        ) VALUES (
          ${hospitalId}, ${input.patient_id}, ${ctx.user.sub}::uuid,
          'watch'::cs_source, ${ctx.user.role},
          true, now(), ${ctx.user.sub}::uuid, ${input.reason ?? null},
          ${ctx.user.sub}::uuid
        )
        ON CONFLICT (patient_id, user_id) DO UPDATE SET
          silenced            = true,
          silenced_at         = now(),
          silenced_by_user_id = ${ctx.user.sub}::uuid,
          silenced_reason     = ${input.reason ?? null},
          updated_at          = now()
        RETURNING *
      `) as ChartSubscriptionRow[];
      return row;
    }),

  // ─── unsilence ───────────────────────────────────────────────────
  unsilence: protectedProcedure
    .input(z.object({ patient_id: uuidSchema }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const [row] = (await sql`
        UPDATE chart_subscriptions
           SET silenced            = false,
               silenced_at         = NULL,
               silenced_by_user_id = NULL,
               silenced_reason     = NULL,
               updated_at          = now()
         WHERE hospital_id = ${hospitalId}
           AND patient_id  = ${input.patient_id}
           AND user_id     = ${ctx.user.sub}::uuid
        RETURNING *
      `) as ChartSubscriptionRow[];
      return row ?? null;
    }),

  // ─── seedCareTeam ────────────────────────────────────────────────
  // Pulls active-encounter care team and upserts auto_care_team rows.
  // Members seeded:
  //   - attending_practitioner_id from encounters
  //   - nurse_id from ACTIVE patient_assignments on this encounter
  //   - (consulting specialists + CCE/pharm/lab assignments: wired in PC.4.B.2
  //     as hooks on those write paths; here we pick up anything already in
  //     place so re-runs are idempotent)
  // Returns the set of newly-seeded edges for telemetry.
  seedCareTeam: protectedProcedure
    .input(z.object({
      patient_id: uuidSchema,
      encounter_id: uuidSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;

      // Look up attending + active nurse assignments in one go.
      const rows = (await sql`
        WITH enc AS (
          SELECT attending_practitioner_id
            FROM encounters
           WHERE id = ${input.encounter_id}
             AND hospital_id = ${hospitalId}
             AND patient_id  = ${input.patient_id}
           LIMIT 1
        ),
        care_team AS (
          SELECT DISTINCT user_id, role_snapshot FROM (
            SELECT attending_practitioner_id AS user_id,
                   'attending'               AS role_snapshot
              FROM enc
             WHERE attending_practitioner_id IS NOT NULL
            UNION
            SELECT pa.nurse_id              AS user_id,
                   'nurse'                   AS role_snapshot
              FROM patient_assignments pa
             WHERE pa.patient_id   = ${input.patient_id}
               AND pa.encounter_id = ${input.encounter_id}
               AND pa.hospital_id  = ${hospitalId}
               AND pa.status       = 'active'
          ) t
          WHERE user_id IS NOT NULL
        )
        INSERT INTO chart_subscriptions (
          hospital_id, patient_id, user_id, source, role_snapshot,
          created_by_user_id
        )
        SELECT ${hospitalId}, ${input.patient_id}, ct.user_id,
               'auto_care_team'::cs_source, ct.role_snapshot,
               ${ctx.user.sub}::uuid
          FROM care_team ct
        ON CONFLICT (patient_id, user_id) DO UPDATE SET
          -- Keep source as whatever's stickier: watch > auto_care_team.
          source        = CASE
                            WHEN chart_subscriptions.source = 'watch'
                              THEN chart_subscriptions.source
                            ELSE EXCLUDED.source
                          END,
          -- Re-enable if the only reason we were silenced was a prior sweep.
          silenced      = CASE
                            WHEN chart_subscriptions.silenced_reason = 'discharge_sweep'
                              THEN false
                            ELSE chart_subscriptions.silenced
                          END,
          silenced_at   = CASE
                            WHEN chart_subscriptions.silenced_reason = 'discharge_sweep'
                              THEN NULL
                            ELSE chart_subscriptions.silenced_at
                          END,
          silenced_by_user_id = CASE
                            WHEN chart_subscriptions.silenced_reason = 'discharge_sweep'
                              THEN NULL
                            ELSE chart_subscriptions.silenced_by_user_id
                          END,
          silenced_reason = CASE
                            WHEN chart_subscriptions.silenced_reason = 'discharge_sweep'
                              THEN NULL
                            ELSE chart_subscriptions.silenced_reason
                          END,
          updated_at    = now()
        RETURNING user_id, role_snapshot, source,
                  (xmax = 0) AS inserted
      `) as Array<{ user_id: string; role_snapshot: string; source: string; inserted: boolean }>;

      const inserted = rows.filter((r) => r.inserted).length;
      const updated  = rows.length - inserted;
      return { inserted, updated, rows };
    }),

  // ─── seedConsultant ──────────────────────────────────────────────
  // Consulting specialist subscribes on consult REQUEST (per V-lock PC.4.B.1).
  // Called directly from medication-orders.createServiceRequest via fire-and-
  // forget; this tRPC endpoint exists for admin / manual seeding and to expose
  // a symmetric API shape alongside seedCareTeam.
  seedConsultant: protectedProcedure
    .input(z.object({
      patient_id: uuidSchema,
      consultant_user_id: uuidSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      await seedConsultantSubscription({
        hospital_id: ctx.user.hospital_id,
        patient_id: input.patient_id,
        consultant_user_id: input.consultant_user_id,
        created_by_user_id: ctx.user.sub,
      });
      return { ok: true };
    }),

  // ─── listEvents (user-scoped, PC.4.B.3) ──────────────────────────
  // Returns events on patients the current user is subscribed to (non-silenced).
  // Optional patient_id restricts to one chart; status/severity filter results.
  // LEFT JOIN chart_notification_event_reads to surface per-user state; missing
  // row = unread. Pagination via `before` (ISO timestamp cursor).
  listEvents: protectedProcedure
    .input(z.object({
      patient_id: uuidSchema.optional(),
      status: z.enum(['unread', 'read', 'dismissed', 'all']).optional().default('all'),
      severity: severityEnum.optional(),
      limit: z.number().int().positive().max(100).optional().default(30),
      before: z.string().datetime().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const userId = ctx.user.sub;

      // Single SQL with conditional filters via COALESCE/CASE. We keep the
      // query branches explicit so parameterization stays tight with neon().
      const rows = (await sql`
        SELECT cne.*,
               cer.state         AS read_state,
               cer.seen_at       AS seen_at,
               cer.dismissed_at  AS dismissed_at,
               cer.ack_reason    AS ack_reason
          FROM chart_notification_events cne
          JOIN chart_subscriptions cs
            ON cs.patient_id = cne.patient_id
           AND cs.user_id    = ${userId}
           AND cs.silenced   = false
          LEFT JOIN chart_notification_event_reads cer
            ON cer.event_id = cne.id
           AND cer.user_id  = ${userId}
         WHERE cne.hospital_id = ${hospitalId}
           AND (${input.patient_id ?? null}::uuid IS NULL OR cne.patient_id = ${input.patient_id ?? null}::uuid)
           AND (${input.severity ?? null}::cne_severity IS NULL OR cne.severity = ${input.severity ?? null}::cne_severity)
           AND (
             ${input.status}::text = 'all'
             OR (${input.status}::text = 'unread'    AND cer.state IS NULL)
             OR (${input.status}::text = 'read'      AND cer.state = 'read')
             OR (${input.status}::text = 'dismissed' AND cer.state = 'dismissed')
           )
           AND (${input.before ?? null}::timestamptz IS NULL OR cne.fired_at < ${input.before ?? null}::timestamptz)
         ORDER BY cne.fired_at DESC
         LIMIT ${input.limit}
      `) as ChartNotificationEventRow[];
      return rows;
    }),

  // ─── countUnread (PC.4.B.3) ──────────────────────────────────────
  // Bell-badge count. Returns total + per-severity breakdown. Events with no
  // reads row count as unread. Silenced subscriptions excluded.
  countUnread: protectedProcedure
    .query(async ({ ctx }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const rows = (await sql`
        SELECT cne.severity::text AS severity, COUNT(*)::int AS n
          FROM chart_notification_events cne
          JOIN chart_subscriptions cs
            ON cs.patient_id = cne.patient_id
           AND cs.user_id    = ${userId}
           AND cs.silenced   = false
          LEFT JOIN chart_notification_event_reads cer
            ON cer.event_id = cne.id
           AND cer.user_id  = ${userId}
         WHERE cne.hospital_id = ${hospitalId}
           AND cer.state IS NULL
         GROUP BY cne.severity
      `) as Array<{ severity: 'critical' | 'high' | 'normal' | 'info'; n: number }>;
      const counts = { critical: 0, high: 0, normal: 0, info: 0 };
      for (const r of rows) counts[r.severity] = Number(r.n);
      const total = counts.critical + counts.high + counts.normal + counts.info;
      return { total, ...counts };
    }),

  // ─── markRead (PC.4.B.3) ─────────────────────────────────────────
  // Bulk upsert: event_ids[] -> (state='read', seen_at=now). Subscription-scope
  // guard ensures you can't mark events on patients you don't follow.
  markRead: protectedProcedure
    .input(z.object({
      event_ids: z.array(uuidSchema).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const userId = ctx.user.sub;
      // Only touch events on patients the user is actively subscribed to.
      const allowed = (await sql`
        SELECT cne.id
          FROM chart_notification_events cne
          JOIN chart_subscriptions cs
            ON cs.patient_id = cne.patient_id
           AND cs.user_id    = ${userId}
           AND cs.silenced   = false
         WHERE cne.hospital_id = ${hospitalId}
           AND cne.id = ANY(${input.event_ids}::uuid[])
      `) as Array<{ id: string }>;
      if (allowed.length === 0) return { ok: true, updated: 0 };
      const allowedIds = allowed.map(r => r.id);
      await sql`
        INSERT INTO chart_notification_event_reads (event_id, user_id, state, seen_at, updated_at)
        SELECT unnest(${allowedIds}::uuid[]), ${userId}::uuid, 'read', now(), now()
        ON CONFLICT (event_id, user_id) DO UPDATE
          SET state      = CASE WHEN chart_notification_event_reads.state = 'dismissed'
                                THEN chart_notification_event_reads.state
                                ELSE 'read' END,
              seen_at    = COALESCE(chart_notification_event_reads.seen_at, now()),
              updated_at = now()
      `;
      return { ok: true, updated: allowed.length };
    }),

  // ─── markAllRead (PC.4.B.3) ──────────────────────────────────────
  // Clear my bell: mark every currently-unread event as read. Optional
  // patient_id restricts to one chart.
  markAllRead: protectedProcedure
    .input(z.object({
      patient_id: uuidSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const userId = ctx.user.sub;
      const targets = (await sql`
        SELECT cne.id
          FROM chart_notification_events cne
          JOIN chart_subscriptions cs
            ON cs.patient_id = cne.patient_id
           AND cs.user_id    = ${userId}
           AND cs.silenced   = false
          LEFT JOIN chart_notification_event_reads cer
            ON cer.event_id = cne.id
           AND cer.user_id  = ${userId}
         WHERE cne.hospital_id = ${hospitalId}
           AND cer.state IS NULL
           AND (${input.patient_id ?? null}::uuid IS NULL OR cne.patient_id = ${input.patient_id ?? null}::uuid)
      `) as Array<{ id: string }>;
      if (targets.length === 0) return { ok: true, updated: 0 };
      const targetIds = targets.map(r => r.id);
      await sql`
        INSERT INTO chart_notification_event_reads (event_id, user_id, state, seen_at, updated_at)
        SELECT unnest(${targetIds}::uuid[]), ${userId}::uuid, 'read', now(), now()
        ON CONFLICT (event_id, user_id) DO NOTHING
      `;
      return { ok: true, updated: targets.length };
    }),

  // ─── dismiss (PC.4.B.3) ──────────────────────────────────────────
  // Bulk dismiss events. For severity='critical' events, ack_reason (4-500
  // chars) is mandatory — enforced here, not at the schema layer, so callers
  // get a clear 400 instead of a DB constraint error.
  dismiss: protectedProcedure
    .input(z.object({
      event_ids: z.array(uuidSchema).min(1).max(200),
      ack_reason: z.string().trim().min(4).max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const userId = ctx.user.sub;

      // Fetch target events (scoped to user's active subs); keep severity for
      // the critical-ack enforcement.
      const targets = (await sql`
        SELECT cne.id, cne.severity::text AS severity
          FROM chart_notification_events cne
          JOIN chart_subscriptions cs
            ON cs.patient_id = cne.patient_id
           AND cs.user_id    = ${userId}
           AND cs.silenced   = false
         WHERE cne.hospital_id = ${hospitalId}
           AND cne.id = ANY(${input.event_ids}::uuid[])
      `) as Array<{ id: string; severity: string }>;

      if (targets.length === 0) return { ok: true, updated: 0 };

      const hasCritical = targets.some(t => t.severity === 'critical');
      if (hasCritical && !input.ack_reason) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'ack_reason (4-500 chars) required to dismiss critical-severity events',
        });
      }

      const targetIds = targets.map(r => r.id);
      await sql`
        INSERT INTO chart_notification_event_reads
          (event_id, user_id, state, seen_at, dismissed_at, ack_reason, updated_at)
        SELECT unnest(${targetIds}::uuid[]), ${userId}::uuid,
               'dismissed', now(), now(), ${input.ack_reason ?? null}, now()
        ON CONFLICT (event_id, user_id) DO UPDATE
          SET state        = 'dismissed',
              seen_at      = COALESCE(chart_notification_event_reads.seen_at, now()),
              dismissed_at = now(),
              ack_reason   = COALESCE(EXCLUDED.ack_reason, chart_notification_event_reads.ack_reason),
              updated_at   = now()
      `;
      return { ok: true, updated: targets.length };
    }),

  // ─── adminListForUser ────────────────────────────────────────────
  adminListForUser: protectedProcedure
    .input(z.object({ user_id: uuidSchema }))
    .query(async ({ ctx, input }) => {
      // Admin gate: only super_admin / hod / medical_director / unit_head / gm.
      const role = (ctx.user.role ?? '').toLowerCase();
      const adminRoles = ['super_admin', 'hod', 'medical_director', 'unit_head', 'gm'];
      if (!adminRoles.includes(role) && ctx.user.sub !== input.user_id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'adminListForUser requires admin role or self-lookup',
        });
      }
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const rows = (await sql`
        SELECT cs.*,
               p.first_name || ' ' || p.last_name AS patient_name,
               p.uhid                              AS patient_uhid
          FROM chart_subscriptions cs
          LEFT JOIN patients p ON p.id = cs.patient_id
         WHERE cs.hospital_id = ${hospitalId}
           AND cs.user_id     = ${input.user_id}
         ORDER BY cs.silenced ASC, cs.updated_at DESC
      `) as Array<ChartSubscriptionRow & { patient_name: string; patient_uhid: string }>;
      return rows;
    }),
});
