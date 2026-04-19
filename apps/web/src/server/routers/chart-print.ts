/**
 * Patient Chart Overhaul — PC.4.D.2.3 — chartPrint tRPC router (live).
 *
 * Audit + file log for per-tab PDF exports. See 60-chart-print-exports.ts
 * for the table shape and the 10 D.2-locked defaults (19 Apr 2026).
 *
 * D.2.3 delta vs D.2.2:
 *   - Scopes extended to five tab templates: `tab_overview`, `tab_brief`,
 *     `tab_notes`, `tab_meds`, `tab_labs` (all with tab: / bare aliases).
 *   - Pagination polish: `pdf-parse` post-render to patch `page_count` on
 *     the audit row. Parse failure is tolerated — page_count stays NULL.
 *   - Other scopes still return a 'failed' row with error='D.3 template
 *     pending' so the UI flow stays stable before D.3 / PC.5 scopes land.
 *   - listForPatient / listForUser now OMIT file_url from their response —
 *     callers must hit getById for a concrete URL. This matches the D.3
 *     upgrade path where getById will mint per-request signed URLs.
 *   - getById still returns file_url (raw public URL for now). When
 *     @vercel/blob is upgraded past 0.27 we swap this for a per-request
 *     getSignedUrl() — response shape won't change.
 *
 * Raw SQL via the Neon HTTP driver — consistent with chart-subscriptions,
 * chart-locks, chat, complaints routers.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  loadChartBundle,
  renderChartPrint,
  normaliseScope,
  composeWatermark,
  composeExportedByLine,
} from '@/lib/chart-print/render';

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

type PrintRowCore = {
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
  file_size_bytes: number | null;
  page_count: number | null;
  status: 'generating' | 'ready' | 'failed';
  error: string | null;
  created_at: string;
  ready_at: string | null;
};

type PrintRowFull = PrintRowCore & { file_url: string | null };

/**
 * Upload a rendered PDF buffer to Vercel Blob. Returns the public URL.
 * Lazy-imports @vercel/blob to avoid forcing a hard dep resolution in
 * edge-compiled paths that might tree-shake it out.
 *
 * Layout: `chart-prints/{hospital_id}/{patient_id}/{YYYY-MM-DD}/{scope}-{print_id}.pdf`
 * — hospital/patient date prefix keeps blobs auditable + navigable without
 * needing to read the DB.
 */
async function uploadPdfToBlob(params: {
  buffer: Buffer;
  hospitalId: string;
  patientId: string;
  scope: string;
  printId: string;
}): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN not configured — cannot upload PDF');
  }
  const mod = (await import('@vercel/blob').catch(() => null)) as
    | typeof import('@vercel/blob')
    | null;
  if (!mod || typeof mod.put !== 'function') {
    throw new Error('@vercel/blob.put not available at runtime');
  }
  const ymd = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const path = `chart-prints/${params.hospitalId}/${params.patientId}/${ymd}/${params.scope}-${params.printId}.pdf`;
  const res = await mod.put(path, params.buffer, {
    access: 'public',
    contentType: 'application/pdf',
    // addRandomSuffix=false — the print id already guarantees uniqueness and
    // gives us a deterministic URL we can reference in the audit row.
    addRandomSuffix: false,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    cacheControlMaxAge: 60, // minimal caching; audit row is the source of truth
  });
  return res.url;
}

const TAB_LABELS: Record<'overview' | 'brief' | 'notes' | 'meds' | 'labs', string> = {
  overview: 'Overview',
  brief: 'Patient Brief',
  notes: 'Clinical Notes',
  meds: 'Medications',
  labs: 'Laboratory',
};

