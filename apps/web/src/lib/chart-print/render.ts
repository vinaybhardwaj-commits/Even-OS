/**
 * Patient Chart Overhaul — PC.4.D.2.3 — Render orchestrator.
 *
 * Takes a scope string + a chart data bundle and returns a rendered PDF as a
 * Buffer, plus a pageCount hint (unreliable in @react-pdf before paint; the
 * router post-parses the buffer with pdf-parse to patch page_count on audit).
 *
 * Exposes:
 *   - loadChartBundle(hospitalId, patientId): gathers patient + hospital
 *     + encounter + allergies + conditions + latest-vitals + brief + notes
 *     + active meds + last-72h MAR + lab orders + lab results. One-stop
 *     data fetch — templates are presentational only.
 *   - renderChartPrint(scope, bundle, meta): picks a template and renders.
 *
 * Scope routing (D.2.3 + D.3.1):
 *   tab_overview     | overview    → OverviewTemplate
 *   tab_brief        | brief       → BriefTemplate
 *   tab_notes        | notes       → NotesTemplate
 *   tab_meds         | meds        → MedsTemplate
 *   tab_labs         | labs        → LabsTemplate
 *   tab_orders       | orders      → OrdersTemplate      (D.3.1)
 *   tab_calculators  | calculators → CalculatorsTemplate (D.3.1)
 *   tab_documents    | documents   → DocumentsTemplate   (D.3.1, manifest only)
 *   other → returns null from normaliseScope (caller maps to status='failed').
 *
 * Scope aliases exist because the storage schema comment says "tab_overview"
 * but the PC.4.D.1 placeholder call site passed "tab:overview". Accept both,
 * normalise at the API boundary.
 */

import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { OverviewTemplate, type OverviewProps } from './templates/overview';
import { BriefTemplate, type BriefProps } from './templates/brief';
import { NotesTemplate, type NotesProps } from './templates/notes';
import { MedsTemplate, type MedsProps } from './templates/meds';
import { LabsTemplate, type LabsProps } from './templates/labs';
import { OrdersTemplate, type OrdersProps } from './templates/orders';
import { CalculatorsTemplate, type CalculatorsProps } from './templates/calculators';
import { DocumentsTemplate, type DocumentsProps } from './templates/documents';
import { JourneyTemplate, type JourneyProps } from './templates/journey';
import type { ChartPrintPageProps } from './pdf-components';

export type ScopeId =
  | 'overview'
  | 'brief'
  | 'notes'
  | 'meds'
  | 'labs'
  | 'orders'
  | 'calculators'
  | 'documents'
  | 'journey';

export function normaliseScope(raw: string): ScopeId | null {
  const s = raw.toLowerCase().replace(/^tab[_:.-]/, '');
  if (s === 'overview') return 'overview';
  if (s === 'brief') return 'brief';
  if (s === 'notes') return 'notes';
  if (s === 'meds' || s === 'medications') return 'meds';
  if (s === 'labs' || s === 'laboratory') return 'labs';
  if (s === 'orders') return 'orders';
  if (s === 'calculators' || s === 'calculator') return 'calculators';
  if (s === 'documents' || s === 'document') return 'documents';
  if (s === 'journey' || s === 'patient_journey') return 'journey';
  return null;
}

export type NoteRow = {
  id: string;
  note_type: string;
  status: string;
  author_name: string | null;
  signed_by_name: string | null;
  created_at: string;
  signed_at: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  shift_summary: string | null;
  procedure_name: string | null;
  free_text_content: string | null;
};

export type ActiveMedRow = {
  id: string;
  drug_name: string;
  generic_name: string | null;
  dose_quantity: string | null;
  dose_unit: string | null;
  route: string | null;
  frequency_code: string | null;
  is_prn: boolean;
  is_high_alert: boolean;
  narcotics_class: string;
  prescriber_name: string | null;
  start_date: string | null;
  end_date: string | null;
  instructions: string | null;
};

export type MarRow = {
  id: string;
  drug_name: string;
  scheduled_datetime: string;
  administered_datetime: string | null;
  status: string;
  dose_given: string | null;
  dose_unit: string | null;
  administered_by_name: string | null;
  not_done_reason: string | null;
  hold_reason: string | null;
};

