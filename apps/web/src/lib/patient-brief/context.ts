/**
 * Patient Brief — Context Builder
 *
 * Gathers all source rows needed for the LLM to synthesise a patient brief.
 * Produces a structured object (consumed by the prompt builder) and a flat
 * `sourceIds` list (written to patient_brief_sources for traceability).
 *
 * Window conventions:
 *   - active conditions / allergies:  is_deleted = false, clinical_status <> 'resolved'
 *   - recent meds:      last 30 days, status in (active, on-hold, completed)
 *   - recent labs:      last 30 days (via lab_orders.patient_id join)
 *   - recent vitals:    last 7 days
 *   - recent notes:     last 30 days, status = 'signed'
 *   - accepted props:   last 30 days, status = 'accepted'
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';

// ============================================================
// TYPES
// ============================================================

export interface PatientDemographics {
  id: string;
  uhid: string;
  name_full: string;
  gender: string | null;
  dob: string | null;         // ISO or null
  age_years: number | null;
  blood_group: string | null;
  phone: string | null;
  patient_category: string | null;
}

export interface EncounterSummary {
  id: string;
  encounter_class: string;
  status: string;
  admission_type: string | null;
  journey_type: string | null;
  chief_complaint: string | null;
  preliminary_diagnosis_icd10: string | null;
  admission_at: string | null;
  discharge_at: string | null;
  attending_practitioner_id: string | null;
  attending_practitioner_name: string | null;
  current_location_id: string | null;
  current_location_name: string | null;
}

export interface ConditionRow {
  id: string;
  condition_name: string;
  icd10_code: string | null;
  clinical_status: string;
  verification_status: string;
  severity: string | null;
  onset_date: string | null;
  notes: string | null;
  recorded_at: string;
}

export interface AllergyRow {
  id: string;
  substance: string;
  reaction: string | null;
  severity: string;
  category: string;
  criticality: string;
  verification_status: string;
  notes: string | null;
  recorded_at: string;
}

export interface MedicationRow {
  id: string;
  drug_name: string;
  generic_name: string | null;
  dose_quantity: number | null;
  dose_unit: string | null;
  route: string | null;
  frequency_code: string | null;
  duration_days: number | null;
  status: string;
  intent: string;
  is_prn: boolean;
  prn_indication: string | null;
  is_high_alert: boolean;
  narcotics_class: string | null;
  instructions: string | null;
  start_date: string | null;
  end_date: string | null;
  prescriber_id: string;
  prescriber_name: string | null;
  ordered_at: string;
}

export interface LabRow {
  id: string;
  test_code: string;
  test_name: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  ref_range_text: string | null;
  flag: string | null;
  is_critical: boolean;
  resulted_at: string;
  order_id: string;
}

export interface VitalRow {
  id: string;
  observation_type: string;
  value_quantity: number | null;
  value_string: string | null;
  unit: string | null;
  interpretation: string | null;
  effective_datetime: string;
}

export interface NoteRow {
  id: string;
  note_type: string;
  status: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  free_text_content: string | null;
  author_id: string;
  author_name: string | null;
  signed_at: string | null;
  created_at: string;
}

export interface ProposalRow {
  id: string;
  proposal_type: string;
  payload: Record<string, unknown>;
  confidence: number | null;
  status: string;
  reviewed_at: string | null;
  applied_row_id: string | null;
  created_at: string;
}

export interface BriefSourceRef {
  source_table: string;
  source_id: string;
}

export interface BriefContext {
  patient: PatientDemographics;
  encounter: EncounterSummary | null;
  conditions: ConditionRow[];
  allergies: AllergyRow[];
  medications: MedicationRow[];
  labs: LabRow[];
  vitals: VitalRow[];
  notes: NoteRow[];
  accepted_proposals: ProposalRow[];
  source_ids: BriefSourceRef[];
}

// ============================================================
// MAIN
// ============================================================

/**
 * Gather full context for a patient's brief.
 *
 * Throws if the patient does not exist. All other lookups are defensive —
 * missing sections return [] rather than throwing, so the brief can still
 * render for a patient with no encounters / no labs / etc.
 */
