/**
 * Even AI — Clinical Intelligence: Discharge Summary Generator
 * AI-powered discharge summary draft generation from encounter data
 *
 * Features:
 * - Multi-table data gathering from encounters, medications, procedures, observations
 * - LLM-powered narrative generation (hospital course, follow-up instructions)
 * - Fallback template-based generation when LLM is unavailable
 * - InsightCard generation with full audit trail
 * - Medical documentation formatting for Bangalore multi-specialty hospital
 *
 * Database tables used:
 * - encounters: id, hospital_id, patient_id, status, primary_diagnosis, secondary_diagnoses,
 *               admitted_at, discharged_at, ward_name, expected_los_days
 * - patients: id, first_name, last_name, date_of_birth, gender, blood_group, uhid
 * - conditions: patient_id, encounter_id, icd_code, description, clinical_status, severity
 * - medication_orders: encounter_id, drug_name, dose, route, frequency, status,
 *                      reason_discontinued, is_high_alert, is_narcotic
 * - procedures: encounter_id, procedure_name, procedure_code, performed_by_name,
 *               performed_at, status, complications
 * - observations: encounter_id, observation_type, value_numeric, value_text, recorded_at
 * - clinical_impressions: encounter_id, note_type, content, status, signed_at
 * - care_plans: encounter_id, template_name, status
 * - care_plan_milestones: care_plan_id, milestone_name, status, completed_at
 * - allergies: patient_id, substance, category, criticality, reaction_description
 * - ai_insight_cards: insert audit trail for generated cards
 */

import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';
import type { InsightCard, CardSeverity } from '../types';
import { generateInsight } from '../llm-client';

// ============================================================================
// Lazy Singleton
// ============================================================================

let _sql: any = null;

/**
 * Get or create the Neon SQL client (lazy singleton)
 */
function getSql() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Medication as it appears on discharge summary
 */
interface DischargeMedication {
  drug: string;
  dose: string;
  route: string;
  frequency: string;
}

/**
 * Complete discharge summary draft with structured and narrative components
 */
export interface DischargeSummaryDraft {
  encounter_id: string;
  hospital_id: string;
  patient_name: string;
  uhid: string;
  age: number;
  gender: string;
  admission_date: string;
  discharge_date?: string;
  primary_diagnosis: string;
  secondary_diagnoses: string[];
  allergies: string[];
  hospital_course: string;
  procedures_performed: string[];
  medications_at_discharge: DischargeMedication[];
  discharge_vitals: Record<string, string>;
  follow_up_instructions: string[];
  diet_restrictions: string;
  activity_restrictions: string;
  pending_results: string[];
  confidence: number;
  source: 'llm' | 'template';
  card: InsightCard;
}

/**
 * Raw encounter data gathered from multiple tables
 */
interface EncounterData {
  encounter: {
    id: string;
    hospital_id: string;
    patient_id: string;
    status: string;
    primary_diagnosis: string;
    secondary_diagnoses: string[] | null;
    admitted_at: string;
    discharged_at: string | null;
    ward_name: string | null;
    expected_los_days: number | null;
  };
  patient: {
    id: string;
    first_name: string;
    last_name: string;
    date_of_birth: string;
    gender: string;
    blood_group: string | null;
    uhid: string;
  };
  conditions: Array<{
    icd_code: string;
    description: string;
    clinical_status: string;
    severity: string;
  }>;
  medications: Array<{
    drug_name: string;
    dose: string;
    route: string;
    frequency: string;
    status: string;
    reason_discontinued: string | null;
    is_high_alert: boolean;
    is_narcotic: boolean;
  }>;
  procedures: Array<{
    procedure_name: string;
    procedure_code: string;
    performed_by_name: string;
    performed_at: string;
    status: string;
    complications: string | null;
  }>;
  observations: Array<{
    observation_type: string;
    value_numeric: number | null;
    value_text: string | null;
    recorded_at: string;
  }>;
  clinical_impressions: Array<{
    note_type: string;
    content: string;
    status: string;
    signed_at: string | null;
  }>;
  care_plan_milestones: Array<{
    milestone_name: string;
    status: string;
    completed_at: string | null;
  }>;
  allergies: Array<{
    substance: string;
    category: string;
    criticality: string;
    reaction_description: string | null;
  }>;
}

