import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import type { InsightCard, CardSeverity } from '../types';
import { generateInsight } from '../llm-client';

let _sql: any = null;

function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

/**
 * Patient handoff data structure for shift briefing.
 */
export interface PatientHandoff {
  encounter_id: string;
  patient_name: string;
  age: number;
  gender: string;
  bed_name: string;
  primary_diagnosis: string;
  active_conditions: string[];
  news2_score: number | null;
  news2_trend: 'rising' | 'falling' | 'stable' | 'unknown';
  key_vitals: Record<string, string>;
  recent_events: string[];
  active_medications: Array<{ drug: string; dose: string; frequency: string; next_due?: string }>;
  pending_orders: string[];
  nursing_alerts: string[];
  handoff_narrative: string;
}

/**
 * Complete shift handoff brief for a ward.
 */
export interface ShiftHandoffBrief {
  hospital_id: string;
  ward_name: string;
  shift: 'morning' | 'afternoon' | 'night';
  generated_at: string;
  patient_count: number;
  patients: PatientHandoff[];
  ward_summary: string;
  critical_alerts: string[];
  confidence: number;
  source: 'llm' | 'template';
  card: InsightCard;
}

/**
 * Determine current shift based on IST time (UTC+5:30).
 * 6:00-13:59 → morning, 14:00-21:59 → afternoon, 22:00-5:59 → night
 */
function determineShift(): 'morning' | 'afternoon' | 'night' {
  const istDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const hour = istDate.getUTCHours();

  if (hour >= 6 && hour < 14) return 'morning';
  if (hour >= 14 && hour < 22) return 'afternoon';
  return 'night';
}

/**
 * Calculate age in years from date of birth.
 */
function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return Math.max(0, age);
}

/**
 * Gather all clinical data for a single patient over the lookback window.
 */
