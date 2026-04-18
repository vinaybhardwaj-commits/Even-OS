/**
 * resolve-chart-value — PC.2b1 (18 Apr 2026)
 *
 * Given a calculator_inputs.chart_source_path (dot-path string) and a
 * ChartContext assembled from the patient chart's in-memory state, returns
 * the best-guess pre-fill value for the calc input, plus a short source
 * label used in the "📋 from chart" badge.
 *
 * Design notes:
 * - Clinically safer to return `null` than to guess wrong. Any path we
 *   can't confidently resolve against the chart returns null, the field
 *   renders empty, and the clinician fills manually.
 * - Conditions/medications match by case-insensitive substring on the
 *   free-text `condition_name` / `medication_name` (no SNOMED codes yet).
 *   Best-effort prefill — the clinician still owns the final value.
 * - Vitals resolver picks the most recent observation for the relevant
 *   observation_type, then applies the path-specific threshold.
 * - The resolver never throws; any unknown path returns null.
 */

export interface ChartContextPatient {
  age?: number;
  sex?: string | null;
}

export interface ChartContextCondition {
  condition_name?: string;
  status?: string;
}

export interface ChartContextMedication {
  medication_name?: string;
  status?: string;
}

export interface ChartContextVital {
  observation_type: string;
  value: number;
  unit?: string;
  effective_datetime?: string;
}

export interface ChartContext {
  patient?: ChartContextPatient;
  conditions?: ChartContextCondition[];
  medications?: ChartContextMedication[];
  vitals?: ChartContextVital[];
}

export interface ResolvedChartValue {
  value: boolean | number | string;
  source: string;
}

function anyConditionMatches(conds: ChartContextCondition[] | undefined, needles: string[]): boolean {
  if (!conds || !conds.length) return false;
  const active = conds.filter(c => !c.status || /active|current|confirmed/i.test(c.status));
  for (const c of active) {
    const name = (c.condition_name || '').toLowerCase();
    for (const n of needles) if (name.includes(n)) return true;
  }
  return false;
}

function firstMatchedConditionName(conds: ChartContextCondition[] | undefined, needles: string[]): string | null {
  if (!conds || !conds.length) return null;
  for (const c of conds) {
    const name = (c.condition_name || '').toLowerCase();
    for (const n of needles) if (name.includes(n)) return c.condition_name || null;
  }
  return null;
}

function latestVital(vitals: ChartContextVital[] | undefined, obsType: string): ChartContextVital | null {
  if (!vitals || !vitals.length) return null;
  const matching = vitals.filter(v => v.observation_type === obsType);
  if (!matching.length) return null;
  matching.sort((a, b) => {
    const ta = a.effective_datetime ? new Date(a.effective_datetime).getTime() : 0;
    const tb = b.effective_datetime ? new Date(b.effective_datetime).getTime() : 0;
    return tb - ta;
  });
  return matching[0];
}

function rrBand(rr: number): string {
  if (rr < 9) return '<9';
  if (rr <= 11) return '9-11';
  if (rr <= 20) return '12-20';
  if (rr <= 24) return '21-24';
  return '>=25';
}

export function resolveChartValue(path: string | null | undefined, ctx: ChartContext): ResolvedChartValue | null {
  if (!path) return null;
  const p = path.trim();

  // patient.*
  if (p === 'patient.age_ge75') {
    const age = ctx.patient?.age;
    if (typeof age !== 'number' || !Number.isFinite(age)) return null;
    return { value: age >= 75, source: `age ${age}y` };
  }
  if (p === 'patient.age_65_74') {
    const age = ctx.patient?.age;
    if (typeof age !== 'number' || !Number.isFinite(age)) return null;
    return { value: age >= 65 && age <= 74, source: `age ${age}y` };
  }
  if (p === 'patient.age_gt65') {
    const age = ctx.patient?.age;
    if (typeof age !== 'number' || !Number.isFinite(age)) return null;
    return { value: age > 65, source: `age ${age}y` };
  }
  if (p === 'patient.female') {
    const sex = (ctx.patient?.sex || '').toLowerCase();
    if (!sex) return null;
    return { value: sex === 'female' || sex === 'f', source: `sex ${ctx.patient?.sex}` };
  }
  if (p === 'patient.age_band') {
    const age = ctx.patient?.age;
    if (typeof age !== 'number' || !Number.isFinite(age)) return null;
    if (age < 45) return { value: '<45', source: `age ${age}y` };
    if (age < 65) return { value: '45-64', source: `age ${age}y` };
    if (age < 75) return { value: '65-74', source: `age ${age}y` };
    return { value: '>=75', source: `age ${age}y` };
  }

  // conditions.*
  const condPaths: Record<string, string[]> = {
    'conditions.chf':            ['heart failure', 'chf', 'cardiac failure'],
    'conditions.hypertension':   ['hypertension', 'htn'],
    'conditions.diabetes':       ['diabetes', 'dm type', 'type 2 dm', 'type 1 dm', 't2dm', 't1dm'],
    'conditions.stroke_tia':     ['stroke', 'tia', 'transient ischaemic', 'thromboembol'],
    'conditions.stroke':         ['stroke'],
    'conditions.vascular':       ['myocardial infarction', ' mi ', 'peripheral arterial', 'pad', 'aortic plaque'],
    'conditions.bleeding':       ['bleed', 'haemorrhage', 'hemorrhage'],
    'conditions.prior_dvt':      ['dvt', 'deep vein'],
    'conditions.prior_vte':      ['vte', 'pe ', 'pulmonary embolism', 'dvt', 'deep vein'],
    'conditions.active_cancer':  ['cancer', 'malignan', 'carcinoma', 'neoplasm'],
  };
  if (condPaths[p]) {
    const needles = condPaths[p];
    const hit = anyConditionMatches(ctx.conditions, needles);
    if (!hit) return null;
    const name = firstMatchedConditionName(ctx.conditions, needles) || 'condition';
    return { value: true, source: name };
  }

  // vitals.*
  if (p === 'vitals.sbp_gt_160') {
    const sbp = latestVital(ctx.vitals, 'blood_pressure_systolic');
    if (!sbp) return null;
    return { value: Number(sbp.value) > 160, source: `SBP ${sbp.value}` };
  }
  if (p === 'vitals.hr_gt_100') {
    const hr = latestVital(ctx.vitals, 'heart_rate') || latestVital(ctx.vitals, 'pulse');
    if (!hr) return null;
    return { value: Number(hr.value) > 100, source: `HR ${hr.value}` };
  }
  if (p === 'vitals.rr_band') {
    const rr = latestVital(ctx.vitals, 'respiratory_rate');
    if (!rr) return null;
    return { value: rrBand(Number(rr.value)), source: `RR ${rr.value}` };
  }

  // v1: labs.*, neuro.*, medications.* — unresolved (clinician fills manually)
  return null;
}
