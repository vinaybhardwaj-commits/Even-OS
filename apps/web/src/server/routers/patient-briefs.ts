/**
 * Patient Briefs Router — Sprint N.1
 *
 * Doctor + nurse-facing read/regenerate surface for the continuously-regenerated
 * Patient Brief (see NOTES-V2-DOCUMENT-VAULT-PRD.md §5).
 *
 * Endpoints:
 *   - listBriefs(patient_id)           — all brief versions for a patient
 *   - getBrief(id)                     — one brief + its sources
 *   - regenerateBrief(patient_id)      — enqueue a priority=critical regen job
 *   - listSources(brief_id)            — source pointers for traceability
 *   - flagIssue(brief_id, description) — doctor-raised hallucination flag
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { writeAuditLog } from '@/lib/audit/logger';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// Role gates — clinical roles can read; only doctor-tier roles can regenerate/flag.
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
  if (!CLINICAL_READ_ROLES.has(role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a clinical role' });
  }
}
function assertDoctor(role: string) {
  if (!DOCTOR_ROLES.has(role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Doctor role required' });
  }
}

export const patientBriefsRouter = router({
  // ─────────────────────────────────────────────────────────
  // 1. LIST BRIEFS (all versions for a patient, newest first)
  // ─────────────────────────────────────────────────────────
  listBriefs: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      assertRead(ctx.user.role);
      const sql = getSql();
      const rows = await sql`
        SELECT id, version, narrative, trigger_event, triggered_by,
               is_stale, generated_at, supersedes_id,
               jsonb_array_length(COALESCE(source_ids, '[]'::jsonb))   AS source_count,
               jsonb_array_length(COALESCE(hallucination_flags, '[]'::jsonb)) AS flag_count
          FROM patient_briefs
         WHERE patient_id = ${input.patient_id}
         ORDER BY version DESC
         LIMIT ${input.limit}
      `;
      return rows;
    }),

  // ─────────────────────────────────────────────────────────
  // 2. GET BRIEF (full detail for one version)
  // ─────────────────────────────────────────────────────────
  getBrief: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertRead(ctx.user.role);
      const sql = getSql();
      const rows = await sql`
        SELECT * FROM patient_briefs WHERE id = ${input.id} LIMIT 1
      `;
      if (rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brief not found' });
      }
      return rows[0];
    }),

  // ─────────────────────────────────────────────────────────
  // 3. REGENERATE BRIEF (enqueue job at priority=critical)
  // ─────────────────────────────────────────────────────────
  regenerateBrief: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      reason: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);
      const sql = getSql();

      // Resolve hospital uuid — ai_request_queue.hospital_id is a uuid, not text
      const hospitalRows = await sql`
        SELECT id FROM hospitals WHERE hospital_id = ${ctx.user.hospital_id} LIMIT 1
      `;
      if (hospitalRows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Hospital not found' });
      }
      const hospitalUuid = hospitalRows[0].id;

      // Enqueue (or bump priority if one already pending)
      const existing = await sql`
        SELECT id, priority FROM ai_request_queue
         WHERE hospital_id = ${hospitalUuid}
           AND module = 'clinical'
           AND prompt_template = 'regenerate_brief'
           AND status IN ('pending','running')
           AND input_data->>'patient_id' = ${input.patient_id}
         LIMIT 1
      `;

      if (existing.length > 0) {
        await sql`
          UPDATE ai_request_queue
             SET priority = 'critical',
                 input_data = jsonb_set(input_data, '{trigger_tags}',
                   COALESCE(input_data->'trigger_tags', '[]'::jsonb) || '["manual"]'::jsonb)
           WHERE id = ${existing[0].id}
        `;
      } else {
        await sql`
          INSERT INTO ai_request_queue (
            hospital_id, module, priority, input_data, prompt_template, status, attempts, max_attempts
          ) VALUES (
            ${hospitalUuid}, 'clinical', 'critical',
            ${JSON.stringify({
              patient_id: input.patient_id,
              trigger: 'manual',
              trigger_tags: ['manual'],
              requested_by: ctx.user.sub,
              reason: input.reason ?? null,
            })}::jsonb,
            'regenerate_brief', 'pending', 0, 3
          )
        `;
      }

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'ai_request_queue',
        reason: 'Manual Patient Brief regeneration requested',
        new_values: { patient_id: input.patient_id, trigger: 'manual' },
      });

      return { ok: true as const };
    }),

  // ─────────────────────────────────────────────────────────
  // 4. LIST SOURCES (what went into this brief)
  // ─────────────────────────────────────────────────────────
  listSources: protectedProcedure
    .input(z.object({ brief_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertRead(ctx.user.role);
      const sql = getSql();
      const rows = await sql`
        SELECT id, source_table, source_id, included_at
          FROM patient_brief_sources
         WHERE brief_id = ${input.brief_id}
         ORDER BY source_table, included_at
      `;
      return rows;
    }),

  // ─────────────────────────────────────────────────────────
  // 5. FLAG ISSUE (doctor-raised accuracy concern)
  // ─────────────────────────────────────────────────────────
  flagIssue: protectedProcedure
    .input(z.object({
      brief_id: z.string().uuid(),
      description: z.string().min(5).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);
      const sql = getSql();

      const inserted = await sql`
        INSERT INTO patient_brief_flags (
          brief_id, flagged_by, flagged_by_role, description, status
        ) VALUES (
          ${input.brief_id}, ${ctx.user.sub}, ${ctx.user.role},
          ${input.description}, 'open'
        )
        RETURNING id
      `;

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'patient_brief_flags',
        row_id: inserted[0].id,
        new_values: { brief_id: input.brief_id, description: input.description },
      });

      return { id: inserted[0].id };
    }),
});
