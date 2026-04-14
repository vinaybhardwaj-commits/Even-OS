/**
 * Billing Closure — DC.2
 *
 * Phase 9 steps (9.1–9.3) — final billing, MRD, and follow-up.
 * When all Phase 9 steps complete, the journey is marked COMPLETE.
 *
 * 9.1 TPA Claims Submission (billing_manager, TAT 72h)
 * 9.2 Medical Records Closure (staff, TAT 24h)
 * 9.3 Follow-Up Appointment Booking (receptionist, TAT 24h)
 */

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

// ── Phase 9 step definitions ────────────────────────────────────────────────
export const CLOSURE_STEPS = [
  { num: '9.1', name: 'TPA Claims Submission', role: 'billing_manager', icon: '📤', tat: 4320, desc: 'Compile claims package (final bill, DC summary, reports, pre-auth). Submit to TPA within TAT.' },
  { num: '9.2', name: 'Medical Records Closure', role: 'staff', icon: '📁', tat: 1440, desc: 'Complete IP file compiled and archived. ICD-10 coded. Retention policy applied.' },
  { num: '9.3', name: 'Follow-Up Booking', role: 'receptionist', icon: '📅', tat: 1440, desc: 'Follow-up booked before exit or within 24 hrs. OPD team notified.' },
] as const;

/**
 * Check if all journey steps (Phase 1–9) are complete for a patient.
 * If so, mark the journey as COMPLETE by updating the patient's
 * journey tracking columns.
 */
export async function checkAndCompleteJourney(
  hospitalId: string,
  patientId: string
): Promise<boolean> {
  // Count incomplete steps
  const rows = await db.execute(
    sql`SELECT COUNT(*)::int as incomplete FROM patient_journey_steps
        WHERE hospital_id = ${hospitalId}
          AND patient_id = ${patientId}
          AND status != 'completed'`
  );

  const incomplete = (rows as unknown as any[])?.[0]?.incomplete || 0;
  if (incomplete > 0) return false;

  // All steps complete — update patient journey tracking
  await db.execute(
    sql`UPDATE patients
        SET journey_current_phase = 'COMPLETE',
            journey_current_step = 'COMPLETE',
            updated_at = NOW()
        WHERE id = ${patientId}
          AND hospital_id = ${hospitalId}`
  );

  return true;
}

/**
 * Get closure step statuses for a patient (Phase 9).
 */
export async function getClosureChecklist(
  hospitalId: string,
  patientId: string
): Promise<Array<{
  step_number: string;
  step_name: string;
  icon: string;
  owner_role: string;
  desc: string;
  status: string;
  step_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  elapsed_mins: number;
  tat_target_mins: number;
  is_overdue: boolean;
}>> {
  const rows = await db.execute(
    sql`SELECT id, step_number, status, started_at, completed_at
        FROM patient_journey_steps
        WHERE hospital_id = ${hospitalId}
          AND patient_id = ${patientId}
          AND step_number IN ('9.1', '9.2', '9.3')
        ORDER BY step_number`
  );

  const stepMap = new Map<string, any>();
  for (const row of (rows as unknown as any[]) || []) {
    stepMap.set(row.step_number, row);
  }

  return CLOSURE_STEPS.map(def => {
    const dbRow = stepMap.get(def.num);
    const startedAt = dbRow?.started_at ? new Date(dbRow.started_at) : null;
    const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 60000) : 0;

    return {
      step_number: def.num,
      step_name: def.name,
      icon: def.icon,
      owner_role: def.role,
      desc: def.desc,
      status: dbRow?.status || 'not_started',
      step_id: dbRow?.id || null,
      started_at: dbRow?.started_at || null,
      completed_at: dbRow?.completed_at || null,
      elapsed_mins: elapsed,
      tat_target_mins: def.tat,
      is_overdue: dbRow?.status !== 'completed' && elapsed > def.tat,
    };
  });
}