export const chartPrintRouter = router({
  // ───────────────────────────────────────────────────────────────────
  // generateTab — real render-then-upload pipeline (D.2.2).
  //
  // Scopes supported: tab_overview, tab_brief, tab_notes, tab_meds,
  // tab_labs (aliases: overview/brief/notes/meds/labs + tab: prefix). Everything else logs a 'failed' row with a
  // machine-readable error so the UI flow stays stable pre-D.3.
  // ───────────────────────────────────────────────────────────────────
  generateTab: protectedProcedure
    .input(
      z.object({
        patient_id: uuidSchema,
        scope: scopeSchema,
        tab_name: z.string().min(1).max(80).optional(),
        watermark: z.string().min(1).max(400).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId =
        ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;

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

      const timestampIso = new Date().toISOString();
      const watermarkLine =
        input.watermark ??
        composeWatermark({
          userName: ctx.user.name ?? '—',
          userRole: ctx.user.role ?? 'unknown',
          timestampIso,
          uhid: patient.uhid,
        });

      const knownScope = normaliseScope(input.scope);
      const tabLabel =
        input.tab_name ??
        (knownScope ? TAB_LABELS[knownScope] : input.scope);

      // Insert "generating" row first. Makes the work observable even if
      // the render blows up or the Blob upload times out.
      const insertedRows = (await sql`
        INSERT INTO chart_print_exports (
          hospital_id, user_id, user_name, user_role,
          patient_id, uhid_at_time,
          scope, tab_name, watermark,
          status, error
        )
        VALUES (
          ${hospitalId}, ${ctx.user.sub}::uuid, ${ctx.user.name ?? '—'}, ${ctx.user.role ?? 'unknown'},
          ${patient.id}::uuid, ${patient.uhid},
          ${input.scope}, ${tabLabel}, ${watermarkLine},
          'generating', NULL
        )
        RETURNING id, created_at
      `) as Array<{ id: string; created_at: string }>;
      const printId = insertedRows[0].id;

      // Unsupported scope → record as failed and return.
      if (!knownScope) {
        await sql`
          UPDATE chart_print_exports
             SET status = 'failed',
                 error = ${'D.3 template pending — scope: ' + input.scope}
           WHERE id = ${printId}::uuid
        `;
        return {
          id: printId,
          status: 'failed' as const,
          error: 'D.3 template pending — scope: ' + input.scope,
          createdAt: insertedRows[0].created_at,
          readyAt: null as string | null,
          fileUrl: null as string | null,
          pageCount: null as number | null,
          bytes: null as number | null,
        };
      }

      // Render + upload.
      try {
        const bundle = await loadChartBundle(hospitalId, patient.id);

        const exportedByLine = composeExportedByLine({
          userName: ctx.user.name ?? '—',
          userRole: ctx.user.role ?? 'unknown',
          timestampIso,
        });

        const { buffer, bytes } = await renderChartPrint(
          knownScope,
          bundle,
          {
            watermarkLine,
            exportedByLine,
            printIdShort: printId.slice(0, 8),
            tabLabel,
          },
        );

        // D.2.3 pagination polish — parse the rendered PDF to patch the
        // page_count column on the audit row. pdf-parse is a thin wrapper
        // around pdfjs and runs in Node; we tolerate parse failure so a
        // broken parser doesn't mask an otherwise-successful export.
        let pageCount: number | null = null;
        try {
          const pdfParse = (await import('pdf-parse')).default;
          const parsed = await pdfParse(buffer);
          pageCount = typeof parsed.numpages === 'number' && parsed.numpages > 0
            ? parsed.numpages
            : null;
        } catch {
          pageCount = null;
        }

        const fileUrl = await uploadPdfToBlob({
          buffer,
          hospitalId,
          patientId: patient.id,
          scope: knownScope,
          printId,
        });

        const updated = (await sql`
          UPDATE chart_print_exports
             SET status = 'ready',
                 file_url = ${fileUrl},
                 file_size_bytes = ${bytes},
                 page_count = ${pageCount},
                 ready_at = NOW()
           WHERE id = ${printId}::uuid
           RETURNING id, status, ready_at, file_size_bytes, page_count
        `) as Array<{
          id: string;
          status: 'ready';
          ready_at: string;
          file_size_bytes: number | null;
          page_count: number | null;
        }>;

        return {
          id: printId,
          status: updated[0].status,
          error: null as string | null,
          createdAt: insertedRows[0].created_at,
          readyAt: updated[0].ready_at,
          fileUrl,
          pageCount: updated[0].page_count,
          bytes: updated[0].file_size_bytes,
        };
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message.slice(0, 500)
            : 'unknown renderer error';
        await sql`
          UPDATE chart_print_exports
             SET status = 'failed',
                 error = ${msg}
           WHERE id = ${printId}::uuid
        `;
        return {
          id: printId,
          status: 'failed' as const,
          error: msg,
          createdAt: insertedRows[0].created_at,
          readyAt: null as string | null,
          fileUrl: null as string | null,
          pageCount: null as number | null,
          bytes: null as number | null,
        };
      }
    }),

  // ───────────────────────────────────────────────────────────────────
  // listForPatient — recent exports for a chart, desc-bounded pagination.
  // Does NOT include file_url (call getById to resolve a URL).
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
               file_size_bytes, page_count,
               status, error, created_at, ready_at
          FROM chart_print_exports
         WHERE patient_id = ${input.patient_id}::uuid
           AND hospital_id = ${hospitalId}
           AND (${beforeIso}::timestamptz IS NULL OR created_at < ${beforeIso}::timestamptz)
         ORDER BY created_at DESC
         LIMIT ${input.limit}
      `) as PrintRowCore[];

      return rows;
    }),

  // ───────────────────────────────────────────────────────────────────
  // listForUser — self by default; admin may pass user_id to audit others.
  // Also omits file_url — callers resolve via getById.
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
               file_size_bytes, page_count,
               status, error, created_at, ready_at
          FROM chart_print_exports
         WHERE user_id = ${targetId}::uuid
           AND hospital_id = ${hospitalId}
           AND (${beforeIso}::timestamptz IS NULL OR created_at < ${beforeIso}::timestamptz)
         ORDER BY created_at DESC
         LIMIT ${input.limit}
      `) as PrintRowCore[];

      return rows;
    }),

  // ───────────────────────────────────────────────────────────────────
  // getById — single row, hospital-scoped. Returns the raw file_url.
  // D.3 upgrade path: swap for a per-request @vercel/blob signed URL.
  // ───────────────────────────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: uuidSchema }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;

      const rows = (await sql`
        SELECT id, hospital_id, user_id, user_name, user_role,
               patient_id, uhid_at_time, scope, tab_name, watermark,
               file_url, file_size_bytes, page_count,
               status, error, created_at, ready_at
          FROM chart_print_exports
         WHERE id = ${input.id}::uuid
           AND hospital_id = ${hospitalId}
         LIMIT 1
      `) as PrintRowFull[];

      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return rows[0];
    }),
});
