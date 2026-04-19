/**
 * Patient Chart Overhaul — PC.4.D.2.2 — Render orchestrator.
 *
 * Takes a scope string + a chart data bundle and returns a rendered PDF as a
 * Buffer, plus a pageCount hint (unreliable in @react-pdf before paint; we
 * count after rendering).
 *
 * Exposes:
 *   - loadChartBundle(sql, hospitalId, patientId): gathers patient + hospital
 *     + encounter + allergies + conditions + latest-vitals + brief. One-stop
 *     data fetch — templates are presentational only.
 *   - renderChartPrint(scope, bundle, meta): picks a template and renders.
 *
 * Scope routing (D.2.2):
 *   tab_overview | tab:overview | overview → OverviewTemplate
 *   tab_brief | tab:brief | brief → BriefTemplate
 *   other → throws (caller should turn into status='failed').
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
import type { ChartPrintPageProps } from './pdf-components';

export type ScopeId = 'overview' | 'brief';

export function normaliseScope(raw: string): ScopeId | null {
  const s = raw.toLowerCase().replace(/^tab[_:.-]/, '');
  if (s === 'overview') return 'overview';
  if (s === 'brief') return 'brief';
  return null;
}

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
};

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

/**
 * Gather everything a D.2.2 template needs in one pass. Each query is scoped
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

  return { hospital, patient, encounter, allergies: allergyRows, conditions: conditionRows, latestVitals, brief };
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
  if (scope === 'overview') {
    const props: OverviewProps = { bundle, chrome: common };
    doc = React.createElement(OverviewTemplate, props);
  } else {
    const props: BriefProps = { bundle, chrome: common };
    doc = React.createElement(BriefTemplate, props);
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
