/**
 * Discharge Journey — DC.1
 *
 * Wires discharge workflow to journey engine steps 8.1–8.8:
 *
 * 8.1 Discharge Planning Initiation (visiting_consultant)
 * 8.2 Discharge Order (visiting_consultant) — TRIGGER: creates Phase 8 steps
 * 8.3 Discharge Summary Preparation (resident)
 * 8.4 Final Bill & Settlement (billing_manager)
 * 8.5 Discharge Medications Dispensed (pharmacist)
 * 8.6 Nursing Discharge Education (nurse)
 * 8.7 Patient Exit & Report Handover (ip_coordinator)
 * 8.8 Terminal Cleaning (housekeeping_supervisor) — auto-triggered by 8.7
 *
 * Phase 9 (Billing Closure) is handled separately in DC.2.
 */

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

// ── Discharge step definitions ──────────────────────────────────────────────
export const DISCHARGE_STEPS = [
  { num: '8.1', name: 'Discharge Planning', role: 'visiting_consultant', icon: '📋', tat: 2880 },
  { num: '8.2', name: 'Discharge Order', role: 'visiting_consultant', icon: '📝', tat: 60 },
  { num: '8.3', name: 'DC Summary', role: 'resident', icon: '📄', tat: 120 },
  { num: '8.4', name: 'Final Bill', role: 'billing_manager', icon: '💰', tat: 240 },
  { num: '8.5', name: 'Medications', role: 'pharmacist', icon: '💊', tat: 60 },
  { num: '8.6', name: 'Patient Education', role: 'nurse', icon: '🎓', tat: 30 },
  { num: '8.7', name: 'Patient Exit', role: 'ip_coordinator', icon: '🚪', tat: 15 },
  { num: '8.8', name: 'Terminal Cleaning', role: 'housekeeping_supervisor', icon: '🧹', tat: 30 },
] as const;

export interface DischargeStepStatus {
  step_number: string;
  step_name: string;
  icon: string;
  owner_role: string;
  status: 'completed' | 'in_progress' | 'pending' | 'not_started';
  started_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  step_id: string | null;
  elapsed_mins: number;
  tat_target_mins: number;
  is_overdue: boolean;
}

/**
 * Get full discharge checklist status for a patient.
 * Returns all 8 steps with their current status from the journey engine.
 */
export async function getDischargeChecklist(
  hospitalId: string,
  patientId: string,
  encounterId?: string
): Promise<DischargeStepStatus[]> {
  const conditions = [
    sql`hospital_id = ${hospitalId}`,
    sql`patient_id = ${patientId}`,
    sql`step_number IN ('8.1','8.2','8.3','8.4','8.5','8.6','8.7','8.8')`,
  ];
  if (encounterId) {
    conditions.push(sql`encounter_id = ${encounterId}`);
  }

  const rows = await db.execute(
    sql`SELECT id, step_number, step_name, status, owner_role,
               started_at, completed_at, completed_by_id
        FROM patient_journey_steps
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY step_number`
  );

  const stepMap = new Map<string, any>();
  for (const row of (rows as unknown as any[]) || []) {
    stepMap.set(row.step_number, row);
  }

  return DISCHARGE_STEPS.map(def => {
    const dbRow = stepMap.get(def.num);
    const startedAt = dbRow?.started_at ? new Date(dbRow.started_at) : null;
    const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 60000) : 0;

    return {
      step_number: def.num,
      step_name: def.name,
      icon: def.icon,
      owner_role: def.role,
      status: dbRow
        ? (dbRow.status === 'completed' ? 'completed'
          : dbRow.status === 'in_progress' ? 'in_progress'
          : 'pending')
        : 'not_started',
      started_at: dbRow?.started_at || null,
      completed_at: dbRow?.completed_at || null,
      completed_by: dbRow?.completed_by_id || null,
      step_id: dbRow?.id || null,
      elapsed_mins: elapsed,
      tat_target_mins: def.tat,
      is_overdue: elapsed > def.tat,
    };
  });
}

/**
 * Check if the discharge journey has been initiated for a patient
 * (i.e., Phase 8 steps exist in the journey).
 */
export async function isDischargeInitiated(
  hospitalId: string,
  patientId: string
): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT COUNT(*)::int as count FROM patient_journey_steps
        WHERE hospital_id = ${hospitalId}
          AND patient_id = ${patientId}
          AND phase = 'PHASE_8_DISCHARGE'`
  );
  return ((rows as unknown as any[])?.[0]?.count || 0) > 0;
}

/**
 * After step 8.7 (Patient Exit) completes, auto-trigger step 8.8
 * (Terminal Cleaning) by setting its status to 'in_progress'.
 * Also sends a notification to housekeeping.
 */
export async function onPatientExitComplete(
  hospitalId: string,
  patientId: string,
  encounterId: string
): Promise<void> {
  // Find step 8.8 for this patient
  const rows = await db.execute(
    sql`SELECT id FROM patient_journey_steps
        WHERE hospital_id = ${hospitalId}
          AND patient_id = ${patientId}
          AND step_number = '8.8'
          AND status != 'completed'
        LIMIT 1`
  );

  const step88 = (rows as unknown as any[])?.[0];
  if (!step88) return;

  // Auto-start step 8.8
  await db.execute(
    sql`UPDATE patient_journey_steps
        SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
        WHERE id = ${step88.id}`
  );

  // Get patient info for notification
  const patientRows = await db.execute(
    sql`SELECT name_given, name_family, uhid FROM patients
        WHERE id = ${patientId} AND hospital_id = ${hospitalId}
        LIMIT 1`
  );
  const patient = (patientRows as unknown as any[])?.[0];
  const patientName = patient
    ? `${patient.name_given || ''} ${patient.name_family || ''}`.trim()
    : 'Patient';

  // Look up bed for the notification
  const bedRows = await db.execute(
    sql`SELECT bed_label FROM encounters
        WHERE id = ${encounterId} AND hospital_id = ${hospitalId}
        LIMIT 1`
  );
  const bed = (bedRows as unknown as any[])?.[0]?.bed_label || 'Unknown bed';

  // Notify housekeeping
  await db.execute(
    sql`INSERT INTO journey_notifications
        (hospital_id, patient_id, encounter_id, step_number, step_name,
         recipient_role, title, body, channel, is_read, created_at)
        VALUES (
          ${hospitalId}, ${patientId}, ${encounterId}, '8.8', 'Terminal Cleaning',
          'housekeeping_supervisor',
          ${'🧹 Terminal Cleaning Required'},
          ${`${patientName} has exited from ${bed}. Terminal cleaning per IPC protocol required before next admission.`},
          'in_app', false, NOW()
        )`
  );
}

/**
 * Get discharge progress summary for display (e.g., in patient chart header).
 */
export function getDischargeProgress(steps: DischargeStepStatus[]): {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  pct: number;
} {
  const total = steps.length;
  const completed = steps.filter(s => s.status === 'completed').length;
  const inProgress = steps.filter(s => s.status === 'in_progress').length;
  const overdue = steps.filter(s => s.is_overdue && s.status !== 'completed').length;
  return { total, completed, inProgress, overdue, pct: Math.round((completed / total) * 100) };
}