export type LabOrderRow = {
  id: string;
  panel_name: string | null;
  order_number: string;
  status: string;
  urgency: string;
  ordered_at: string;
  resulted_at: string | null;
  is_critical: boolean;
};

export type LabResultRow = {
  order_id: string;
  test_code: string;
  test_name: string;
  value_numeric: string | null;
  value_text: string | null;
  unit: string | null;
  ref_range_low: string | null;
  ref_range_high: string | null;
  ref_range_text: string | null;
  flag: string;
  is_critical: boolean;
  resulted_at: string;
};

// D.3.1 — Non-medication orders (union of clinical_orders + service_requests).
export type OrderRow = {
  id: string;
  source: 'clinical_order' | 'service_request';
  order_type: string;              // lab | radiology | imaging | pharmacy | procedure | diet | nursing | referral
  order_status: string;            // draft | ordered | requested | in_progress | completed | cancelled | ...
  priority: string | null;         // routine | urgent | stat
  order_code: string | null;
  order_name: string;
  description: string | null;
  quantity: number | null;
  frequency: string | null;
  duration_days: number | null;
  instructions: string | null;
  route: string | null;
  dosage: string | null;
  test_code: string | null;
  modality: string | null;
  body_part: string | null;
  clinical_indication: string | null;
  is_critical: boolean;            // only true for service_requests with critical results
  ordered_by_name: string | null;
  ordered_at: string;              // iso
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

// D.3.1 — Calculator result rows (latest per calc).
export type CalcResultRow = {
  id: string;
  calc_id: string;
  calc_slug: string;
  calc_name: string | null;
  calc_version: string;
  score: string;                   // stringified numeric
  band_key: string;
  band_label: string | null;
  band_color: string | null;
  band_interpretation_default: string | null;
  prose_text: string | null;
  prose_status: string;            // pending | ready | reviewed | declined | added
  inputs: Record<string, unknown>;
  run_by_user_name: string;
  run_by_user_role: string;
  ran_at: string;                  // iso
};

// D.3.1 — Document manifest rows (mrd_document_references, non-deleted).
export type DocumentManifestRow = {
  id: string;
  document_type: string;
  document_class_confidence: string | null;
  blob_url: string | null;
  blob_hash: string | null;
  content_type: string | null;
  file_size_bytes: string | null;
  scanned_at: string | null;
  created_at: string;
  uploaded_by: string | null;
  contains_phi: boolean;
  contains_pii: boolean;
  status: string;
};

export type JourneyStepRow = {
  id: string;
  phase: string;              // journey_phase enum value (PHASE_1_PRE_ADMISSION ..)
  step_number: string;        // e.g., '1.1', '2.5'
  step_name: string;
  status: string;             // journey_step_status enum (pending, in_progress, completed, blocked, skipped, not_applicable)
  owner_role: string;
  tat_target_mins: number | null;
  tat_actual_mins: number | null;
  started_at: string | null;
  completed_at: string | null;
  blocked_reason: string | null;
  skipped_reason: string | null;
};

export type ChartBundle = {
  hospital: { id: string; name: string };
  patient: {
    id: string;
    uhid: string;
    name_full: string;
    gender: string | null;
    dob: string | null;
    blood_group: string | null;
    phone: string | null;
  };
  encounter: {
    id: string;
    encounter_class: string;
    status: string;
    chief_complaint: string | null;
    preliminary_diagnosis_icd10: string | null;
    admission_at: string | null;
    discharge_at: string | null;
    attending_name: string | null;
  } | null;
  allergies: Array<{
    substance: string;
    reaction: string | null;
    severity: string;
    criticality: string;
    verification_status: string;
  }>;
  conditions: Array<{
    icd10_code: string | null;
    condition_name: string;
    clinical_status: string;
    severity: string | null;
    onset_date: string | null;
  }>;
  latestVitals: {
    recorded_at: string;
    temperature_c: string | null;
    pulse_bpm: number | null;
    resp_rate: number | null;
    bp: string | null;
    spo2_percent: string | null;
    pain_score: number | null;
  } | null;
  brief: {
    id: string;
    version: number;
    narrative: string;
    structured: any;
    generated_at: string;
    is_stale: boolean;
    hallucination_flags_count: number;
  } | null;
  notes: NoteRow[];
  activeMeds: ActiveMedRow[];
  mar: MarRow[];
  labOrders: LabOrderRow[];
  labResults: LabResultRow[];
  // D.3.1
  orders: OrderRow[];
  calcResults: CalcResultRow[];
  documents: DocumentManifestRow[];
  // D.3.2
  journeySteps: JourneyStepRow[];
};

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

/**
 * Gather everything a D.2.3 template needs in one pass. Each query is scoped
 * to the caller's hospital_id — the router has already verified the patient
 * belongs there, but we re-scope here as defence in depth.
 */
export async function loadChartBundle(
  hospitalId: string,
  patientId: string,
): Promise<ChartBundle> {
  const sql = getSql();

  const hospitalRows = (await sql`
    SELECT hospital_id AS id, name
      FROM hospitals
     WHERE hospital_id = ${hospitalId}
     LIMIT 1
  `) as Array<{ id: string; name: string }>;
  const hospital = hospitalRows[0] ?? { id: hospitalId, name: hospitalId };

  const patientRows = (await sql`
    SELECT id, uhid, name_full, gender, dob, blood_group, phone
      FROM patients
     WHERE id = ${patientId}::uuid
       AND hospital_id = ${hospitalId}
     LIMIT 1
  `) as Array<ChartBundle['patient']>;
  if (patientRows.length === 0) {
    throw new Error('patient not found or hospital mismatch');
  }
  const patient = patientRows[0];

  const encRows = (await sql`
    SELECT e.id, e.encounter_class, e.status, e.chief_complaint,
           e.preliminary_diagnosis_icd10, e.admission_at, e.discharge_at,
           u.full_name AS attending_name
      FROM encounters e
      LEFT JOIN users u ON u.id = e.attending_practitioner_id
     WHERE e.patient_id = ${patientId}::uuid
       AND e.hospital_id = ${hospitalId}
     ORDER BY COALESCE(e.admission_at, e.created_at) DESC
     LIMIT 1
  `) as Array<any>;
  const encounter = encRows[0] ?? null;

  const allergyRows = (await sql`
    SELECT substance, reaction, severity, criticality, verification_status
      FROM allergy_intolerances
     WHERE patient_id = ${patientId}::uuid
       AND hospital_id = ${hospitalId}
       AND is_deleted = false
     ORDER BY
       CASE criticality WHEN 'high' THEN 0 WHEN 'low' THEN 2 ELSE 1 END,
       substance
     LIMIT 25
  `) as ChartBundle['allergies'];

  const conditionRows = (await sql`
    SELECT icd10_code, condition_name, clinical_status, severity, onset_date
      FROM conditions
     WHERE patient_id = ${patientId}::uuid
       AND hospital_id = ${hospitalId}
       AND is_deleted = false
       AND clinical_status IN ('active','recurrence','relapse')
     ORDER BY onset_date DESC NULLS LAST, condition_name
     LIMIT 25
  `) as ChartBundle['conditions'];

  const vitalRows = (await sql`
    SELECT recorded_at,
           temperature_c::text AS temperature_c,
           pulse_bpm, resp_rate,
           CASE
             WHEN bp_systolic IS NOT NULL AND bp_diastolic IS NOT NULL
               THEN bp_systolic || '/' || bp_diastolic
             ELSE NULL
           END AS bp,
           spo2_percent::text AS spo2_percent,
           pain_score
      FROM vital_signs
     WHERE patient_id = ${patientId}::uuid
       AND hospital_id = ${hospitalId}
     ORDER BY recorded_at DESC
     LIMIT 1
  `) as Array<NonNullable<ChartBundle['latestVitals']>>;
  const latestVitals = vitalRows[0] ?? null;

  const briefRows = (await sql`
    SELECT id, version, narrative, structured, generated_at, is_stale,
           jsonb_array_length(COALESCE(hallucination_flags, '[]'::jsonb)) AS hf_count
      FROM patient_briefs
     WHERE patient_id = ${patientId}::uuid
       AND hospital_id = ${hospitalId}
       AND is_stale = false
     ORDER BY version DESC
     LIMIT 1
  `) as Array<any>;
  const brief = briefRows[0]
    ? {
        id: briefRows[0].id,
        version: briefRows[0].version,
        narrative: briefRows[0].narrative,
        structured: briefRows[0].structured,
        generated_at: briefRows[0].generated_at,
        is_stale: briefRows[0].is_stale,
        hallucination_flags_count: Number(briefRows[0].hf_count ?? 0),
      }
    : null;

  // --- D.2.3: Notes (last 30, signed/final first) ---
  const noteRows = (await sql`
    SELECT ci.id,
           ci.note_type::text AS note_type,
           ci.status::text AS status,
           ua.full_name AS author_name,
           us.full_name AS signed_by_name,
           ci.created_at,
           ci.signed_at,
           ci.subjective, ci.objective, ci.assessment, ci.plan,
           ci.shift_summary, ci.procedure_name, ci.free_text_content
      FROM clinical_impressions ci
      LEFT JOIN users ua ON ua.id = ci.author_id
      LEFT JOIN users us ON us.id = ci.signed_by_user_id
     WHERE ci.patient_id = ${patientId}::uuid
       AND ci.hospital_id = ${hospitalId}
     ORDER BY COALESCE(ci.signed_at, ci.created_at) DESC
     LIMIT 30
  `) as Array<any>;
  const notes: NoteRow[] = noteRows.map((r) => ({
    id: r.id,
    note_type: r.note_type,
    status: r.status,
    author_name: r.author_name ?? null,
    signed_by_name: r.signed_by_name ?? null,
    created_at: r.created_at,
    signed_at: r.signed_at ?? null,
    subjective: r.subjective ?? null,
    objective: r.objective ?? null,
    assessment: r.assessment ?? null,
    plan: r.plan ?? null,
    shift_summary: r.shift_summary ?? null,
    procedure_name: r.procedure_name ?? null,
    free_text_content: r.free_text_content ?? null,
  }));

  // --- D.2.3: Active meds (currently prescribed) ---
  const medRows = (await sql`
    SELECT mr.id,
           mr.drug_name, mr.generic_name,
           mr.dose_quantity::text AS dose_quantity,
           mr.dose_unit, mr.route, mr.frequency_code,
           COALESCE(mr.is_prn, false) AS is_prn,
           COALESCE(mr.is_high_alert, false) AS is_high_alert,
           mr.narcotics_class::text AS narcotics_class,
           u.full_name AS prescriber_name,
           mr.start_date, mr.end_date, mr.instructions
      FROM medication_requests mr
      LEFT JOIN users u ON u.id = mr.prescriber_id
     WHERE mr.patient_id = ${patientId}::uuid
       AND mr.hospital_id = ${hospitalId}
       AND mr.med_req_status IN ('active','on_hold')
       AND (mr.end_date IS NULL OR mr.end_date > NOW())
     ORDER BY mr.is_high_alert DESC, mr.drug_name
     LIMIT 100
  `) as Array<any>;
  const activeMeds: ActiveMedRow[] = medRows.map((r) => ({
    id: r.id,
    drug_name: r.drug_name,
    generic_name: r.generic_name ?? null,
    dose_quantity: r.dose_quantity ?? null,
    dose_unit: r.dose_unit ?? null,
    route: r.route ?? null,
    frequency_code: r.frequency_code ?? null,
    is_prn: Boolean(r.is_prn),
    is_high_alert: Boolean(r.is_high_alert),
    narcotics_class: r.narcotics_class ?? 'none',
    prescriber_name: r.prescriber_name ?? null,
    start_date: r.start_date ?? null,
    end_date: r.end_date ?? null,
    instructions: r.instructions ?? null,
  }));

  // --- D.2.3: MAR (last 72 hours of administrations) ---
  const marRows = (await sql`
    SELECT ma.id,
           mr.drug_name,
           ma.scheduled_datetime,
           ma.administered_datetime,
           ma.med_admin_status::text AS status,
           ma.dose_given::text AS dose_given,
           ma.admin_dose_unit AS dose_unit,
           u.full_name AS administered_by_name,
           ma.not_done_reason,
           ma.hold_reason
      FROM medication_administrations ma
      JOIN medication_requests mr ON mr.id = ma.medication_request_id
      LEFT JOIN users u ON u.id = ma.administered_by
     WHERE ma.patient_id = ${patientId}::uuid
       AND ma.hospital_id = ${hospitalId}
       AND ma.scheduled_datetime >= NOW() - INTERVAL '72 hours'
     ORDER BY ma.scheduled_datetime DESC
     LIMIT 200
  `) as Array<any>;
  const mar: MarRow[] = marRows.map((r) => ({
    id: r.id,
    drug_name: r.drug_name,
    scheduled_datetime: r.scheduled_datetime,
    administered_datetime: r.administered_datetime ?? null,
    status: r.status,
    dose_given: r.dose_given ?? null,
    dose_unit: r.dose_unit ?? null,
    administered_by_name: r.administered_by_name ?? null,
    not_done_reason: r.not_done_reason ?? null,
    hold_reason: r.hold_reason ?? null,
  }));

  // --- D.2.3: Lab orders (last 30 days, max 50) ---
  const labOrderRows = (await sql`
    SELECT id,
           lo_panel_name AS panel_name,
           lo_order_number AS order_number,
           lo_status::text AS status,
           lo_urgency::text AS urgency,
           lo_ordered_at AS ordered_at,
           lo_resulted_at AS resulted_at,
           COALESCE(lo_is_critical, false) AS is_critical
      FROM lab_orders
     WHERE lo_patient_id = ${patientId}::uuid
       AND hospital_id = ${hospitalId}
       AND lo_ordered_at >= NOW() - INTERVAL '30 days'
     ORDER BY lo_ordered_at DESC
     LIMIT 50
  `) as Array<any>;
  const labOrders: LabOrderRow[] = labOrderRows.map((r) => ({
    id: r.id,
    panel_name: r.panel_name ?? null,
    order_number: r.order_number,
    status: r.status,
    urgency: r.urgency,
    ordered_at: r.ordered_at,
    resulted_at: r.resulted_at ?? null,
    is_critical: Boolean(r.is_critical),
  }));

  // --- D.2.3: Lab results for the orders above ---
  const orderIds = labOrders.map((o) => o.id);
  let labResults: LabResultRow[] = [];
  if (orderIds.length > 0) {
    const labResultRows = (await sql`
      SELECT lr_order_id AS order_id,
             lr_test_code AS test_code,
             lr_test_name AS test_name,
             value_numeric::text AS value_numeric,
             value_text,
             lr_unit AS unit,
             lr_ref_range_low::text AS ref_range_low,
             lr_ref_range_high::text AS ref_range_high,
             lr_ref_range_text AS ref_range_text,
             lr_flag::text AS flag,
             COALESCE(lr_is_critical, false) AS is_critical,
             lr_resulted_at AS resulted_at
        FROM lab_results
       WHERE hospital_id = ${hospitalId}
         AND lr_order_id = ANY(${orderIds}::uuid[])
       ORDER BY lr_resulted_at DESC, lr_test_name
       LIMIT 500
    `) as Array<any>;
    labResults = labResultRows.map((r) => ({
      order_id: r.order_id,
      test_code: r.test_code,
      test_name: r.test_name,
      value_numeric: r.value_numeric ?? null,
      value_text: r.value_text ?? null,
      unit: r.unit ?? null,
      ref_range_low: r.ref_range_low ?? null,
      ref_range_high: r.ref_range_high ?? null,
      ref_range_text: r.ref_range_text ?? null,
      flag: r.flag ?? 'normal',
      is_critical: Boolean(r.is_critical),
      resulted_at: r.resulted_at,
    }));
  }

  // --- D.3.1: Orders (clinical_orders UNION service_requests, last 30d) ---
  const clinOrderRows = (await sql`
    SELECT co.id,
           'clinical_order'::text      AS source,
           co.order_type::text         AS order_type,
           co.order_status::text       AS order_status,
           co.priority::text           AS priority,
           co.order_code,
           co.order_name,
           co.description,
           co.quantity,
           co.frequency,
           co.duration_days,
           co.instructions,
           co.route,
           co.dosage,
           NULL::text                  AS test_code,
           NULL::text                  AS modality,
           NULL::text                  AS body_part,
           NULL::text                  AS clinical_indication,
           false                       AS is_critical,
           u.full_name                 AS ordered_by_name,
           co.ordered_at,
           co.completed_at,
           co.cancelled_at,
           co.cancel_reason
      FROM clinical_orders co
      LEFT JOIN users u ON u.id = co.ordered_by_user_id
     WHERE co.patient_id = ${patientId}::uuid
       AND co.hospital_id = ${hospitalId}
       AND co.ordered_at >= NOW() - INTERVAL '30 days'
     ORDER BY co.ordered_at DESC
     LIMIT 100
  `) as Array<any>;

  const svcReqRows = (await sql`
    SELECT sr.id,
           'service_request'::text     AS source,
           sr.request_type::text       AS order_type,
           sr.status::text             AS order_status,
           sr.sr_priority              AS priority,
           sr.sr_order_code            AS order_code,
           sr.sr_order_name            AS order_name,
           NULL::text                  AS description,
           NULL::integer               AS quantity,
           NULL::text                  AS frequency,
           NULL::integer               AS duration_days,
           sr.sr_instructions          AS instructions,
           NULL::text                  AS route,
           NULL::text                  AS dosage,
           sr.test_code,
           sr.modality,
           sr.body_part,
           sr.clinical_indication,
           COALESCE(sr.is_critical, false) AS is_critical,
           u.full_name                 AS ordered_by_name,
           sr.sr_ordered_at            AS ordered_at,
           sr.sr_completed_at          AS completed_at,
           sr.sr_cancelled_at          AS cancelled_at,
           sr.sr_cancel_reason         AS cancel_reason
      FROM service_requests sr
      LEFT JOIN users u ON u.id = sr.requester_id
     WHERE sr.patient_id = ${patientId}::uuid
       AND sr.hospital_id = ${hospitalId}
       AND sr.sr_ordered_at >= NOW() - INTERVAL '30 days'
     ORDER BY sr.sr_ordered_at DESC
     LIMIT 100
  `) as Array<any>;

  const mergedOrders: OrderRow[] = [...clinOrderRows, ...svcReqRows].map((r) => ({
    id: r.id,
    source: r.source,
    order_type: r.order_type ?? 'other',
    order_status: r.order_status ?? 'ordered',
    priority: r.priority ?? null,
    order_code: r.order_code ?? null,
    order_name: r.order_name ?? '',
    description: r.description ?? null,
    quantity: r.quantity ?? null,
    frequency: r.frequency ?? null,
    duration_days: r.duration_days ?? null,
    instructions: r.instructions ?? null,
    route: r.route ?? null,
    dosage: r.dosage ?? null,
    test_code: r.test_code ?? null,
    modality: r.modality ?? null,
    body_part: r.body_part ?? null,
    clinical_indication: r.clinical_indication ?? null,
    is_critical: Boolean(r.is_critical),
    ordered_by_name: r.ordered_by_name ?? null,
    ordered_at: r.ordered_at,
    completed_at: r.completed_at ?? null,
    cancelled_at: r.cancelled_at ?? null,
    cancel_reason: r.cancel_reason ?? null,
  }));
  mergedOrders.sort((a, b) => (b.ordered_at ?? '').localeCompare(a.ordered_at ?? ''));
  const orders = mergedOrders.slice(0, 100);

  // --- D.3.1: Calculators — latest run per calc_id ---
  const calcRows = (await sql`
    SELECT cr.id,
           cr.calc_id,
           cr.calc_slug,
           cr.calc_version,
           cr.score::text         AS score,
           cr.band_key,
           cr.prose_text,
           cr.prose_status,
           cr.inputs,
           cr.run_by_user_name,
           cr.run_by_user_role,
           cr.ran_at,
           c.name                 AS calc_name,
           cb.label               AS band_label,
           cb.color               AS band_color,
           cb.interpretation_default AS band_interpretation_default
      FROM calculator_results cr
      LEFT JOIN calculators c ON c.id = cr.calc_id
      LEFT JOIN calculator_bands cb ON cb.calc_id = cr.calc_id AND cb.band_key = cr.band_key
     WHERE cr.patient_id = ${patientId}::uuid
       AND cr.hospital_id = ${hospitalId}
       AND cr.ran_at = (
         SELECT MAX(cr2.ran_at)
           FROM calculator_results cr2
          WHERE cr2.patient_id = cr.patient_id
            AND cr2.hospital_id = cr.hospital_id
            AND cr2.calc_id = cr.calc_id
       )
     ORDER BY cr.ran_at DESC
     LIMIT 50
  `) as Array<any>;

  const calcResults: CalcResultRow[] = calcRows.map((r) => {
    let inputs: Record<string, unknown> = {};
    try {
      inputs = typeof r.inputs === 'string' ? JSON.parse(r.inputs) : (r.inputs ?? {});
    } catch {
      inputs = {};
    }
    return {
      id: r.id,
      calc_id: r.calc_id,
      calc_slug: r.calc_slug,
      calc_name: r.calc_name ?? null,
      calc_version: r.calc_version,
      score: r.score,
      band_key: r.band_key,
      band_label: r.band_label ?? null,
      band_color: r.band_color ?? null,
      band_interpretation_default: r.band_interpretation_default ?? null,
      prose_text: r.prose_text ?? null,
      prose_status: r.prose_status ?? 'pending',
      inputs,
      run_by_user_name: r.run_by_user_name,
      run_by_user_role: r.run_by_user_role,
      ran_at: r.ran_at,
    };
  });

  // --- D.3.1: Documents manifest (mrd_document_references, non-deleted) ---
  const docRows = (await sql`
    SELECT id,
           document_type,
           document_class_confidence,
           blob_url,
           blob_hash,
           content_type,
           file_size_bytes,
           scanned_at,
           created_at,
           uploaded_by,
           COALESCE(contains_phi, false) AS contains_phi,
           COALESCE(contains_pii, false) AS contains_pii,
           status
      FROM mrd_document_references
     WHERE patient_id = ${patientId}::uuid
       AND COALESCE(status, 'current') <> 'deleted'
       AND deleted_at IS NULL
     ORDER BY COALESCE(scanned_at, created_at) DESC
     LIMIT 200
  `) as Array<any>;

  const documents: DocumentManifestRow[] = docRows.map((r) => ({
    id: r.id,
    document_type: r.document_type ?? 'other',
    document_class_confidence: r.document_class_confidence ?? null,
    blob_url: r.blob_url ?? null,
    blob_hash: r.blob_hash ?? null,
    content_type: r.content_type ?? null,
    file_size_bytes: r.file_size_bytes ?? null,
    scanned_at: r.scanned_at ?? null,
    created_at: r.created_at,
    uploaded_by: r.uploaded_by ?? null,
    contains_phi: Boolean(r.contains_phi),
    contains_pii: Boolean(r.contains_pii),
    status: r.status ?? 'current',
  }));

  // ---- Journey steps (patient_journey_steps) — D.3.2 ----
  // Scope to hospital + patient. Don't filter by encounter — pre-admission
  // steps legitimately have encounter_id = NULL, and we want the whole
  // journey on the PDF. Orders by phase + step_number.
  const journeyRows = (await sql`
    SELECT id,
           phase::text AS phase,
           step_number,
           step_name,
           status::text AS status,
           owner_role,
           tat_target_mins,
           tat_actual_mins,
           started_at,
           completed_at,
           blocked_reason,
           skipped_reason
      FROM patient_journey_steps
     WHERE hospital_id = ${hospitalId}
       AND patient_id = ${patientId}::uuid
     ORDER BY phase ASC, step_number ASC
     LIMIT 500
  `) as Array<any>;

  const journeySteps: JourneyStepRow[] = journeyRows.map((r) => ({
    id: r.id,
    phase: r.phase,
    step_number: r.step_number,
    step_name: r.step_name,
    status: r.status,
    owner_role: r.owner_role,
    tat_target_mins: r.tat_target_mins != null ? Number(r.tat_target_mins) : null,
    tat_actual_mins: r.tat_actual_mins != null ? Number(r.tat_actual_mins) : null,
    started_at: r.started_at ?? null,
    completed_at: r.completed_at ?? null,
    blocked_reason: r.blocked_reason ?? null,
    skipped_reason: r.skipped_reason ?? null,
  }));

  return {
    hospital,
    patient,
    encounter,
    allergies: allergyRows,
    conditions: conditionRows,
    latestVitals,
    brief,
    notes,
    activeMeds,
    mar,
    labOrders,
    labResults,
    orders,
    calcResults,
    documents,
    journeySteps,
  };
}

export type RenderMeta = Pick<
  ChartPrintPageProps,
  'watermarkLine' | 'exportedByLine' | 'printIdShort' | 'tabLabel'
>;

export async function renderChartPrint(
  scope: ScopeId,
  bundle: ChartBundle,
  meta: RenderMeta,
): Promise<{ buffer: Buffer; bytes: number }> {
  const common = {
    hospitalName: bundle.hospital.name,
    patientNameUhid: `${bundle.patient.name_full} · UHID ${bundle.patient.uhid}`,
    encounterLabel: bundle.encounter
      ? `${bundle.encounter.encounter_class.toUpperCase()} · ${
          bundle.encounter.status
        }`
      : undefined,
    tabLabel: meta.tabLabel,
    exportedByLine: meta.exportedByLine,
    watermarkLine: meta.watermarkLine,
    printIdShort: meta.printIdShort,
  };

  let doc: React.ReactElement;
  switch (scope) {
    case 'overview': {
      const props: OverviewProps = { bundle, chrome: common };
      doc = React.createElement(OverviewTemplate, props);
      break;
    }
    case 'brief': {
      const props: BriefProps = { bundle, chrome: common };
      doc = React.createElement(BriefTemplate, props);
      break;
    }
    case 'notes': {
      const props: NotesProps = { bundle, chrome: common };
      doc = React.createElement(NotesTemplate, props);
      break;
    }
    case 'meds': {
      const props: MedsProps = { bundle, chrome: common };
      doc = React.createElement(MedsTemplate, props);
      break;
    }
    case 'labs': {
      const props: LabsProps = { bundle, chrome: common };
      doc = React.createElement(LabsTemplate, props);
      break;
    }
    case 'orders': {
      const props: OrdersProps = { bundle, chrome: common };
      doc = React.createElement(OrdersTemplate, props);
      break;
    }
    case 'calculators': {
      const props: CalculatorsProps = { bundle, chrome: common };
      doc = React.createElement(CalculatorsTemplate, props);
      break;
    }
    case 'documents': {
      const props: DocumentsProps = { bundle, chrome: common };
      doc = React.createElement(DocumentsTemplate, props);
      break;
    }
    case 'journey': {
      const props: JourneyProps = { bundle, chrome: common };
      doc = React.createElement(JourneyTemplate, props);
      break;
    }
  }

  const buffer = await renderToBuffer(doc);
  return { buffer, bytes: buffer.length };
}

/**
 * Compose the audit watermark string per D.2 lock #4. Stored denorm on the
 * chart_print_exports row AND drawn per-page. Format:
 *   "{user_name} · {role} · {timestamp IST} · UHID {uhid}"
 */
export function composeWatermark(params: {
  userName: string;
  userRole: string;
  timestampIso: string;
  uhid: string;
}): string {
  const istDate = new Date(params.timestampIso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return `${params.userName} · ${params.userRole} · ${istDate} IST · UHID ${params.uhid}`;
}

export function composeExportedByLine(params: {
  userName: string;
  userRole: string;
  timestampIso: string;
}): string {
  const istDate = new Date(params.timestampIso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return `Printed by ${params.userName} (${params.userRole}) · ${istDate} IST`;
}
