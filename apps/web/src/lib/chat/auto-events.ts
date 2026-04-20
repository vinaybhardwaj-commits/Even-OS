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
import { logAudit } from './audit';
import { notifyChatMessage } from './chat-event-bus';

function getSql() {
  return neon(process.env.DATABASE_URL!);
}

// ── HELPER: post into patient channel ──────────────────────

interface AutoEventAudit {
  action: string;
  details?: Record<string, any>;
}

async function postAutoEvent(
  encounter_id: string,
  hospital_id: string,
  content: string,
  audit: AutoEventAudit
) {
  const sql = getSql();
  const channelId = `patient-${encounter_id}`;

  try {
    const [channel] = await sql`
      SELECT id FROM chat_channels
      WHERE channel_id = ${channelId} AND is_archived = false
    `;
    if (!channel) return; // No active channel — skip silently

    const [message] = await sql`
      INSERT INTO chat_messages (channel_id, hospital_id, message_type, content)
      VALUES (${channel.id}, ${hospital_id}, 'system', ${content})
      RETURNING id
    `;
    await sql`
      UPDATE chat_channels SET last_message_at = NOW(), updated_at = NOW()
      WHERE id = ${channel.id}
    `;

    // CHAT.X.4 — wake up any SSE listeners for this hospital so the auto-event
    // lands in the patient channel in <50ms instead of waiting on the 5s
    // safety poll. Fire-and-forget; receiver does the cursor-since query.
    void notifyChatMessage(hospital_id);

    // CHAT.X.7 — audit (system source: clinical auto-events have no direct user
    // actor; they fire from tRPC mutations after the underlying clinical write)
    void logAudit({
      action: audit.action,
      source: 'system',
      hospital_id,
      channel_id: channelId,
      message_id: message?.id ?? null,
      details: { encounter_id, ...(audit.details ?? {}) },
    });
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
    `📊 Vitals recorded: ${params.vitals_summary}${news2}${by}`,
    {
      action: 'auto_event_vitals',
      details: {
        news2_score: params.news2_score ?? null,
        news2_risk: params.news2_risk ?? null,
        recorded_by: params.recorded_by ?? null,
      },
    }
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
    `💊 Medication ordered: ${params.drug_name}${dose}${route}${freq}${alert}${by}`,
    {
      action: 'auto_event_med_ordered',
      details: {
        drug_name: params.drug_name,
        dose_quantity: params.dose_quantity ?? null,
        dose_unit: params.dose_unit ?? null,
        route: params.route ?? null,
        frequency_code: params.frequency_code ?? null,
        is_high_alert: params.is_high_alert ?? false,
        ordered_by: params.ordered_by ?? null,
      },
    }
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
    `${icon} Medication ${verb}: ${drug}${dose}${by}`,
    {
      action: 'auto_event_med_administered',
      details: {
        drug_name: params.drug_name ?? null,
        dose_given: params.dose_given ?? null,
        dose_unit: params.dose_unit ?? null,
        status: params.status,
        administered_by: params.administered_by ?? null,
      },
    }
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
    `📝 ${params.note_type} note saved${by}`,
    {
      action: 'auto_event_note_saved',
      details: {
        note_type: params.note_type,
        author_name: params.author_name ?? null,
      },
    }
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
    `🧪 Lab ordered: ${params.panel_name}${urgency}${by}`,
    {
      action: 'auto_event_lab_ordered',
      details: {
        panel_name: params.panel_name,
        urgency: params.urgency ?? null,
        ordered_by: params.ordered_by ?? null,
      },
    }
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
    `✅ Results verified: ${panel}${tat}${by}`,
    {
      action: 'auto_event_lab_verified',
      details: {
        panel_name: params.panel_name ?? null,
        tat_minutes: params.tat_minutes ?? null,
        verified_by: params.verified_by ?? null,
      },
    }
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
    `🍽️ Diet order: ${params.diet_type}${restrictions}${by}`,
    {
      action: 'auto_event_diet_ordered',
      details: {
        diet_type: params.diet_type,
        restrictions: params.restrictions ?? null,
        ordered_by: params.ordered_by ?? null,
      },
    }
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
    `🩺 Nursing order (${params.task_type})${desc}${by}`,
    {
      action: 'auto_event_nursing_order',
      details: {
        task_type: params.task_type,
        description: params.description ?? null,
        ordered_by: params.ordered_by ?? null,
      },
    }
  );
}
