/**
 * Chart Proposals Router — Sprint N.1
 *
 * Doctor-facing review surface for LLM-extracted facts from uploaded documents.
 * Each row in `chart_update_proposals` represents a single proposed INSERT
 * into a real clinical table (conditions / allergy_intolerances /
 * medication_orders / observations / etc.). The doctor reviews one at a time.
 *
 * Endpoints:
 *   - listPending(patient_id)            — proposals awaiting doctor action
 *   - acceptProposal(id)                 — apply the payload to the real table
 *   - rejectProposal(id, reason)         — reject, require short reason
 *   - modifyAndAccept(id, patch)         — merge patch into payload, then accept
 *
 * Accept logic dispatches per `proposal_type`. If the real-table INSERT fails
 * we leave the proposal status = 'pending' and throw; the doctor can retry.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { writeAuditLog } from '@/lib/audit/logger';
import { enqueueBriefRegenByText } from '@/lib/patient-brief/enqueue';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

const DOCTOR_ROLES = new Set<string>([
  'super_admin','hospital_admin','medical_director','department_head',
  'consultant','senior_consultant','visiting_consultant','specialist_cardiologist','hospitalist',
  'senior_resident','resident','intern',
]);
function assertDoctor(role: string) {
  if (!DOCTOR_ROLES.has(role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Doctor role required' });
}

// ─────────────────────────────────────────────────────────
// Per-proposal-type apply handlers.
// Each takes `payload` and a `ctx` containing patient_id, encounter_id,
// hospital_id, user, sql — and returns the inserted row's id.
// ─────────────────────────────────────────────────────────

type ApplyCtx = {
  sql: NeonQueryFunction<false, false>;
  hospitalId: string;
  patientId: string;
  encounterId: string | null;
  userId: string;
};

async function applyCondition(ctx: ApplyCtx, payload: any): Promise<string> {
  const r = await ctx.sql`
    INSERT INTO conditions (
      patient_id, encounter_id, hospital_id, code, label, severity, onset_date, verification_status, clinical_status, recorded_by
    ) VALUES (
      ${ctx.patientId}, ${ctx.encounterId}, ${ctx.hospitalId},
      ${payload.code ?? payload.icd10 ?? null}, ${payload.label ?? payload.name ?? ''},
      ${payload.severity ?? 'moderate'}, ${payload.onset_date ?? null},
      'unconfirmed', 'active', ${ctx.userId}
    )
    RETURNING id
  `;
  return r[0].id;
}

async function applyAllergy(ctx: ApplyCtx, payload: any): Promise<string> {
  const r = await ctx.sql`
    INSERT INTO allergy_intolerances (
      patient_id, hospital_id, substance, reaction, severity, verification_status, recorded_by
    ) VALUES (
      ${ctx.patientId}, ${ctx.hospitalId}, ${payload.allergen ?? payload.substance ?? ''},
      ${payload.reaction ?? null}, ${payload.severity ?? 'moderate'},
      'unconfirmed', ${ctx.userId}
    )
    RETURNING id
  `;
  return r[0].id;
}

async function applyMedication(ctx: ApplyCtx, payload: any): Promise<string> {
  const r = await ctx.sql`
    INSERT INTO medication_orders (
      patient_id, encounter_id, hospital_id, drug_name, dose, frequency, route, status, ordered_by, notes
    ) VALUES (
      ${ctx.patientId}, ${ctx.encounterId}, ${ctx.hospitalId},
      ${payload.drug ?? payload.drug_name ?? ''}, ${payload.dose ?? ''},
      ${payload.freq ?? payload.frequency ?? ''}, ${payload.route ?? ''},
      'active', ${ctx.userId}, ${'from chart_update_proposal'}
    )
    RETURNING id
  `;
  return r[0].id;
}

async function applyLabResult(ctx: ApplyCtx, payload: any): Promise<string> {
  const r = await ctx.sql`
    INSERT INTO observations (
      patient_id, encounter_id, hospital_id, code, value, unit, observed_at, recorded_by, category
    ) VALUES (
      ${ctx.patientId}, ${ctx.encounterId}, ${ctx.hospitalId},
      ${payload.test_code ?? payload.test_name ?? ''},
      ${String(payload.value ?? '')}, ${payload.unit ?? ''},
      ${payload.date ?? 'now()'}, ${ctx.userId}, 'lab_external'
    )
    RETURNING id
  `;
  return r[0].id;
}

async function applyProcedure(ctx: ApplyCtx, payload: any): Promise<string> {
  const r = await ctx.sql`
    INSERT INTO procedures (
      patient_id, encounter_id, hospital_id, procedure_name, performed_at, performed_by, outcome
    ) VALUES (
      ${ctx.patientId}, ${ctx.encounterId}, ${ctx.hospitalId},
      ${payload.name ?? payload.procedure_name ?? ''},
      ${payload.date ?? null}, ${ctx.userId}, ${payload.outcome ?? 'historical'}
    )
    RETURNING id
  `;
  return r[0].id;
}

async function applyProblem(ctx: ApplyCtx, payload: any): Promise<string> {
  // Problem list entries are stored in `conditions` with clinical_status='active'
  return applyCondition(ctx, payload);
}

const APPLY: Record<string, (ctx: ApplyCtx, payload: any) => Promise<string>> = {
  condition: applyCondition,
  allergy: applyAllergy,
  medication: applyMedication,
  lab_result: applyLabResult,
  procedure: applyProcedure,
  problem: applyProblem,
};

export const chartProposalsRouter = router({
  // ─────────────────────────────────────────────────────────
  // 1. LIST PENDING
  // ─────────────────────────────────────────────────────────
  listPending: protectedProcedure
    .input(z.object({ patient_id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);
      const sql = getSql();
      const rows = await sql`
        SELECT id, patient_id, encounter_id, source_document, proposal_type,
               payload, confidence, extraction_notes, status, created_at
          FROM chart_update_proposals
         WHERE patient_id = ${input.patient_id}
           AND status = 'pending'
         ORDER BY created_at DESC
      `;
      return rows;
    }),

  // ─────────────────────────────────────────────────────────
  // 2. ACCEPT PROPOSAL
  // ─────────────────────────────────────────────────────────
  acceptProposal: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);
      const sql = getSql();

      const rows = await sql`
        SELECT id, hospital_id, patient_id, encounter_id, proposal_type, payload, status
          FROM chart_update_proposals
         WHERE id = ${input.id} LIMIT 1
      `;
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      const prop = rows[0];
      if (prop.status !== 'pending') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Already ${prop.status}` });
      }

      const handler = APPLY[prop.proposal_type];
      if (!handler) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown proposal_type ${prop.proposal_type}` });
      }

      const appliedRowId = await handler(
        {
          sql,
          hospitalId: prop.hospital_id,
          patientId: prop.patient_id,
          encounterId: prop.encounter_id ?? null,
          userId: ctx.user.sub,
        },
        prop.payload,
      );

      await sql`
        UPDATE chart_update_proposals
           SET status = 'accepted',
               reviewed_by = ${ctx.user.sub},
               reviewed_at = now(),
               applied_row_id = ${appliedRowId}
         WHERE id = ${input.id}
      `;

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'chart_update_proposals',
        row_id: input.id,
        new_values: { status: 'accepted', applied_row_id: appliedRowId, proposal_type: prop.proposal_type },
      });

      // N.5: Patient brief regen (uses debounced helper)
      {
        const triggerMap: Record<string, 'problem_list_change' | 'med_list_change' | 'new_lab' | 'new_note'> = {
          condition: 'problem_list_change', problem: 'problem_list_change',
          allergy: 'problem_list_change', medication: 'med_list_change',
          lab_result: 'new_lab', procedure: 'new_note',
        };
        void enqueueBriefRegenByText(sql as any, {
          hospitalTextId: ctx.user.hospital_id,
          patientId: prop.patient_id,
          trigger: triggerMap[prop.proposal_type] ?? 'manual',
        });
      }

      return { ok: true as const, applied_row_id: appliedRowId };
    }),

  // ─────────────────────────────────────────────────────────
  // 3. REJECT PROPOSAL
  // ─────────────────────────────────────────────────────────
  rejectProposal: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(3).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);
      const sql = getSql();
      await sql`
        UPDATE chart_update_proposals
           SET status = 'rejected',
               reviewed_by = ${ctx.user.sub},
               reviewed_at = now(),
               review_notes = ${input.reason}
         WHERE id = ${input.id} AND status = 'pending'
      `;
      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'chart_update_proposals',
        row_id: input.id,
        new_values: { status: 'rejected', review_notes: input.reason },
      });
      return { ok: true as const };
    }),

  // ─────────────────────────────────────────────────────────
  // 4. MODIFY AND ACCEPT
  // ─────────────────────────────────────────────────────────
  modifyAndAccept: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      patch: z.record(z.any()),
    }))
    .mutation(async ({ ctx, input }) => {
      assertDoctor(ctx.user.role);
      const sql = getSql();

      const rows = await sql`
        SELECT id, hospital_id, patient_id, encounter_id, proposal_type, payload, status
          FROM chart_update_proposals WHERE id = ${input.id} LIMIT 1
      `;
      if (rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      const prop = rows[0];
      if (prop.status !== 'pending') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Already ${prop.status}` });
      }

      const merged = { ...(prop.payload as Record<string, unknown>), ...input.patch };

      const handler = APPLY[prop.proposal_type];
      if (!handler) throw new TRPCError({ code: 'BAD_REQUEST' });
      const appliedRowId = await handler(
        { sql, hospitalId: prop.hospital_id, patientId: prop.patient_id, encounterId: prop.encounter_id ?? null, userId: ctx.user.sub },
        merged,
      );

      await sql`
        UPDATE chart_update_proposals
           SET status = 'modified',
               payload = ${JSON.stringify(merged)}::jsonb,
               reviewed_by = ${ctx.user.sub},
               reviewed_at = now(),
               applied_row_id = ${appliedRowId}
         WHERE id = ${input.id}
      `;

      await writeAuditLog(ctx.user, {
        action: 'UPDATE',
        table_name: 'chart_update_proposals',
        row_id: input.id,
        new_values: { status: 'modified', applied_row_id: appliedRowId, patch_keys: Object.keys(input.patch) },
      });

      return { ok: true as const, applied_row_id: appliedRowId };
    }),
});