async function gatherPatientShiftData(
  encounter_id: string,
  hours_lookback: number = 8
): Promise<any> {
  const sql = getSql();
  const lookback_ts = new Date(Date.now() - hours_lookback * 60 * 60 * 1000).toISOString();

  try {
    // Fetch encounter + patient demographics
    const encounter_result = await sql`
      SELECT
        e.id, e.patient_id, e.primary_diagnosis, e.ward_name, e.bed_name,
        p.first_name, p.last_name, p.date_of_birth, p.gender
      FROM encounters e
      JOIN patients p ON e.patient_id = p.id
      WHERE e.id = ${encounter_id}
    `;

    if (!encounter_result || encounter_result.length === 0) {
      return null;
    }

    const encounter = encounter_result[0];

    // Fetch active conditions
    const conditions_result = await sql`
      SELECT description
      FROM conditions
      WHERE encounter_id = ${encounter_id} AND clinical_status = 'active'
    `;

    const active_conditions = conditions_result.map((c: any) => c.description);

    // Fetch recent vitals (observations)
    const vitals_result = await sql`
      SELECT observation_type, value_numeric, value_text, recorded_at
      FROM observations
      WHERE encounter_id = ${encounter_id}
      AND recorded_at >= ${lookback_ts}
      ORDER BY recorded_at DESC
      LIMIT 20
    `;

    // Build key_vitals (most recent of each type)
    const vitals_map: Record<string, string> = {};
    vitals_result.forEach((v: any) => {
      if (!vitals_map[v.observation_type]) {
        vitals_map[v.observation_type] = v.value_numeric ?? v.value_text ?? 'N/A';
      }
    });

    // Fetch active medications (due soon)
    const meds_result = await sql`
      SELECT drug_name, dose, route, frequency, status, next_dose_at
      FROM medication_orders
      WHERE encounter_id = ${encounter_id}
      AND status IN ('active', 'pending')
      ORDER BY next_dose_at ASC
    `;

    const active_medications = meds_result.map((m: any) => ({
      drug: m.drug_name,
      dose: m.dose || '',
      frequency: m.frequency || '',
      next_due: m.next_dose_at || undefined,
    }));

    // Fetch pending service requests
    const requests_result = await sql`
      SELECT request_type, description, priority
      FROM service_requests
      WHERE encounter_id = ${encounter_id}
      AND status IN ('pending', 'ordered')
      ORDER BY priority DESC
    `;

    const pending_orders = requests_result.map(
      (r: any) => `${r.request_type}${r.description ? ': ' + r.description : ''}`
    );

    // Fetch recent clinical notes
    const notes_result = await sql`
      SELECT content, created_at
      FROM clinical_impressions
      WHERE encounter_id = ${encounter_id}
      AND created_at >= ${lookback_ts}
      ORDER BY created_at DESC
      LIMIT 5
    `;

    // Fetch recent procedures
    const procedures_result = await sql`
      SELECT procedure_name, status, performed_at
      FROM procedures
      WHERE encounter_id = ${encounter_id}
      AND (performed_at >= ${lookback_ts} OR performed_at IS NULL)
      ORDER BY performed_at DESC NULLS LAST
      LIMIT 5
    `;

    // Fetch recent incidents
    const incidents_result = await sql`
      SELECT incident_type, severity, created_at
      FROM incident_reports
      WHERE encounter_id = ${encounter_id}
      AND created_at >= ${lookback_ts}
      ORDER BY created_at DESC
    `;

    // Compile recent events
    const recent_events: string[] = [];

    procedures_result.forEach((p: any) => {
      if (p.performed_at && new Date(p.performed_at) > new Date(lookback_ts)) {
        recent_events.push(`Procedure: ${p.procedure_name} (${p.status})`);
      } else if (!p.performed_at && p.status === 'scheduled') {
        recent_events.push(`Upcoming: ${p.procedure_name}`);
      }
    });

    incidents_result.forEach((i: any) => {
      recent_events.push(`Incident: ${i.incident_type} (${i.severity})`);
    });

    notes_result.forEach((n: any) => {
      const snippet = n.content.substring(0, 60).trim();
      recent_events.push(`Note: ${snippet}${n.content.length > 60 ? '...' : ''}`);
    });

    // Determine NEWS2 score (simplified; assumes "news2_score" observation exists)
    const news2_obs = vitals_result.find((v: any) => v.observation_type === 'news2_score');
    const news2_score = news2_obs ? parseFloat(news2_obs.value_numeric as any) : null;

    // Determine NEWS2 trend (mock: check if latest > previous)
    let news2_trend: 'rising' | 'falling' | 'stable' | 'unknown' = 'unknown';
    if (news2_score !== null && vitals_result.length > 1) {
      const prev_news2 = vitals_result
        .slice(1)
        .find((v: any) => v.observation_type === 'news2_score');
      if (prev_news2) {
        const prev_score = parseFloat(prev_news2.value_numeric as any);
        if (news2_score > prev_score) news2_trend = 'rising';
        else if (news2_score < prev_score) news2_trend = 'falling';
        else news2_trend = 'stable';
      }
    }

    // Build nursing alerts
    const nursing_alerts: string[] = [];
    if (news2_score !== null && news2_score >= 7) {
      nursing_alerts.push(`Critical NEWS2: ${news2_score}`);
    } else if (news2_score !== null && news2_score >= 5) {
      nursing_alerts.push(`Elevated NEWS2: ${news2_score}`);
    }

    const overdue_meds = meds_result.filter(
      (m: any) => m.next_dose_at && new Date(m.next_dose_at) < new Date()
    );
    if (overdue_meds.length > 0) {
      nursing_alerts.push(`${overdue_meds.length} overdue medication(s)`);
    }

    if (active_conditions.some((c: string) => c.toLowerCase().includes('isolation'))) {
      nursing_alerts.push('Isolation precautions active');
    }

    return {
      encounter_id,
      patient_id: encounter.patient_id,
      first_name: encounter.first_name,
      last_name: encounter.last_name,
      date_of_birth: encounter.date_of_birth,
      gender: encounter.gender,
      primary_diagnosis: encounter.primary_diagnosis,
      ward_name: encounter.ward_name,
      bed_name: encounter.bed_name,
      active_conditions,
      news2_score,
      news2_trend,
      key_vitals: vitals_map,
      recent_events,
      active_medications,
      pending_orders,
      nursing_alerts,
    };
  } catch (error) {
    console.error(`Error gathering patient data for encounter ${encounter_id}:`, error);
    return null;
  }
}

/**
 * Generate handoff narrative for a single patient.
 * Attempts LLM smoothing; falls back to template.
 */
