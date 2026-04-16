/**
 * Auto-Events Engine — OC.4b
 *
 * Posts clinical activity into patient chat channels as system messages.
 * Called fire-and-forget from tRPC router mutations.
 *
 * Events covered:
 *  - Vitals recorded (with NEWS2 score if present)
 *  - Medication order created
 *  - Medication administered (eMAR)
 *  - Clinical note saved (SOAP / Nursing / Operative)
 *  - Lab order placed
 *  - Lab results verified
 *  - Diet order created
 *  - Nursing order created
 */

import { neon } from '@neondatabase/serverless';

function getSql() {
  return neon(process.env.DATABASE_URL!);
}

// ── HELPER: post into patient channel ──────────────────────

async function postAutoEvent(encounter_id: string, hospital_id: string, content: string) {
  const sql = getSql();
  const channelId = `patient-${encounter_id}`;

  try {
    const [channel] = await sql`
      SELECT id FROM chat_channels
      WHERE channel_id = ${channelId} AND is_archived = false
    `;
    if (!channel) return; // No active channel — skip silently

    await sql`
      INSERT INTO chat_messages (channel_id, hospital_id, message_type, content)
      VALUES (${channel.id}, ${hospital_id}, 'system', ${content})
    `;
    await sql`
      UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
      WHERE id = ${channel.id}
    `;
  } catch (err) {
    console.error('[auto-events] postAutoEvent failed:', err);
  }
}

// ── VITALS ─────────────────────────────────────────────────

interface VitalsEventParams {
  encounter_id: string;
  hospital_id: string;
  vitals_summary: string; // e.g. "BP 120/80, HR 72, SpO2 98%, Temp 98.6°F"
  news2_score?: number | null;
  news2_risk?: string | null; // 'low' | 'low-medium' | 'medium' | 'high'
  recorded_by?: string;
}

export function onVitalsRecorded(params: VitalsEventParams) {
  const news2 = params.news2_score != null
    ? ` | NEWS2: ${params.news2_score} (${params.news2_risk || 'unknown'})`
    : '';
  const by = params.recorded_by ? ` — ${params.recorded_by}` : '';
  return postAutoEvent(
    params.encounter_id,
    params.hospital_id,
    `📊 Vitals recorded: ${params.vitals_summary}${news2}${by}`
  );
}

// ── MEDICATION ORDER ───────────────────────────────────────

interface MedOrderEventParams {
  encounter_id: string;
  hospital_id: string;
  drug_name: string;
  dose_quantity?: string | number | null;
  dose_unit?: string | null;
  route?: string | null;
  frequency_code?: string | null;
  is_high_alert?: boolean;
  ordered_by?: string;
}

export function onMedicationOrdered(params: MedOrderEventParams) {
  const dose = params.dose_quantity ? ` ${params.dose_quantity}${params.dose_unit || ''}` : '';
  const route = params.route ? ` ${params.route}` : '';
  const freq = params.frequency_code ? ` (${params.frequency_code})` : '';
  const alert = params.is_high_alert ? ' ⚠️ HIGH-ALERT' : '';
  const by = params.ordered_by ? ` — ${params.ordered_by}` : '';
  return postAutoEvent(
    params.encounter_id,
    params.hospital_id,
    `💊 Medication ordered: ${params.drug_name}${dose}${route}${freq}${alert}${by}`
  );
}

// ── eMAR (ADMINISTRATION) ──────────────────────────────────

interface MedAdminEventParams {
  encounter_id: string;
  hospital_id: string;
  drug_name?: string;
  dose_given?: string | number | null;
  dose_unit?: string | null;
  status: string; // completed | not_done | held
  administered_by?: string;
}

export function onMedicationAdministered(params: MedAdminEventParams) {
  const drug = params.drug_name || 'medication';
  const dose = params.dose_given ? ` ${params.dose_given}${params.dose_unit || ''}` : '';
  let icon = '💉';
  let verb = 'administered';
  if (params.status === 'not_done') { icon = '⛔'; verb = 'not given'; }
  else if (params.status === 'held') { icon = '⏸️'; verb = 'held'; }
  const by = params.administered_by ? ` — ${params.administered_by}` : '';
  return postAutoEvent(
    params.encounter_id,
    params.hospital_id,
    `${icon} Medication ${verb}: ${drug}${dose}${by}`
  );
}

// ── CLINICAL NOTE ──────────────────────────────────────────

interface ClinicalNoteEventParams {
  encounter_id: string;
  hospital_id: string;
  note_type: 'SOAP' | 'Nursing' | 'Operative';
  author_name?: string;
}

export function onClinicalNoteSaved(params: ClinicalNoteEventParams) {
  const by = params.author_name ? ` by ${params.author_name}` : '';
  return postAutoEvent(
    params.encounter_id,
    params.hospital_id,
    `📝 ${params.note_type} note saved${by}`
  );
}

// ── LAB ORDER ──────────────────────────────────────────────

interface LabOrderEventParams {
  encounter_id: string;
  hospital_id: string;
  panel_name: string;
  urgency?: string;
  ordered_by?: string;
}

export function onLabOrdered(params: LabOrderEventParams) {
  const urgency = params.urgency && params.urgency !== 'routine'
    ? ` [${params.urgency.toUpperCase()}]`
    : '';
  const by = params.ordered_by ? ` — ${params.ordered_by}` : '';
  return postAutoEvent(
    params.encounter_id,
    params.hospital_id,
    `🧪 Lab ordered: ${params.panel_name}${urgency}${by}`
  );
}

// ── LAB RESULTS VERIFIED ───────────────────────────────────

interface LabVerifiedEventParams {
  encounter_id: string;
  hospital_id: string;
  panel_name?: string;
  tat_minutes?: number;
  verified_by?: string;
}

export function onLabResultsVerified(params: LabVerifiedEventParams) {
  const panel = params.panel_name || 'lab results';
  const tat = params.tat_minutes ? ` (TAT: ${params.tat_minutes}m)` : '';
  const by = params.verified_by ? ` — ${params.verified_by}` : '';
  return postAutoEvent(
    params.encounter_id,
    params.hospital_id,
    `✅ Results verified: ${panel}${tat}${by}`
  );
}

// ── DIET ORDER ─────────────────────────────────────────────

interface DietOrderEventParams {
  encounter_id: string;
  hospital_id: string;
  diet_type: string;
  restrictions?: string | null;
  ordered_by?: string;
}

export function onDietOrdered(params: DietOrderEventParams) {
  const restrictions = params.restrictions ? ` (${params.restrictions})` : '';
  const by = params.ordered_by ? ` — ${params.ordered_by}` : '';
  return postAutoEvent(
    params.encounter_id,
    params.hospital_id,
    `🍽️ Diet order: ${params.diet_type}${restrictions}${by}`
  );
}

// ── NURSING ORDER ──────────────────────────────────────────

interface NursingOrderEventParams {
  encounter_id: string;
  hospital_id: string;
  task_type: string;
  description?: string | null;
  ordered_by?: string;
}

export function onNursingOrderCreated(params: NursingOrderEventParams) {
  const desc = params.description ? `: ${params.description}` : '';
  const by = params.ordered_by ? ` — ${params.ordered_by}` : '';
  return postAutoEvent(
    params.encounter_id,
    params.hospital_id,
    `🩺 Nursing order (${params.task_type})${desc}${by}`
  );
}
