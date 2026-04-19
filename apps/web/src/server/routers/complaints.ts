/**
 * Patient Chart Overhaul — PC.4.A.4 — complaints tRPC router
 *
 * Native patient-scoped complaints raised from inside the chart. See
 * 58-patient-complaints.ts for the shape decisions and V's locked Path-A
 * decision (19 Apr 2026).
 *
 * Endpoints:
 *   - listByPatient(patient_id, include_closed?) → Complaint[]
 *       Used by: OverviewComplaintsCard, chart header SLA badge, CCE view.
 *       Default: open + in_progress only. `include_closed:true` returns all.
 *   - countOpenByPatient(patient_id) → { open, breached, at_risk }
 *       Used by: header SLA badge. Tiny, cheap. Re-polled on chart mount.
 *   - getById(id) → Complaint | null
 *       Used by: RaiseComplaintModal / detail drawer.
 *   - raise({ patient_id, encounter_id?, category, priority, subject, description })
 *       Inserts. sla_due_at computed from priority→hours map.
 *       Snapshot raise-by name/role from ctx.user.
 *   - updateStatus({ id, status, resolution_note? })
 *       Transitions the row. When status ∈ { 'resolved', 'closed' } the
 *       router requires `resolution_note` (non-empty, trimmed) and fills
 *       the resolution snapshot from ctx.user.
 *
 * Raw SQL via the Neon HTTP driver — consistent with chart-locks, chat,
 * notes-v2 routers.
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

// ── SLA → hours map (locked here; change without migration) ────────────────
const PRIORITY_SLA_HOURS: Record<'low'|'normal'|'high'|'critical', number> = {
  critical: 1,
  high: 4,
  normal: 24,
  low: 72,
};

// ── Zod input schemas ──────────────────────────────────────────────────────
const priorityEnum = z.enum(['low', 'normal', 'high', 'critical']);
const statusEnum = z.enum(['open', 'in_progress', 'resolved', 'closed']);
const uuidSchema = z.string().uuid();

// ── Row shape (returned to clients, DB snake_case preserved) ───────────────
export interface ComplaintRow {
  id: string;
  hospital_id: string;
  patient_id: string;
  encounter_id: string | null;
  category: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  subject: string;
  description: string;
  sla_due_at: string;
  raised_by_user_id: string;
  raised_by_user_name: string;
  raised_by_user_role: string;
  resolved_by_user_id: string | null;
  resolved_by_user_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export const complaintsRouter = router({
  // ─── listByPatient ────────────────────────────────────────────────
  listByPatient: protectedProcedure
    .input(z.object({
      patient_id: uuidSchema,
      include_closed: z.boolean().optional().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const rows = input.include_closed
        ? (await sql`
            SELECT * FROM patient_complaints
            WHERE hospital_id = ${hospitalId}
              AND patient_id  = ${input.patient_id}
            ORDER BY
              CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1
                          WHEN 'resolved' THEN 2 ELSE 3 END,
              sla_due_at ASC, created_at DESC
          `) as ComplaintRow[]
        : (await sql`
            SELECT * FROM patient_complaints
            WHERE hospital_id = ${hospitalId}
              AND patient_id  = ${input.patient_id}
              AND status IN ('open','in_progress')
            ORDER BY sla_due_at ASC, created_at DESC
          `) as ComplaintRow[];
      return rows;
    }),

  // ─── countOpenByPatient ───────────────────────────────────────────
  // Breach: now() > sla_due_at, status ∈ (open,in_progress)
  // At-risk: within 1h of sla_due_at, not yet breached, status ∈ (open,in_progress)
  countOpenByPatient: protectedProcedure
    .input(z.object({ patient_id: uuidSchema }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const [row] = (await sql`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open,
          COUNT(*) FILTER (
            WHERE status IN ('open','in_progress') AND now() > sla_due_at
          )::int AS breached,
          COUNT(*) FILTER (
            WHERE status IN ('open','in_progress')
              AND now() <= sla_due_at
              AND sla_due_at - now() <= interval '1 hour'
          )::int AS at_risk
        FROM patient_complaints
        WHERE hospital_id = ${hospitalId}
          AND patient_id  = ${input.patient_id}
      `) as Array<{ open: number; breached: number; at_risk: number }>;
      return row ?? { open: 0, breached: 0, at_risk: 0 };
    }),

  // ─── getById ──────────────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: uuidSchema }))
    .query(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.effectiveUser?.hospital_id ?? ctx.user.hospital_id;
      const [row] = (await sql`
        SELECT * FROM patient_complaints
        WHERE id = ${input.id} AND hospital_id = ${hospitalId}
      `) as ComplaintRow[];
      return row ?? null;
    }),

  // ─── raise ────────────────────────────────────────────────────────
  raise: protectedProcedure
    .input(z.object({
      patient_id:   uuidSchema,
      encounter_id: uuidSchema.nullable().optional(),
      category:     z.string().trim().min(1).max(100),
      priority:     priorityEnum.optional().default('normal'),
      subject:      z.string().trim().min(3).max(200),
      description:  z.string().trim().min(3).max(4000),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;
      const slaHours = PRIORITY_SLA_HOURS[input.priority];

      const [row] = (await sql`
        INSERT INTO patient_complaints (
          hospital_id, patient_id, encounter_id,
          category, priority, status,
          subject, description,
          sla_due_at,
          raised_by_user_id, raised_by_user_name, raised_by_user_role
        ) VALUES (
          ${hospitalId},
          ${input.patient_id},
          ${input.encounter_id ?? null},
          ${input.category},
          ${input.priority}::pc_complaint_priority,
          'open'::pc_complaint_status,
          ${input.subject},
          ${input.description},
          now() + (${slaHours} * interval '1 hour'),
          ${ctx.user.sub}::uuid,
          ${ctx.user.name},
          ${ctx.user.role}
        )
        RETURNING *
      `) as ComplaintRow[];

      if (!row) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create complaint',
        });
      }
      return row;
    }),

  // ─── updateStatus ─────────────────────────────────────────────────
  updateStatus: protectedProcedure
    .input(z.object({
      id: uuidSchema,
      status: statusEnum,
      resolution_note: z.string().trim().max(4000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sql = getSql();
      const hospitalId = ctx.user.hospital_id;

      // Resolution note required when closing the loop.
      if ((input.status === 'resolved' || input.status === 'closed')
          && (!input.resolution_note || input.resolution_note.length === 0)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'resolution_note is required when resolving or closing a complaint',
        });
      }

      // Existence + tenant check.
      const [existing] = (await sql`
        SELECT id FROM patient_complaints
        WHERE id = ${input.id} AND hospital_id = ${hospitalId}
      `) as Array<{ id: string }>;
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Complaint not found' });
      }

      const fillResolution = input.status === 'resolved' || input.status === 'closed';

      if (fillResolution) {
        const [row] = (await sql`
          UPDATE patient_complaints SET
            status = ${input.status}::pc_complaint_status,
            resolution_note = ${input.resolution_note ?? null},
            resolved_by_user_id = ${ctx.user.sub}::uuid,
            resolved_by_user_name = ${ctx.user.name},
            resolved_at = now(),
            updated_at = now()
          WHERE id = ${input.id} AND hospital_id = ${hospitalId}
          RETURNING *
        `) as ComplaintRow[];
        return row;
      } else {
        // Transition back toward open/in_progress — clear resolution snapshot.
        const [row] = (await sql`
          UPDATE patient_complaints SET
            status = ${input.status}::pc_complaint_status,
            resolution_note = NULL,
            resolved_by_user_id = NULL,
            resolved_by_user_name = NULL,
            resolved_at = NULL,
            updated_at = now()
          WHERE id = ${input.id} AND hospital_id = ${hospitalId}
          RETURNING *
        `) as ComplaintRow[];
        return row;
      }
    }),
});
