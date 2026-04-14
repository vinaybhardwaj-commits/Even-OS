import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc';
import { db } from '@/lib/db';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import {
  shiftHandoffs, patientAssignments, patients, encounters, users,
} from '@db/schema';
import { writeAuditLog } from '@/lib/audit/logger';
import { eq, and, sql, asc } from 'drizzle-orm';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ============================================================
// SHIFT HANDOFFS — NS.6
// Procedures: autoPopulate, write, read, wardSummary
// ============================================================

export const shiftHandoffsRouter = router({

  // ── Auto-populate patient summary for handoff ─────────────────────────

  autoPopulate: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      shift_instance_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Gather all data in parallel
      const [vitalsData, news2Data, medsData, ioData, assessData] = await Promise.all([
        // Vitals count this shift
        getSql()`
          SELECT COUNT(*)::int AS vitals_count
          FROM observations o
          WHERE o.hospital_id = ${hospitalId}
            AND o.patient_id = ${input.patient_id}::uuid
            AND o.encounter_id = ${input.encounter_id}::uuid
            AND o.recorded_at >= (
              SELECT si.start_time FROM shift_instances si WHERE si.id = ${input.shift_instance_id}::uuid
            )
        `,
        // Latest NEWS2 score
        getSql()`
          SELECT total_score, risk_level, calculated_at
          FROM news2_scores
          WHERE hospital_id = ${hospitalId}
            AND patient_id = ${input.patient_id}::uuid
          ORDER BY calculated_at DESC LIMIT 1
        `,
        // Med compliance: given / total scheduled today
        getSql()`
          SELECT
            COUNT(*) FILTER (WHERE ma.status = 'completed')::int AS given,
            COUNT(*)::int AS total
          FROM medication_administrations ma
          WHERE ma.hospital_id = ${hospitalId}
            AND ma.patient_id = ${input.patient_id}::uuid
            AND ma.scheduled_datetime::date = CURRENT_DATE
        `,
        // I/O balance today
        getSql()`
          SELECT
            COALESCE(SUM(CASE WHEN o.observation_type IN ('intake_oral','intake_iv','intake_other') THEN o.value_quantity ELSE 0 END), 0)::int AS total_intake,
            COALESCE(SUM(CASE WHEN o.observation_type IN ('output_urine','output_drain','output_other') THEN o.value_quantity ELSE 0 END), 0)::int AS total_output
          FROM observations o
          WHERE o.hospital_id = ${hospitalId}
            AND o.patient_id = ${input.patient_id}::uuid
            AND o.recorded_at::date = CURRENT_DATE
            AND o.observation_type LIKE 'intake_%' OR o.observation_type LIKE 'output_%'
        `,
        // Latest key assessments
        getSql()`
          SELECT
            na.assessment_data->>'_key' AS assess_key,
            na.assessment_data AS data,
            na.is_flagged,
            na.created_at
          FROM nursing_assessments na
          WHERE na.hospital_id = ${hospitalId}
            AND na.patient_id = ${input.patient_id}::uuid
          ORDER BY na.created_at DESC
          LIMIT 10
        `,
      ]);

      const vitalsCount = ((vitalsData as any)?.[0]?.vitals_count) || 0;
      const news2 = (news2Data as any)?.[0] || null;
      const meds = (medsData as any)?.[0] || { given: 0, total: 0 };
      const io = (ioData as any)?.[0] || { total_intake: 0, total_output: 0 };
      const assessments = ((assessData as any) || []);

      const medCompliance = meds.total > 0 ? Math.round((meds.given / meds.total) * 100) : 100;
      const ioBalance = io.total_intake - io.total_output;

      // Build auto-summary
      const lines: string[] = [];
      lines.push(`Vitals: ${vitalsCount} sets recorded this shift.`);
      if (news2) {
        lines.push(`NEWS2: ${news2.total_score} (${news2.risk_level}).`);
      }
      lines.push(`Meds: ${meds.given}/${meds.total} given (${medCompliance}% compliance).`);
      lines.push(`I/O: +${io.total_intake}ml / -${io.total_output}ml = ${ioBalance >= 0 ? '+' : ''}${ioBalance}ml.`);

      // Flagged assessments
      const flagged = assessments.filter((a: any) => a.is_flagged);
      if (flagged.length > 0) {
        lines.push(`⚠️ Flagged: ${flagged.map((f: any) => f.assess_key.replace(/_/g, ' ')).join(', ')}.`);
      }

      return {
        auto_summary: lines.join('\n'),
        vitals_count: vitalsCount,
        news2_score: news2?.total_score || null,
        news2_risk: news2?.risk_level || null,
        med_given: meds.given,
        med_total: meds.total,
        med_compliance: medCompliance,
        io_intake: io.total_intake,
        io_output: io.total_output,
        io_balance: ioBalance,
        flagged_assessments: flagged.map((f: any) => f.assess_key),
      };
    }),

  // ── Write / update handoff ────────────────────────────────────────────

  write: protectedProcedure
    .input(z.object({
      patient_id: z.string().uuid(),
      encounter_id: z.string().uuid(),
      outgoing_shift_id: z.string().uuid(),
      incoming_shift_id: z.string().uuid().optional(),
      situation: z.string().optional(),
      background: z.string().optional(),
      assessment: z.string().optional(),
      recommendation: z.string().optional(),
      priority: z.enum(['routine', 'watch', 'critical']).default('routine'),
      pending_tasks: z.array(z.object({
        task: z.string(),
        due_by: z.string().optional(),
        priority: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Upsert: unique on (outgoing_shift_id, patient_id)
      const existing = await db.select({ id: shiftHandoffs.id })
        .from(shiftHandoffs)
        .where(and(
          eq(shiftHandoffs.hospital_id, hospitalId),
          eq(shiftHandoffs.outgoing_shift_id, input.outgoing_shift_id),
          eq(shiftHandoffs.patient_id, input.patient_id),
        ))
        .limit(1);

      if (existing.length > 0) {
        await db.update(shiftHandoffs).set({
          situation: input.situation || null,
          background: input.background || null,
          assessment: input.assessment || null,
          recommendation: input.recommendation || null,
          priority: input.priority,
          status: 'submitted',
          pending_tasks: input.pending_tasks ? JSON.stringify(input.pending_tasks) : null,
          updated_at: new Date(),
        }).where(eq(shiftHandoffs.id, existing[0].id));

        await writeAuditLog(ctx.user, {
          action: 'UPDATE',
          table_name: 'shift_handoffs',
          row_id: existing[0].id,
          new_values: { priority: input.priority, status: 'submitted' },
          reason: 'Handoff updated',
        });

        return { id: existing[0].id, updated: true };
      }

      const [handoff] = await db.insert(shiftHandoffs).values({
        hospital_id: hospitalId,
        patient_id: input.patient_id,
        encounter_id: input.encounter_id,
        outgoing_shift_id: input.outgoing_shift_id,
        incoming_shift_id: input.incoming_shift_id || null,
        outgoing_nurse_id: ctx.user.sub,
        situation: input.situation || null,
        background: input.background || null,
        assessment: input.assessment || null,
        recommendation: input.recommendation || null,
        priority: input.priority,
        status: 'submitted',
        pending_tasks: input.pending_tasks ? JSON.stringify(input.pending_tasks) : null,
      }).returning();

      await writeAuditLog(ctx.user, {
        action: 'INSERT',
        table_name: 'shift_handoffs',
        row_id: handoff.id,
        new_values: { patient_id: input.patient_id, priority: input.priority },
        reason: 'Handoff submitted',
      });

      return { id: handoff.id, updated: false };
    }),

  // ── Read handoffs for incoming shift ──────────────────────────────────

  read: protectedProcedure
    .input(z.object({
      shift_instance_id: z.string().uuid(),
      direction: z.enum(['incoming', 'outgoing']).default('incoming'),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;
      const shiftField = input.direction === 'incoming'
        ? shiftHandoffs.outgoing_shift_id  // Incoming nurse reads outgoing shift's handoffs
        : shiftHandoffs.outgoing_shift_id; // Outgoing nurse reads their own shift's handoffs

      const rows = await db.select({
        handoff: shiftHandoffs,
        patient_name: sql<string>`${patients.name_given} || ' ' || COALESCE(${patients.name_family}, '')`.as('patient_name'),
        patient_uhid: patients.uhid,
        patient_gender: patients.gender,
        patient_dob: patients.dob,
        nurse_name: users.full_name,
        bed_label: sql<string>`(
          SELECT pa.bed_label FROM patient_assignments pa
          WHERE pa.patient_id = ${shiftHandoffs.patient_id}
            AND pa.status = 'active'
          ORDER BY pa.assigned_at DESC LIMIT 1
        )`.as('bed_label'),
      })
        .from(shiftHandoffs)
        .innerJoin(patients, eq(shiftHandoffs.patient_id, patients.id))
        .innerJoin(users, eq(shiftHandoffs.outgoing_nurse_id, users.id))
        .where(and(
          eq(shiftHandoffs.hospital_id, hospitalId),
          eq(shiftField, input.shift_instance_id),
        ))
        .orderBy(
          sql`CASE ${shiftHandoffs.priority} WHEN 'critical' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END`,
          asc(shiftHandoffs.created_at),
        );

      return rows;
    }),

  // ── Ward summary for charge nurse huddle ──────────────────────────────

  wardSummary: protectedProcedure
    .input(z.object({
      shift_instance_id: z.string().uuid(),
      ward_id: z.string().uuid(),
    }))
    .query(async ({ ctx, input }) => {
      const hospitalId = ctx.user.hospital_id;

      // Count totals
      const [stats] = await getSql()`
        SELECT
          (SELECT COUNT(*)::int FROM patient_assignments
           WHERE hospital_id = ${hospitalId} AND shift_instance_id = ${input.shift_instance_id}::uuid AND status = 'active'
          ) AS total_patients,
          (SELECT COUNT(*)::int FROM shift_handoffs
           WHERE hospital_id = ${hospitalId} AND outgoing_shift_id = ${input.shift_instance_id}::uuid AND status = 'submitted'
          ) AS handoffs_submitted,
          (SELECT COUNT(*)::int FROM shift_handoffs
           WHERE hospital_id = ${hospitalId} AND outgoing_shift_id = ${input.shift_instance_id}::uuid AND priority = 'critical'
          ) AS critical_count,
          (SELECT COUNT(*)::int FROM shift_handoffs
           WHERE hospital_id = ${hospitalId} AND outgoing_shift_id = ${input.shift_instance_id}::uuid AND priority = 'watch'
          ) AS watch_count
      ` as any;

      // Get nurse-level summary
      const nurseSummary = await getSql()`
        SELECT
          u.full_name AS nurse_name,
          COUNT(sh.id)::int AS handoff_count,
          COUNT(*) FILTER (WHERE sh.priority = 'critical')::int AS critical,
          COUNT(*) FILTER (WHERE sh.priority = 'watch')::int AS watch
        FROM shift_handoffs sh
        JOIN users u ON u.id = sh.outgoing_nurse_id
        WHERE sh.hospital_id = ${hospitalId}
          AND sh.outgoing_shift_id = ${input.shift_instance_id}::uuid
        GROUP BY u.full_name
        ORDER BY critical DESC, watch DESC
      ` as any;

      return {
        total_patients: stats?.total_patients || 0,
        handoffs_submitted: stats?.handoffs_submitted || 0,
        critical_count: stats?.critical_count || 0,
        watch_count: stats?.watch_count || 0,
        pending: (stats?.total_patients || 0) - (stats?.handoffs_submitted || 0),
        nurse_summary: nurseSummary || [],
      };
    }),
});