export async function gatherBriefContext(
  sql: NeonQueryFunction<false, false>,
  patientId: string,
): Promise<BriefContext> {
  // 1. Patient demographics ---------------------------------------------------
  const patientRows = await sql`
    SELECT
      id,
      uhid,
      name_full,
      gender::text                                                    AS gender,
      dob,
      blood_group::text                                               AS blood_group,
      phone,
      patient_category::text                                          AS patient_category,
      CASE
        WHEN dob IS NOT NULL
          THEN EXTRACT(YEAR FROM AGE(NOW(), dob))::int
        ELSE NULL
      END                                                             AS age_years
    FROM patients
    WHERE id = ${patientId}
    LIMIT 1
  ` as Array<{
    id: string;
    uhid: string;
    name_full: string;
    gender: string | null;
    dob: string | null;
    blood_group: string | null;
    phone: string | null;
    patient_category: string | null;
    age_years: number | null;
  }>;

  if (patientRows.length === 0) {
    throw new Error(`Patient ${patientId} not found`);
  }
  const patient: PatientDemographics = patientRows[0]!;

  // 2. Active encounter (most recent in-progress, else most recent any) ------
  const encRows = await sql`
    SELECT
      e.id,
      e.encounter_class::text                                         AS encounter_class,
      e.status::text                                                  AS status,
      e.admission_type::text                                          AS admission_type,
      e.journey_type,
      e.chief_complaint,
      e.preliminary_diagnosis_icd10,
      e.admission_at,
      e.discharge_at,
      e.attending_practitioner_id,
      u.name                                                          AS attending_practitioner_name,
      e.current_location_id,
      l.name                                                          AS current_location_name
    FROM encounters e
    LEFT JOIN users     u ON u.id = e.attending_practitioner_id
    LEFT JOIN locations l ON l.id = e.current_location_id
    WHERE e.patient_id = ${patientId}
    ORDER BY
      CASE WHEN e.status = 'in-progress' THEN 0 ELSE 1 END,
      e.admission_at DESC NULLS LAST,
      e.created_at  DESC
    LIMIT 1
  ` as Array<EncounterSummary>;

  const encounter: EncounterSummary | null = encRows[0] ?? null;

  // 3. Active conditions (not resolved, not deleted) -------------------------
  const conditionRows = await sql`
    SELECT
      id,
      condition_name,
      icd10_code,
      clinical_status::text                                           AS clinical_status,
      verification_status::text                                       AS verification_status,
      severity,
      onset_date,
      notes,
      created_at                                                      AS recorded_at
    FROM conditions
    WHERE patient_id = ${patientId}
      AND is_deleted = false
      AND clinical_status <> 'resolved'
    ORDER BY
      CASE clinical_status::text
        WHEN 'active'        THEN 0
        WHEN 'recurrence'    THEN 1
        WHEN 'relapse'       THEN 2
        WHEN 'inactive'      THEN 3
        WHEN 'remission'     THEN 4
        ELSE 5
      END,
      created_at DESC
    LIMIT 50
  ` as Array<ConditionRow>;

  // 4. Allergies (not deleted) ------------------------------------------------
  const allergyRows = await sql`
    SELECT
      id,
      substance,
      reaction,
      severity::text                                                  AS severity,
      category::text                                                  AS category,
      criticality::text                                               AS criticality,
      verification_status::text                                       AS verification_status,
      notes,
      created_at                                                      AS recorded_at
    FROM allergy_intolerances
    WHERE patient_id = ${patientId}
      AND is_deleted = false
    ORDER BY
      CASE severity::text
        WHEN 'severe'   THEN 0
        WHEN 'moderate' THEN 1
        WHEN 'mild'     THEN 2
        ELSE 3
      END,
      created_at DESC
    LIMIT 50
  ` as Array<AllergyRow>;

  // 5. Medications — last 30 days, active/on-hold/completed -------------------
  const medRows = await sql`
    SELECT
      mr.id,
      mr.drug_name,
      mr.generic_name,
      mr.dose_quantity,
      mr.dose_unit,
      mr.route,
      mr.frequency_code,
      mr.duration_days,
      mr.status::text                                                 AS status,
      mr.intent::text                                                 AS intent,
      mr.is_prn,
      mr.prn_indication,
      mr.is_high_alert,
      mr.narcotics_class::text                                        AS narcotics_class,
      mr.instructions,
      mr.start_date,
      mr.end_date,
      mr.prescriber_id,
      u.name                                                          AS prescriber_name,
      mr.ordered_at
    FROM medication_requests mr
    LEFT JOIN users u ON u.id = mr.prescriber_id
    WHERE mr.patient_id = ${patientId}
      AND mr.ordered_at >= NOW() - INTERVAL '30 days'
      AND mr.status::text IN ('active','on-hold','completed','draft')
    ORDER BY
      CASE mr.status::text
        WHEN 'active'    THEN 0
        WHEN 'draft'     THEN 1
        WHEN 'on-hold'   THEN 2
        WHEN 'completed' THEN 3
        ELSE 4
      END,
      mr.ordered_at DESC
    LIMIT 100
  ` as Array<MedicationRow>;

  // 6. Labs — last 30 days, via lab_orders.patient_id ------------------------
  const labRows = await sql`
    SELECT
      lr.id,
      lr.test_code,
      lr.test_name,
      lr.value_numeric::float                                         AS value_numeric,
      lr.value_text,
      lr.unit,
      lr.ref_range_low::float                                         AS ref_range_low,
      lr.ref_range_high::float                                        AS ref_range_high,
      lr.ref_range_text,
      lr.flag::text                                                   AS flag,
      lr.is_critical,
      lr.resulted_at,
      lr.order_id
    FROM lab_results lr
    JOIN lab_orders lo ON lo.id = lr.order_id
    WHERE lo.patient_id = ${patientId}
      AND lr.resulted_at >= NOW() - INTERVAL '30 days'
    ORDER BY lr.resulted_at DESC
    LIMIT 150
  ` as Array<LabRow>;

  // 7. Vitals — last 7 days, observation_type in ('vital-signs') -------------
  const vitalRows = await sql`
    SELECT
      id,
      observation_type::text                                          AS observation_type,
      value_quantity::float                                           AS value_quantity,
      value_string,
      unit,
      interpretation,
      effective_datetime
    FROM observations
    WHERE patient_id = ${patientId}
      AND effective_datetime >= NOW() - INTERVAL '7 days'
      AND observation_type::text IN ('vital-signs','intake-output')
    ORDER BY effective_datetime DESC
    LIMIT 200
  ` as Array<VitalRow>;

  // 8. Notes — last 30 days, signed ------------------------------------------
  const noteRows = await sql`
    SELECT
      ci.id,
      ci.note_type::text                                              AS note_type,
      ci.status::text                                                 AS status,
      ci.subjective,
      ci.objective,
      ci.assessment,
      ci.plan,
      ci.free_text_content,
      ci.author_id,
      u.name                                                          AS author_name,
      ci.signed_at,
      ci.created_at
    FROM clinical_impressions ci
    LEFT JOIN users u ON u.id = ci.author_id
    WHERE ci.patient_id = ${patientId}
      AND ci.created_at >= NOW() - INTERVAL '30 days'
      AND ci.status::text = 'signed'
    ORDER BY COALESCE(ci.signed_at, ci.created_at) DESC
    LIMIT 40
  ` as Array<NoteRow>;

  // 9. Accepted proposals — last 30 days --------------------------------------
  const propRows = await sql`
    SELECT
      id,
      proposal_type::text                                             AS proposal_type,
      payload,
      confidence::float                                               AS confidence,
      status::text                                                    AS status,
      reviewed_at,
      applied_row_id,
      created_at
    FROM chart_update_proposals
    WHERE patient_id = ${patientId}
      AND status::text = 'accepted'
      AND created_at >= NOW() - INTERVAL '30 days'
    ORDER BY created_at DESC
    LIMIT 50
  ` as Array<ProposalRow>;

  // 10. Flatten source_ids for patient_brief_sources -------------------------
  const source_ids: BriefSourceRef[] = [];
  if (encounter) source_ids.push({ source_table: 'encounters', source_id: encounter.id });
  for (const r of conditionRows)  source_ids.push({ source_table: 'conditions',             source_id: r.id });
  for (const r of allergyRows)    source_ids.push({ source_table: 'allergy_intolerances',   source_id: r.id });
  for (const r of medRows)        source_ids.push({ source_table: 'medication_requests',    source_id: r.id });
  for (const r of labRows)        source_ids.push({ source_table: 'lab_results',            source_id: r.id });
  for (const r of vitalRows)      source_ids.push({ source_table: 'observations',           source_id: r.id });
  for (const r of noteRows)       source_ids.push({ source_table: 'clinical_impressions',   source_id: r.id });
  for (const r of propRows)       source_ids.push({ source_table: 'chart_update_proposals', source_id: r.id });

  return {
    patient,
    encounter,
    conditions:          conditionRows,
    allergies:           allergyRows,
    medications:         medRows,
    labs:                labRows,
    vitals:              vitalRows,
    notes:               noteRows,
    accepted_proposals:  propRows,
    source_ids,
  };
}