// ============================================================================
// Helper: Calculate Age
// ============================================================================

/**
 * Calculate age in years from date of birth string
 * Handles ISO dates and Indian date formats
 */
function calculateAge(dob: string): number {
  try {
    const birthDate = new Date(dob);
    const today = new Date();

    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return Math.max(0, age);
  } catch (err) {
    console.error('[DischargeSummary] Failed to calculate age:', err);
    return 0;
  }
}

// ============================================================================
// Helper: Gather Encounter Data from All Tables
// ============================================================================

/**
 * Gather and denormalize all encounter data from multiple tables
 * Uses try/catch per table to gracefully handle missing data
 *
 * @param hospital_id - Hospital identifier
 * @param encounter_id - Encounter identifier
 * @returns Structured encounter data with empty arrays for missing data
 */
async function gatherEncounterData(
  hospital_id: string,
  encounter_id: string
): Promise<EncounterData | null> {
  const sql = getSql();

  // Fetch encounter header
  let encounter: any = null;
  try {
    const result = await sql`
      SELECT
        id,
        hospital_id,
        patient_id,
        status,
        primary_diagnosis,
        secondary_diagnoses,
        admitted_at,
        discharged_at,
        ward_name,
        expected_los_days
      FROM encounters
      WHERE id = ${encounter_id}
        AND hospital_id = ${hospital_id}
      LIMIT 1
    `;

    encounter = result[0] || null;
  } catch (err) {
    console.error(
      '[DischargeSummary] Error fetching encounter:',
      err
    );
  }

  if (!encounter) {
    return null;
  }

  // Fetch patient
  let patient: any = null;
  try {
    const result = await sql`
      SELECT
        id,
        first_name,
        last_name,
        date_of_birth,
        gender,
        blood_group,
        uhid
      FROM patients
      WHERE id = ${encounter.patient_id}
      LIMIT 1
    `;

    patient = result[0] || null;
  } catch (err) {
    console.error('[DischargeSummary] Error fetching patient:', err);
  }

  if (!patient) {
    return null;
  }

  // Fetch conditions
  let conditions: any[] = [];
  try {
    conditions = await sql`
      SELECT
        icd_code,
        description,
        clinical_status,
        severity
      FROM conditions
      WHERE encounter_id = ${encounter_id}
      ORDER BY severity DESC
    `;
  } catch (err) {
    console.error('[DischargeSummary] Error fetching conditions:', err);
  }

  // Fetch active/completed medications
  let medications: any[] = [];
  try {
    medications = await sql`
      SELECT
        drug_name,
        dose,
        route,
        frequency,
        status,
        reason_discontinued,
        is_high_alert,
        is_narcotic
      FROM medication_orders
      WHERE encounter_id = ${encounter_id}
        AND status IN ('active', 'completed')
      ORDER BY drug_name ASC
    `;
  } catch (err) {
    console.error('[DischargeSummary] Error fetching medications:', err);
  }

  // Fetch procedures
  let procedures: any[] = [];
  try {
    procedures = await sql`
      SELECT
        procedure_name,
        procedure_code,
        performed_by_name,
        performed_at,
        status,
        complications
      FROM procedures
      WHERE encounter_id = ${encounter_id}
      ORDER BY performed_at DESC
    `;
  } catch (err) {
    console.error('[DischargeSummary] Error fetching procedures:', err);
  }

  // Fetch latest observations (vitals)
  let observations: any[] = [];
  try {
    observations = await sql`
      SELECT DISTINCT ON (observation_type)
        observation_type,
        value_numeric,
        value_text,
        recorded_at
      FROM observations
      WHERE encounter_id = ${encounter_id}
      ORDER BY observation_type, recorded_at DESC
    `;
  } catch (err) {
    console.error('[DischargeSummary] Error fetching observations:', err);
  }

  // Fetch clinical impressions (notes)
  let clinical_impressions: any[] = [];
  try {
    clinical_impressions = await sql`
      SELECT
        note_type,
        content,
        status,
        signed_at
      FROM clinical_impressions
      WHERE encounter_id = ${encounter_id}
        AND status = 'signed'
      ORDER BY signed_at DESC
      LIMIT 10
    `;
  } catch (err) {
    console.error(
      '[DischargeSummary] Error fetching clinical impressions:',
      err
    );
  }

  // Fetch care plan milestones
  let care_plan_milestones: any[] = [];
  try {
    care_plan_milestones = await sql`
      SELECT
        cpm.milestone_name,
        cpm.status,
        cpm.completed_at
      FROM care_plan_milestones cpm
      INNER JOIN care_plans cp ON cp.id = cpm.care_plan_id
      WHERE cp.encounter_id = ${encounter_id}
      ORDER BY cpm.completed_at DESC
    `;
  } catch (err) {
    console.error(
      '[DischargeSummary] Error fetching care plan milestones:',
      err
    );
  }

  // Fetch allergies
  let allergies: any[] = [];
  try {
    allergies = await sql`
      SELECT
        substance,
        category,
        criticality,
        reaction_description
      FROM allergies
      WHERE patient_id = ${patient.id}
      ORDER BY criticality DESC, substance ASC
    `;
  } catch (err) {
    console.error('[DischargeSummary] Error fetching allergies:', err);
  }

  return {
    encounter,
    patient,
    conditions,
    medications,
    procedures,
    observations,
    clinical_impressions,
    care_plan_milestones,
    allergies,
  };
}