async function generatePatientHandoff(
  encounter: any,
  patientData: any
): Promise<PatientHandoff> {
  const age = calculateAge(patientData.date_of_birth);

  // Template fallback narrative
  const vitals_summary = Object.entries(patientData.key_vitals)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const recent_summary =
    patientData.recent_events.length > 0
      ? patientData.recent_events.slice(0, 2).join('; ')
      : 'No recent events';

  const due_summary =
    patientData.pending_orders.length > 0
      ? `Pending: ${patientData.pending_orders.slice(0, 2).join(', ')}`
      : '';

  const template_narrative = [
    `${patientData.first_name} ${patientData.last_name} (${age}${patientData.gender[0] || ''}, ${patientData.primary_diagnosis}).`,
    `NEWS2: ${patientData.news2_score ?? 'N/A'} (${patientData.news2_trend}).`,
    vitals_summary && `Vitals: ${vitals_summary}.`,
    recent_summary && `Recent: ${recent_summary}.`,
    due_summary,
  ]
    .filter(Boolean)
    .join(' ');

  let handoff_narrative = template_narrative;
  let source: 'llm' | 'template' = 'template';

  // Attempt LLM smoothing
  try {
    const contextSummary = [
      `Patient: ${patientData.first_name} ${patientData.last_name}, ${age}${patientData.gender[0] || ''}`,
      `Primary diagnosis: ${patientData.primary_diagnosis}`,
      `Active conditions: ${patientData.active_conditions.join(', ') || 'None'}`,
      `NEWS2: ${patientData.news2_score ?? 'N/A'} (${patientData.news2_trend})`,
      `Recent events: ${patientData.recent_events.slice(0, 3).join('; ') || 'None'}`,
      `Nursing alerts: ${patientData.nursing_alerts.join('; ') || 'None'}`,
    ].join('\n');

    const llm_result = await generateInsight({
      hospital_id: encounter.hospital_id,
      module: 'clinical',
      system_prompt: 'You are a clinical nurse specialist generating concise shift handoff narratives. Be clinical, direct, and focused on patient safety.',
      user_prompt: `Generate a concise 1-2 sentence shift handoff narrative for this patient. Focus on diagnosis, acuity (NEWS2), and any critical alerts.\n\n${contextSummary}`,
      max_tokens: 200,
      temperature: 0.5,
      triggered_by: 'cron',
    });

    if (llm_result?.content && llm_result.content.trim().length > 0) {
      handoff_narrative = llm_result.content.trim();
      source = 'llm';
    }
  } catch (error) {
    console.warn('LLM smoothing failed, using template:', error);
  }

  return {
    encounter_id: patientData.encounter_id,
    patient_name: `${patientData.first_name} ${patientData.last_name}`,
    age,
    gender: patientData.gender,
    bed_name: patientData.bed_name,
    primary_diagnosis: patientData.primary_diagnosis,
    active_conditions: patientData.active_conditions,
    news2_score: patientData.news2_score,
    news2_trend: patientData.news2_trend,
    key_vitals: patientData.key_vitals,
    recent_events: patientData.recent_events,
    active_medications: patientData.active_medications,
    pending_orders: patientData.pending_orders,
    nursing_alerts: patientData.nursing_alerts,
    handoff_narrative,
  };
}

/**
 * Generate complete shift handoff brief for a ward.
 *
 * @param params - { hospital_id, ward_name }
 * @returns ShiftHandoffBrief with all patient data, summary, and insight card
 */
