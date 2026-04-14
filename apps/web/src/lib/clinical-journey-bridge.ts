/**
 * Clinical Journey Bridge — AP.4
 *
 * Wires journey step completions to clinical systems:
 *
 * 1. Step 2.7 (Ward Intimation) → Creates a journey notification
 *    for the charge_nurse role: "New patient arriving — assign nurse."
 *    Charge nurse sees this in their pending journey steps.
 *
 * 2. Step 3.2 (Medical Initial Assessment) → Doctor "New Admits" count
 *    reads from journey engine (pending step 3.2 for the doctor's role).
 *
 * 3. Steps 4.1–4.5 → Pre-op readiness traffic light on OT board.
 *    Each step maps to a readiness indicator.
 *
 * Usage: Server-side utility called after completeStep, or queried
 * from client components via tRPC.
 */

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

// ── Pre-op readiness mapping ────────────────────────────────────────────────
// Maps journey step numbers to pre-op traffic light indicators
export const PREOP_STEP_MAP: Record<string, string> = {
  '4.1': 'investigations_complete',   // Pre-Op Investigations
  '4.2': 'pac_clearance',             // PAC Clearance & Fitness
  '4.3': 'financial_clearance',       // Surgical Financial Clearance
  '4.4': 'preop_checklist',           // Pre-Op Checklist Completion
  '4.5': 'ot_case_confirmed',         // OT Case List Confirmation
};

/**
 * Get pre-op readiness status for a patient's encounter by checking
 * journey steps 4.1–4.5.
 */
export async function getPreOpReadiness(
  hospitalId: string,
  patientId: string,
  encounterId?: string
): Promise<Record<string, 'complete' | 'in_progress' | 'pending' | 'not_started'>> {
  const conditions = [
    sql`hospital_id = ${hospitalId}`,
    sql`patient_id = ${patientId}`,
    sql`step_number IN ('4.1', '4.2', '4.3', '4.4', '4.5')`,
  ];
  if (encounterId) {
    conditions.push(sql`encounter_id = ${encounterId}`);
  }

  const rows = await db.execute(
    sql`SELECT step_number, status FROM patient_journey_steps
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY step_number`
  );

  const result: Record<string, 'complete' | 'in_progress' | 'pending' | 'not_started'> = {
    investigations_complete: 'not_started',
    pac_clearance: 'not_started',
    financial_clearance: 'not_started',
    preop_checklist: 'not_started',
    ot_case_confirmed: 'not_started',
  };

  for (const row of (rows as unknown as any[]) || []) {
    const indicator = PREOP_STEP_MAP[row.step_number];
    if (indicator) {
      result[indicator] = row.status === 'completed' ? 'complete'
        : row.status === 'in_progress' ? 'in_progress'
        : 'pending';
    }
  }

  return result;
}

/**
 * Count patients with pending step 3.2 (Medical Initial Assessment)
 * for a given doctor role. Used by doctor dashboard "New Admits" count.
 */
export async function getNewAdmitsCount(
  hospitalId: string,
  userId: string,
  userRole: string
): Promise<number> {
  const rows = await db.execute(
    sql`SELECT COUNT(*)::int as count FROM patient_journey_steps
        WHERE hospital_id = ${hospitalId}
          AND step_number = '3.2'
          AND status IN ('pending', 'in_progress')
          AND (owner_user_id = ${userId} OR owner_role = ${userRole})`
  );
  return (rows as unknown as any[])?.[0]?.count || 0;
}

/**
 * After step 2.7 (Ward Intimation) completes, create a journey
 * notification for the charge_nurse role so they know to assign
 * a nurse to the incoming patient.
 *
 * Uses the existing journey_notifications table — no schema changes.
 */
export async function onWardIntimationComplete(
  hospitalId: string,
  patientId: string,
  encounterId: string,
  completedBy: string
): Promise<void> {
  // Look up patient name for the notification
  const patientRows = await db.execute(
    sql`SELECT name_given, name_family, uhid FROM patients
        WHERE id = ${patientId} AND hospital_id = ${hospitalId}
        LIMIT 1`
  );
  const patient = (patientRows as unknown as any[])?.[0];
  const patientName = patient
    ? `${patient.name_given || ''} ${patient.name_family || ''}`.trim()
    : 'New patient';
  const uhid = patient?.uhid || '';

  // Insert a notification for charge_nurse role
  await db.execute(
    sql`INSERT INTO journey_notifications
        (hospital_id, patient_id, encounter_id, step_number, step_name,
         recipient_role, title, body, channel, is_read, created_at)
        VALUES (
          ${hospitalId}, ${patientId}, ${encounterId}, '2.7', 'Ward Intimation',
          'charge_nurse',
          ${'🆕 New Patient Arriving — Assign Nurse'},
          ${`${patientName} (${uhid}) has been admitted and is being transported to the ward. Please assign a nurse for bedside care.`},
          'in_app', false, NOW()
        )`
  );
}