// ============================================================================
// Helper: Template-Based Generation (Fallback)
// ============================================================================

/**
 * Generate discharge summary without LLM (template-based fallback)
 * Creates structured text from raw data
 */
function generateTemplateDischargeSummary(data: EncounterData): {
  hospital_course: string;
  follow_up_instructions: string[];
} {
  const lines: string[] = [];

  // Hospital course narrative
  const admissionDate = new Date(data.encounter.admitted_at).toLocaleDateString(
    'en-IN',
    { year: 'numeric', month: 'long', day: 'numeric' }
  );

  const dischargeDate = data.encounter.discharged_at
    ? new Date(data.encounter.discharged_at).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'today';

  lines.push(
    `Patient was admitted on ${admissionDate} to ${data.encounter.ward_name || 'the hospital'} with diagnosis of ${data.encounter.primary_diagnosis}.`
  );

  if (data.encounter.secondary_diagnoses && data.encounter.secondary_diagnoses.length > 0) {
    const secondaryList = (data.encounter.secondary_diagnoses as string[]).join(', ');
    lines.push(`Secondary diagnoses included: ${secondaryList}.`);
  }

  if (data.procedures.length > 0) {
    lines.push(
      `The patient underwent ${data.procedures.length} procedure(s) during the admission.`
    );
    data.procedures.forEach((proc) => {
      lines.push(
        `• ${proc.procedure_name} (${proc.procedure_code}) performed by ${proc.performed_by_name}`
      );
    });
  }

  lines.push(`Patient is being discharged on ${dischargeDate} in stable condition.`);

  // Follow-up instructions (template)
  const followUp: string[] = [
    'Review medications and continue as prescribed',
    'Follow up with primary physician in 1 week',
    'Report any fever, increased pain, or new symptoms immediately',
    'Maintain adequate nutrition and hydration',
    'Avoid strenuous activities for 1 week',
  ];

  return {
    hospital_course: lines.join(' '),
    follow_up_instructions: followUp,
  };
}

// ============================================================================
// Main: Generate Discharge Summary
// ============================================================================

/**
 * Generate a discharge summary draft for an encounter
 * Uses LLM for narrative generation, falls back to template if unavailable
 * Inserts InsightCard and returns complete draft
 *
 * @param params - hospital_id and encounter_id
 * @returns Complete discharge summary draft with InsightCard
 *
 * @example
 * ```typescript
 * const draft = await generateDischargeSummary({
 *   hospital_id: 'even-race-course',
 *   encounter_id: 'enc-12345'
 * });
 * ```
 */