export async function generateShiftHandoff(params: {
  hospital_id: string;
  ward_name: string;
}): Promise<ShiftHandoffBrief> {
  const sql = getSql();
  const shift = determineShift();
  const generated_at = new Date().toISOString();
  const card_id = randomUUID();

  try {
    // 1. Query all admitted encounters for the ward
    const encounters_result = await sql`
      SELECT id, patient_id, primary_diagnosis, bed_name
      FROM encounters
      WHERE hospital_id = ${params.hospital_id}
      AND ward_name = ${params.ward_name}
      AND status = 'admitted'
    `;

    const patients: PatientHandoff[] = [];
    const critical_alerts: Set<string> = new Set();
    let max_news2 = 0;

    // 2 & 3. Gather data and generate handoff for each patient
    for (const enc of encounters_result) {
      const patientData = await gatherPatientShiftData(enc.id, 8);
      if (!patientData) continue;

      const handoff = await generatePatientHandoff(enc, patientData);
      patients.push(handoff);

      // Collect critical alerts
      handoff.nursing_alerts.forEach((alert) => critical_alerts.add(alert));
      if (handoff.news2_score !== null) {
        max_news2 = Math.max(max_news2, handoff.news2_score);
      }
    }

    // 4. Build ward summary
    const high_acuity = patients.filter(
      (p) => p.news2_score !== null && p.news2_score >= 5
    ).length;
    const new_admits = patients.filter((p) =>
      p.recent_events.some((e) => e.includes('admission'))
    ).length;

    const ward_summary = [
      `${patients.length} patient(s) in ${params.ward_name}`,
      high_acuity > 0 && `${high_acuity} high acuity (NEWS2 ≥ 5)`,
      new_admits > 0 && `${new_admits} new admission(s)`,
    ]
      .filter(Boolean)
      .join(', ') + '.';

    // 5. Determine severity based on ward acuity
    let severity: CardSeverity = 'info';
    if (max_news2 >= 7) severity = 'high';
    else if (max_news2 >= 5) severity = 'medium';

    // 6. Build InsightCard
    const card: InsightCard = {
      id: card_id,
      hospital_id: params.hospital_id,
      module: 'clinical',
      category: 'report',
      severity,
      title: `Shift Handoff — ${params.ward_name} (${shift})`,
      body: [ward_summary, ...Array.from(critical_alerts).slice(0, 3)].join(' '),
      explanation: `Shift handoff brief for ${params.ward_name} during ${shift} shift. ${patients.length} patients, max NEWS2: ${max_news2}.`,
      data_sources: ['encounters', 'observations', 'medication_orders', 'conditions'],
      suggested_action: 'Review patient handoff details before starting shift',
      confidence: 0.85,
      source: patients.some((p: PatientHandoff) => p.handoff_narrative) ? 'llm' : 'template',
      status: 'active',
      created_at: generated_at,
      updated_at: generated_at,
    };

    // 7. Insert card into ai_insight_cards
    await sql`
      INSERT INTO ai_insight_cards (
        id, hospital_id, module, category, severity,
        title, body, explanation, data_sources, suggested_action,
        confidence, source, status, created_at, expires_at
      ) VALUES (
        ${card_id}, ${params.hospital_id}, ${card.module}, ${card.category}, ${severity},
        ${card.title}, ${card.body}, ${card.explanation}, ${JSON.stringify(card.data_sources)}, ${card.suggested_action},
        ${card.confidence}, ${card.source}, ${card.status},
        ${generated_at}, ${new Date(new Date(generated_at).getTime() + 12 * 60 * 60 * 1000).toISOString()}
      )
    `;

    // 8. Return complete brief
    const brief: ShiftHandoffBrief = {
      hospital_id: params.hospital_id,
      ward_name: params.ward_name,
      shift,
      generated_at,
      patient_count: patients.length,
      patients,
      ward_summary,
      critical_alerts: Array.from(critical_alerts),
      confidence: 0.85,
      source: patients.some((p: PatientHandoff) => p.handoff_narrative) ? 'llm' : 'template',
      card,
    };

    return brief;
  } catch (error) {
    console.error(`Error generating shift handoff for ${params.ward_name}:`, error);
    throw error;
  }
}

/**
 * Generate shift handoffs for all wards in a hospital.
 *
 * @param hospital_id - The hospital ID
 * @returns Array of ShiftHandoffBrief, one per ward
 */
export async function generateAllWardHandoffs(hospital_id: string): Promise<ShiftHandoffBrief[]> {
  const sql = getSql();

  try {
    // Query distinct wards with admitted patients
    const wards_result = await sql`
      SELECT DISTINCT ward_name
      FROM encounters
      WHERE hospital_id = ${hospital_id}
      AND status = 'admitted'
      ORDER BY ward_name ASC
    `;

    const briefs: ShiftHandoffBrief[] = [];

    for (const wardRow of wards_result) {
      const brief = await generateShiftHandoff({
        hospital_id,
        ward_name: wardRow.ward_name,
      });
      briefs.push(brief);
    }

    return briefs;
  } catch (error) {
    console.error(`Error generating all ward handoffs for hospital ${hospital_id}:`, error);
    throw error;
  }
}
