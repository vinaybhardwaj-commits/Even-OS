/**
 * Patient Chart Overhaul — PC.4.D.2.1 — chartPrint tRPC router (skeleton).
 *
 * Audit + file log for per-tab PDF exports. See
 * 60-chart-print-exports.ts for table-shape decisions and the 10 D.2-locked
 * defaults (19 Apr 2026).
 *
 * D.2.1 scope (THIS commit):
 *   - Schema + migration + router skeleton only.
 *   - `generateTab` is a PLACEHOLDER — it writes an audit row immediately
 *     marked status='failed' with error='D.2.2 renderer pending'. This
 *     keeps the tRPC surface stable while the renderer lands in D.2.2.
 *   - list + get endpoints return real rows and are usable today.
 *
 * Endpoints:
 *   - generateTab({ patient_id, scope, tab_name, watermark })
 *         Placeholder in D.2.1. Writes a status='failed' audit row and
 *         returns its id + status. D.2.2 replaces the body with the
 *         @react-pdf/renderer pipeline (render -> Vercel Blob upload ->
 *         update row to status='ready' + file_url).
 *   - listForPatient({ patient_id, limit?, before? })
 *         Recent exports for this chart, descending by created_at.
 *         Powers the "recent prints" list on the chart header drawer.
 *   - listForUser({ user_id?, limit?, before? })
 *         Admin: exports by a specific user, or by self if user_id omitted.
 *         Powers /admin/chart/prints (lands in D.3).
 *   - getById({ id })
 *         Single export row — used to resolve signed file URLs and to
 *         refresh status on a pending print.
 *
 * Signed URLs: D.2.1 returns the raw file_url (null during placeholder
 * phase). D.2.2 switches to on-demand 1h-TTL signed URLs via the Vercel
 * Blob SDK — this router's response shape stays the same.
 *
 * Raw SQL via the Neon HTTP driver — consistent with chart-subscriptions,
 * chart-locks, chat, complaints routers.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

const uuidSchema = z.string().uuid();

// Scope string schema. D.2 ships tab scopes only; D.3 adds 'mrd:full',
// 'mrd:custom', PC.5 will add bundle scopes. Kept as a regex rather than
// a closed enum so we don't need a DB migration every time a scope lands.
const scopeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_:.-]+$/i, 'scope must be slug-safe');

type PrintRow = {
  id: string;
  hospital_id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  patient_id: string;
  uhid_at_time: string;
  scope: string;
  tab_name: string;
  watermark: string;
  file_url: string | null;
  file_size_bytes: number | null;
  page_count: number | null;
  status: 'generating' | 'ready' | 'failed';
  error: string | null;
  created_at: string;
  ready_at: string | null;
};

export const chartPrintRouter = router({
  // ───────────────────────────────────────────────────────────────────
  // generateTab — PLACEHOLDER (D.2.1). Real renderer lands in D.2.2.
  //
  // Writes a status='failed' audit row so the UI can still wire up the
  // button flow + error-state rendering. D.2.2 will replace this body
  // with the real render-then-upload pipeline (status transitions:
  // generating -> ready, or generating -> failed on renderer error).
  // ───────────────────────────────────────────────────────────────────
  generateTab: protectedProcedure
    .input(
      z.object({
        patient_id: uuidSchema,
        scope: scopeSchema,
        tab_name: z.string().min(1).max(80),
        watermark: z.string().min(1).max(400),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;

      // Patient must exist in caller's hospital — hard isolation.
      const patientRows = (await sql`
        SELECT id, uhid, hospital_id
          FROM patients
         WHERE id = ${input.patient_id}::uuid
           AND hospital_id = ${hospitalId}
         LIMIT 1
      `) as Array<{ id: string; uhid: string; hospital_id: string }>;
      const patient = patientRows[0];
      if (!patient) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'patient not found' });
      }

      // Write audit row as status='failed' — D.2.2 replaces this block
      // with the real renderer + blob upload.
      const inserted = (await sql`
        INSERT INTO chart_print_exports (
          hospital_id, user_id, user_name, user_role,
          patient_id, uhid_at_time,
          scope, tab_name, watermark,
          status, error
        )
        VALUES (
          ${hospitalId}, ${ctx.user.sub}::uuid, ${ctx.user.name}, ${ctx.user.role},
          ${patient.id}::uuid, ${patient.uhid},
          ${input.scope}, ${input.tab_name}, ${input.watermark},
          'failed', 'D.2.2 renderer pending'
        )
        RETURNING id, status, error, created_at
      `) as Array<{
        id: string;
        status: 'failed';
        error: string;
        created_at: string;
      }>;

      return {
        id: inserted[0].id,
        status: inserted[0].status,
        error: inserted[0].error,
        createdAt: inserted[0].created_at,
        // D.2.2 will set this to a 1h-TTL signed blob URL
        fileUrl: null as string | null,
      };
    }),

  // ───────────────────────────────────────────────────────────────────
  // listForPatient — recent exports for a chart, desc-bounded pagination.
  // ───────────────────────────────────────────────────────────────────
  listForPatient: protectedProcedure
    .input(
      z.object({
        patient_id: uuidSchema,
        limit: z.number().int().min(1).max(100).default(25),
        before: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const beforeIso = input.before ?? null;

      const rows = (await sql`
        SELECT id, hospital_id, user_id, user_name, user_role,
               patient_id, uhid_at_time, scope, tab_name, watermark,
               file_url, file_size_bytes, page_count,
               status, error, created_at, ready_at
          FROM chart_print_exports
         WHERE patient_id = ${input.patient_id}::uuid
           AND hospital_id = ${hospitalId}
           AND (${beforeIso}::timestamptz IS NULL OR created_at < ${beforeIso}::timestamptz)
         ORDER BY created_at DESC
         LIMIT ${input.limit}
      `) as PrintRow[];

      return rows;
    }),

  // ───────────────────────────────────────────────────────────────────
  // listForUser — self by default; admin may pass user_id to audit others.
  // ───────────────────────────────────────────────────────────────────
  listForUser: protectedProcedure
    .input(
      z.object({
        user_id: uuidSchema.optional(),
        limit: z.number().int().min(1).max(100).default(25),
        before: z.string().datetime().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const callerId = ctx.user.sub;
      const callerRole = ctx.user.role;
      const hospitalId = ctx.user.hospital_id;

      const targetId = input.user_id ?? callerId;
      const isAdmin =
        callerRole === 'super_admin' || callerRole === 'hospital_admin';

      if (targetId !== callerId && !isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'only admins can list prints for other users',
        });
      }

      const beforeIso = input.before ?? null;

      const rows = (await sql`
        SELECT id, hospital_id, user_id, user_name, user_role,
               patient_id, uhid_at_time, scope, tab_name, watermark,
               file_url, file_size_bytes, page_count,
               status, error, created_at, ready_at
          FROM chart_print_exports
         WHERE user_id = ${targetId}::uuid
           AND hospital_id = ${hospitalId}
           AND (${beforeIso}::timestamptz IS NULL OR created_at < ${beforeIso}::timestamptz)
         ORDER BY created_at DESC
         LIMIT ${input.limit}
      `) as PrintRow[];

      return rows;
    }),

  // ───────────────────────────────────────────────────────────────────
  // getById — single row, hospital-scoped.
  // ───────────────────────────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: uuidSchema }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;

      const rows = (await sql`
        SELECT id, hospital_id, user_id, user_name, user_role,
               patient_id, uhid_at_time, scope, tab_name, watermark,
               file_url, file_size_bytes, page_count,
               status, error, created_at, ready_at
          FROM chart_print_exports
         WHERE id = ${input.id}::uuid
           AND hospital_id = ${hospitalId}
         LIMIT 1
      `) as PrintRow[];

      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return rows[0];
    }),
});