export async function generateDischargeSummary(params: {
  hospital_id: string;
  encounter_id: string;
}): Promise<DischargeSummaryDraft | null> {
  const { hospital_id, encounter_id } = params;
  const sql = getSql();

  // Gather all encounter data
  const data = await gatherEncounterData(hospital_id, encounter_id);
  if (!data) {
    console.error('[DischargeSummary] Encounter or patient not found');
    return null;
  }

  const patientName = `${data.patient.first_name} ${data.patient.last_name}`;
  const age = calculateAge(data.patient.date_of_birth);
  const admissionDateStr = new Date(data.encounter.admitted_at).toLocaleDateString(
    'en-IN',
    { year: 'numeric', month: 'short', day: 'numeric' }
  );
  const dischargeDateStr = data.encounter.discharged_at
    ? new Date(data.encounter.discharged_at).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : undefined;

  // Extract discharge medications (active or completed)
  const dischargemedications: DischargeMedication[] = data.medications
    .filter((m) => m.status === 'active' || m.status === 'completed')
    .map((m) => ({
      drug: m.drug_name,
      dose: m.dose || 'as directed',
      route: m.route || 'oral',
      frequency: m.frequency || 'as needed',
    }));

  // Extract discharge vitals (latest observation per type)
  const dischargeVitals: Record<string, string> = {};
  data.observations.forEach((obs) => {
    const value = obs.value_numeric !== null ? obs.value_numeric : obs.value_text;
    dischargeVitals[obs.observation_type] = String(value || 'Not recorded');
  });

  // Extract procedures
  const proceduresPerformed = data.procedures.map(
    (p) => `${p.procedure_name} (${p.procedure_code})`
  );

  // Extract allergies
  const allergiesStrs = data.allergies.map((a) => {
    const reaction = a.reaction_description ? ` - ${a.reaction_description}` : '';
    return `${a.substance} [${a.criticality}]${reaction}`;
  });

  // Try LLM generation first
  let source: 'llm' | 'template' = 'template';
  let hospitalCourse = '';
  let followUpInstructions: string[] = [];

  try {
    // Build medical context for LLM
    const contextLines: string[] = [
      `Patient: ${patientName}, Age: ${age}, UHID: ${data.patient.uhid}`,
      `Admission: ${admissionDateStr} | Discharge: ${dischargeDateStr || 'today'}`,
      `Primary Diagnosis: ${data.encounter.primary_diagnosis}`,
    ];

    if (data.procedures.length > 0) {
      contextLines.push(`Procedures: ${proceduresPerformed.join('; ')}`);
    }

    if (dischargemedications.length > 0) {
      const medList = dischargemedications
        .map((m) => `${m.drug} ${m.dose} ${m.frequency}`)
        .join('; ');
      contextLines.push(`Discharge Meds: ${medList}`);
    }

    const systemPrompt =
      'You are a medical documentation assistant at a multi-specialty hospital in Bangalore, India. ' +
      'Generate clear, concise discharge summary sections: hospital course narrative and follow-up instructions. ' +
      'Be brief (2-3 sentences for course, 5-6 bullet points for follow-up). Use simple language.';

    const userPrompt =
      `Generate discharge summary sections for:\n\n${contextLines.join('\n')}\n\n` +
      'Output format:\n' +
      'HOSPITAL_COURSE:\n[narrative]\n\n' +
      'FOLLOW_UP:\n[bullet list, one per line starting with •]';

    const llmResult = await generateInsight({
      hospital_id,
      module: 'clinical',
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      max_tokens: 400,
      temperature: 0.5,
      triggered_by: 'event',
    });

    if (llmResult && llmResult.content) {
      source = 'llm';

      // Parse LLM output
      const courseMatch = llmResult.content.match(
        /HOSPITAL_COURSE:\s*([\s\S]*?)(?=FOLLOW_UP:|$)/i
      );
      const followupMatch = llmResult.content.match(/FOLLOW_UP:\s*([\s\S]*?)$/i);

      if (courseMatch) {
        hospitalCourse = courseMatch[1].trim();
      }

      if (followupMatch) {
        followUpInstructions = followupMatch[1]
          .split('\n')
          .filter((line) => line.trim().startsWith('•'))
          .map((line) => line.replace(/^•\s*/, '').trim());
      }
    }
  } catch (err) {
    console.error('[DischargeSummary] LLM generation failed, using template:', err);
  }

  // Fall back to template if LLM didn't produce output
  if (!hospitalCourse || followUpInstructions.length === 0) {
    const template = generateTemplateDischargeSummary(data);
    hospitalCourse = hospitalCourse || template.hospital_course;
    followUpInstructions = followUpInstructions.length > 0
      ? followUpInstructions
      : template.follow_up_instructions;
    source = 'template';
  }

  // Build discharge summary draft
  const draft: DischargeSummaryDraft = {
    encounter_id,
    hospital_id,
    patient_name: patientName,
    uhid: data.patient.uhid,
    age,
    gender: data.patient.gender,
    admission_date: admissionDateStr,
    discharge_date: dischargeDateStr,
    primary_diagnosis: data.encounter.primary_diagnosis,
    secondary_diagnoses: (data.encounter.secondary_diagnoses || []) as string[],
    allergies: allergiesStrs,
    hospital_course: hospitalCourse,
    procedures_performed: proceduresPerformed,
    medications_at_discharge: dischargemedications,
    discharge_vitals: dischargeVitals,
    follow_up_instructions: followUpInstructions,
    diet_restrictions: 'As per clinical recommendation',
    activity_restrictions: 'Avoid strenuous activity for 1 week',
    pending_results: [],
    confidence: source === 'llm' ? 0.85 : 0.65,
    source,
    card: {} as InsightCard, // Will be populated below
  };

  // Generate InsightCard
  const cardId = randomUUID();
  const now = new Date().toISOString();

  const card: InsightCard = {
    id: cardId,
    hospital_id,
    module: 'clinical',
    category: 'report',
    severity: 'info' as CardSeverity,
    title: `Discharge Summary Draft — ${patientName}`,
    body:
      `**Hospital Course:** ${hospitalCourse}\n\n` +
      `**Medications at Discharge:**\n${dischargemedications.map((m) => `• ${m.drug} ${m.dose} ${m.frequency}`).join('\n')}\n\n` +
      `**Follow-up:** ${followUpInstructions.slice(0, 3).join('; ')}`,
    explanation: `Discharge summary generated by Even AI (source: ${source}).` +
      ` Review, edit, and sign before patient discharge.`,
    data_sources: [
      'encounters',
      'patients',
      'medication_orders',
      'procedures',
      'observations',
    ],
    suggested_action: 'Review and sign the discharge summary',
    action_url: `/encounters/${encounter_id}/discharge-summary`,
    confidence: draft.confidence,
    source: source === 'llm' ? 'llm' : 'template',
    status: 'active',
    target_encounter_id: encounter_id,
    target_patient_id: data.patient.id,
    created_at: now,
    updated_at: now,
  };

  // Insert card into ai_insight_cards
  try {
    await sql`
      INSERT INTO ai_insight_cards (
        id,
        hospital_id,
        module,
        category,
        severity,
        title,
        body,
        explanation,
        data_sources,
        suggested_action,
        action_url,
        confidence,
        source,
        status,
        target_encounter_id,
        target_patient_id,
        created_at,
        updated_at
      )
      VALUES (
        ${card.id},
        ${card.hospital_id},
        ${card.module},
        ${card.category},
        ${card.severity},
        ${card.title},
        ${card.body},
        ${card.explanation},
        ${JSON.stringify(card.data_sources)},
        ${card.suggested_action || null},
        ${card.action_url || null},
        ${card.confidence},
        ${card.source},
        ${card.status},
        ${card.target_encounter_id || null},
        ${card.target_patient_id || null},
        ${card.created_at},
        ${card.updated_at}
      )
    `;
  } catch (err) {
    console.error('[DischargeSummary] Failed to insert card:', err);
  }

  draft.card = card;
  return draft;
}
