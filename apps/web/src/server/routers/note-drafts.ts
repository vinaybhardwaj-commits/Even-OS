/**
 * Note Drafts Router — Sprint N.3
 *
 * Server-side autosave surface for the Notes v2 editor. Each (patient,
 * encounter, note_type, author) pair gets exactly one draft row, upserted on
 * every save call. Partnered with a localStorage fallback in the client —
 * this endpoint set is the primary store; localStorage keeps the editor
 * responsive when the network hiccups.
 *
 * Endpoints:
 *   - getDraft({ patient_id, encounter_id, note_type })  — read this author's draft
 *   - saveDraft({ ...slot, body, template_id? })         — upsert
 *   - clearDraft({ ...slot })                            — remove after successful submit
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

const CLINICAL_ROLES = new Set<string>([
  'super_admin','hospital_admin','medical_director','department_head',
  'consultant','senior_consultant','visiting_consultant','specialist_cardiologist','hospitalist',
  'senior_resident','resident','intern',
  'senior_nurse','nurse','charge_nurse','nursing_supervisor','nursing_manager','nursing_assistant',
]);

function assertClinical(role: string) {
  if (!CLINICAL_ROLES.has(role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Clinical role required' });
  }
}

// Enum values (matches note_type enum post-migration 0051)
const noteTypeSchema = z.enum([
  'nursing_note', 'soap_note', 'operative_note', 'anaesthesia_record',
  'discharge_summary', 'death_summary', 'shift_handover', 'mlc_form', 'referral_letter',
  'progress_note', 'admission_note', 'physical_exam', 'procedure_note',
  'consultation_note', 'ward_round_note',
]);

const slotSchema = z.object({
  patient_id: z.string().uuid(),
  encounter_id: z.string().uuid(),
  note_type: noteTypeSchema,
});

export const noteDraftsRouter = router({
  // ─────────────────────────────────────────────────────────
  // GET DRAFT (this author, this patient/encounter/note_type)
  // ─────────────────────────────────────────────────────────
  getDraft: protectedProcedure
    .input(slotSchema)
    .query(async ({ ctx, input }) => {
      assertClinical(ctx.user.role);
      const sql = getSql();
      const rows = await sql`
        SELECT id, patient_id, encounter_id, note_type, author_id,
               template_id, body, created_at, updated_at
          FROM clinical_note_drafts
         WHERE patient_id   = ${input.patient_id}
           AND encounter_id = ${input.encounter_id}
           AND note_type    = ${input.note_type}
           AND author_id    = ${ctx.user.sub}
         LIMIT 1
      `;
      return rows[0] ?? null;
    }),

  // ─────────────────────────────────────────────────────────
  // SAVE DRAFT (upsert on unique slot)
  // ─────────────────────────────────────────────────────────
  saveDraft: protectedProcedure
    .input(slotSchema.extend({
      body: z.record(z.any()),
      template_id: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      assertClinical(ctx.user.role);
      const sql = getSql();

      const rows = await sql`
        INSERT INTO clinical_note_drafts (
          hospital_id, patient_id, encounter_id, note_type, author_id,
          template_id, body, updated_at
        ) VALUES (
          ${ctx.user.hospital_id},
          ${input.patient_id},
          ${input.encounter_id},
          ${input.note_type},
          ${ctx.user.sub},
          ${input.template_id ?? null},
          ${JSON.stringify(input.body)}::jsonb,
          now()
        )
        ON CONFLICT (patient_id, encounter_id, note_type, author_id)
        DO UPDATE SET
          body        = EXCLUDED.body,
          template_id = COALESCE(EXCLUDED.template_id, clinical_note_drafts.template_id),
          updated_at  = now()
        RETURNING id, updated_at
      `;
      return { ok: true as const, id: rows[0].id, updated_at: rows[0].updated_at };
    }),

  // ─────────────────────────────────────────────────────────
  // CLEAR DRAFT (after successful submit)
  // ─────────────────────────────────────────────────────────
  clearDraft: protectedProcedure
    .input(slotSchema)
    .mutation(async ({ ctx, input }) => {
      assertClinical(ctx.user.role);
      const sql = getSql();
      await sql`
        DELETE FROM clinical_note_drafts
         WHERE patient_id   = ${input.patient_id}
           AND encounter_id = ${input.encounter_id}
           AND note_type    = ${input.note_type}
           AND author_id    = ${ctx.user.sub}
      `;
      return { ok: true as const };
    }),
});
