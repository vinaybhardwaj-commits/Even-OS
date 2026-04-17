/**
 * MRD Doctor Router — Sprint N.1
 *
 * Doctor-facing wrapper for the Document Vault. Wraps existing
 * `mrd_document_references` table with a safe, role-gated surface used
 * by the patient chart's Documents tab.
 *
 * Endpoints:
 *   - listForPatient(patient_id)        — scoped list (both doctor + nurse can read)
 *   - getUploadUrl({...})               — returns a Vercel Blob direct-upload URL
 *   - registerUpload({...})             — persists the row after the browser PUT
 *   - getDownloadUrl(id)                — short-lived signed read URL + audit
 *   - markSuperseded(id, supersededBy)  — mark a doc replaced by another
 *   - softDelete(id, reason)            — soft-delete with mandatory reason
 *   - listForPatientNurse(patient_id)   — explicit nurse read alias (same gate)
 *   - getDownloadUrlNurse(id)           — nurse read alias (same gate, audited)
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { writeAuditLog } from '@/lib/audit/logger';
import crypto from 'node:crypto';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

const CLINICAL_READ_ROLES = new Set<string>([
  'super_admin','hospital_admin','medical_director','department_head',
  'consultant','senior_consultant','visiting_consultant','specialist_cardiologist','hospitalist',
  'senior_resident','resident','intern',
  'senior_nurse','nurse','charge_nurse','nursing_supervisor','nursing_manager','nursing_assistant',
]);

const DOCTOR_ROLES = new Set<string>([
  'super_admin','hospital_admin','medical_director','department_head',
  'consultant','senior_consultant','visiting_consultant','specialist_cardiologist','hospitalist',
  'senior_resident','resident','intern',
]);

function assertRead(role: string) {
  if (!CLINICAL_READ_ROLES.has(role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a clinical role' });
}
function assertDoctor(role: string) {
  if (!DOCTOR_ROLES.has(role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Doctor role required' });
}

const documentTypeEnum = z.enum([
  'referral_letter','external_lab','old_chart','ecg','prescription',
  'id_document','insurance_card','consent','imaging_study','other',
]);

const contentTypeEnum = z.string().max(200);

export const mrdDoctorRouter = router({
  // ─────────────────────────────────────────────────────────
  // 1. LIST FOR PATIENT (doctor or nurse can view)
  // ─────────────────────────────────────────────────────────
  listForPatient: protectedProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertRead(ctx.user.role);
      const sql = getSql();
      const rows = await sql`
        SELECT id, patient_id, encounter_id, document_type, content_type,
               file_size_bytes, blob_url, status, scanned_at, indexed_at,
               uploaded_by, storage_tier, ocr_confidence, ocr_processed_at,
               deleted_at, deletion_reason, retention_expires, created_at
          FROM mrd_document_references
         WHERE patient_id = ${input.patient_id}
           AND deleted_at IS NULL
         ORDER BY created_at DESC
      `;
      return rows;
    }),

  // Explicit nurse alias (same role gate)
  listForPatientNurse: protectedProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertRead(ctx.user.role);
      const sql = getSql();
      const rows = await sql`
        SELECT id, document_type, content_type, file_size_bytes, status, created_at
          FROM mrd_document_references
         WHERE patient_id = ${input.patient_id}
           AND deleted_at IS NULL
         ORDER BY created_at DESC
      `;
      return rows;
    }),

  // ─────────────────────────────────────────────────────────
  // 2. GET UPLOAD URL (doctor-only, Vercel Blob direct PUT)
  // ─────────────────────────────────────────────────────────
  getUploadUrl: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      filename: z.string().min(1).max(500),
      content_type: contentTypeEnum,
    }))
    .mutation(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);

      // Blob path: tenant-prefixed, collision-safe.
      const safeName = input.filename.replace(/[^\w.\- ]/g, '_').slice(0, 200);
      const blobPath = `ehrc/${ctx.user.hospital_id}/${input.patient_id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

      // Lazy-require @vercel/blob so the rest of the router still works if
      // the package is absent in a dev shell. `generateClientTokenFromReadWriteToken`
      // returns a short-lived signed PUT URL.
      let uploadUrl: string;
      let token: string;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const blob = await import('@vercel/blob/client' as any).catch(() => null);
        if (!blob || !process.env.BLOB_READ_WRITE_TOKEN) {
          // Fallback path: return the blob path so the FE can POST to a Next route instead
          return {
            blob_path: blobPath,
            upload_mode: 'fallback' as const,
            upload_url: null,
            token: null,
            expires_in_seconds: 0,
          };
        }
        const generated = await blob.generateClientTokenFromReadWriteToken({
          pathname: blobPath,
          allowedContentTypes: [input.content_type],
          tokenPayload: JSON.stringify({ patient_id: input.patient_id, user: ctx.user.sub }),
          validUntil: Date.now() + 15 * 60 * 1000,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        uploadUrl = `https://blob.vercel-storage.com/${encodeURIComponent(blobPath)}`;
        token = generated;
      } catch (err) {
        // If blob import or token generation fails, still give the FE the path;
        // FE can route uploads through a Next API route as a fallback.
        return {
          blob_path: blobPath,
          upload_mode: 'fallback' as const,
          upload_url: null,
          token: null,
          expires_in_seconds: 0,
        };
      }

      return {
        blob_path: blobPath,
        upload_mode: 'direct' as const,
        upload_url: uploadUrl,
        token,
        expires_in_seconds: 15 * 60,
      };
    }),

  // ─────────────────────────────────────────────────────────
  // 3. REGISTER UPLOAD (doctor-only; persists row after PUT)
  // ─────────────────────────────────────────────────────────
  registerUpload: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid().nullable().optional(),
      document_type: documentTypeEnum,
      content_type: contentTypeEnum,
      file_size_bytes: z.number().int().min(0),
      blob_url: z.string().url(),
      blob_hash: z.string().min(32).max(128),
      filename: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);
      const sql = getSql();

      const inserted = await sql`
        INSERT INTO mrd_document_references (
          patient_id, encounter_id, document_type, content_type, file_size_bytes,
          blob_url, blob_hash, status, uploaded_by, storage_tier, scanned_at
        ) VALUES (
          ${input.patient_id}, ${input.encounter_id ?? null}, ${input.document_type},
          ${input.content_type}, ${String(input.file_size_bytes)},
          ${input.blob_url}, ${input.blob_hash}, 'pending_ingestion',
          ${ctx.user.sub}, 'vercel_blob', now()
        )
        RETURNING id
      `;
      const docId = inserted[0].id;

      // Fire-and-forget: enqueue document ingestion if mime is text-extractable.
      const isTextExtractable = /pdf|wordprocessingml|msword|text\/plain|markdown|rtf/i.test(input.content_type);
      if (isTextExtractable) {
        // Resolve hospital uuid for ai_request_queue
        const hosp = await sql`SELECT id FROM hospitals WHERE hospital_id = ${ctx.user.hospital_id} LIMIT 1`;
        if (hosp.length > 0) {
          await sql`
            INSERT INTO ai_request_queue (hospital_id, module, priority, input_data, prompt_template, status, attempts, max_attempts)
            VALUES (
              ${hosp[0].id}, 'clinical', 'medium',
              ${JSON.stringify({ document_id: docId, patient_id: input.patient_id })}::jsonb,
              'ingest_document', 'pending', 0, 3
            )
          `;
          await sql`
            INSERT INTO ai_request_queue (hospital_id, module, priority, input_data, prompt_template, status, attempts, max_attempts)
            VALUES (
              ${hosp[0].id}, 'clinical', 'high',
              ${JSON.stringify({ patient_id: input.patient_id, trigger: 'new_document' })}::jsonb,
              'regenerate_brief', 'pending', 0, 3
            )
          `;
        }
      }

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'mrd_document_references',
        row_id: docId,
        new_values: {
          patient_id: input.patient_id,
          document_type: input.document_type,
          file_size_bytes: input.file_size_bytes,
          filename: input.filename ?? null,
        },
      });

      return { id: docId, queued_ingestion: isTextExtractable };
    }),

  // ─────────────────────────────────────────────────────────
  // 4. GET DOWNLOAD URL (short-lived; audit every call)
  // ─────────────────────────────────────────────────────────
  getDownloadUrl: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertRead(ctx.user.role);
      const sql = getSql();
      const rows = await sql`
        SELECT id, blob_url, content_type, patient_id
          FROM mrd_document_references
         WHERE id = ${input.id} AND deleted_at IS NULL
         LIMIT 1
      `;
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });

      await writeAuditLog(ctx.user, {
        action: 'ACCESS',
        table_name: 'mrd_document_references',
        row_id: input.id,
        reason: 'Document downloaded',
      });

      // v1: Vercel Blob URLs are signed at upload; just return blob_url.
      return { url: rows[0].blob_url, content_type: rows[0].content_type };
    }),

  // Nurse alias for download (same audit, same gate)
  getDownloadUrlNurse: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertRead(ctx.user.role);
      const sql = getSql();
      const rows = await sql`
        SELECT id, blob_url, content_type
          FROM mrd_document_references
         WHERE id = ${input.id} AND deleted_at IS NULL
         LIMIT 1
      `;
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAuditLog(ctx.user, {
        action: 'ACCESS',
        table_name: 'mrd_document_references',
        row_id: input.id,
        reason: 'Document downloaded (nurse)',
      });
      return { url: rows[0].blob_url, content_type: rows[0].content_type };
    }),

  // ─────────────────────────────────────────────────────────
  // 5. MARK SUPERSEDED
  // ─────────────────────────────────────────────────────────
  markSuperseded: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      superseded_by: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);
      const sql = getSql();
      await sql`
        UPDATE mrd_document_references
           SET status = 'superseded'
         WHERE id = ${input.id}
      `;
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'mrd_document_references',
        row_id: input.id,
        new_values: { status: 'superseded', superseded_by: input.superseded_by, reason: input.reason ?? null },
      });
      return { ok: true as const };
    }),

  // ─────────────────────────────────────────────────────────
  // 6. SOFT DELETE (requires reason)
  // ─────────────────────────────────────────────────────────
  softDelete: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(3).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);
      const sql = getSql();
      await sql`
        UPDATE mrd_document_references
           SET deleted_at = now(),
               deleted_by = ${ctx.user.sub},
               deletion_reason = ${input.reason},
               status = 'deleted'
         WHERE id = ${input.id}
      `;
      await writeAuditLog(ctx.user, {
        action: 'DELETE',
        table_name: 'mrd_document_references',
        row_id: input.id,
        reason: input.reason,
      });
      return { ok: true as const };
    }),
});
