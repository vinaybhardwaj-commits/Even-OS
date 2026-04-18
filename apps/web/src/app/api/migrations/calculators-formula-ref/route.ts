import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.2c1 migration — adds `formula_ref` column to calculators and
 * upserts the MELD 3.0 fixture (named-formula dispatch).
 *
 * Idempotent: re-running overwrites the MELD_3_0 row + wipes/re-inserts
 * children (matches drizzle/seed-calculators.ts behaviour).
 *
 * GET-only. Calling once from the browser as a super_admin is enough.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const HOSPITAL_ID = process.env.HOSPITAL_ID ?? 'EHRC';
  const steps: string[] = [];

  try {
    // ── 1. Schema change ─────────────────────────────────────────────
    await sql`ALTER TABLE calculators ADD COLUMN IF NOT EXISTS formula_ref text NULL`;
    steps.push('ALTER TABLE calculators ADD COLUMN formula_ref');

    await sql`COMMENT ON COLUMN calculators.formula_ref IS ${
      'Optional named-formula key. When set, scoring engine dispatches to ' +
      'lib/calculators/formulas[formula_ref] instead of running rule-based ' +
      'scoring. Used for non-linear calculators like MELD 3.0.'
    }`;
    steps.push('COMMENT on formula_ref');

    // ── 2. Verify column present ─────────────────────────────────────
    const colCheck = (await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'calculators' AND column_name = 'formula_ref'
    `) as Array<{ column_name: string; data_type: string }>;
    if (colCheck.length !== 1) {
      throw new Error('formula_ref column missing after ALTER');
    }
    steps.push(`verified formula_ref (${colCheck[0].data_type})`);

    // ── 3. Upsert MELD 3.0 fixture ────────────────────────────────────
    const slug = 'meld-3-0';
    const name = 'MELD 3.0 (2022 UNOS)';
    const specialty = 'gastroenterology';
    const shortDesc = 'Exact MELD 3.0 (sex + albumin adjusted) — used for U.S. liver allocation.';
    const longDesc =
      'MELD 3.0 is the 2022 OPTN/UNOS score for liver-allocation priority. ' +
      'It extends MELD-Na with sex and albumin adjustments (Kim WR et al., Gastroenterology 2021). ' +
      'Clamps applied per UNOS rules: creatinine [1.0-3.0], bilirubin ≥1.0, INR ≥1.0, ' +
      'albumin [1.5-3.5], sodium [125-137]. Patients on dialysis ≥2×/week or 24h CVVH use Cr=3.0. ' +
      'Final score clamped to [6, 40]. Scoring is deterministic, server-side, via the ' +
      'named-formula registry (formula_ref: meld_3_0).';
    const version = '1.0';
    const pinRoles = JSON.stringify(['doctor', 'gastroenterologist', 'hepatologist', 'consultant']);
    const citation =
      'Kim WR et al. Gastroenterology 2021;161:1887-1895. ' +
      'doi:10.1053/j.gastro.2021.08.050. OPTN policy eff. 2023-07-11.';
    const formulaRef = 'meld_3_0';

    const existing = (await sql`
      SELECT id FROM calculators WHERE hospital_id = ${HOSPITAL_ID} AND slug = ${slug} LIMIT 1
    `) as Array<{ id: string }>;

    let calcId: string;
    if (existing.length > 0) {
      calcId = existing[0].id;
      await sql`
        UPDATE calculators SET
          name = ${name},
          specialty = ${specialty},
          short_description = ${shortDesc},
          long_description = ${longDesc},
          version = ${version},
          is_active = true,
          pin_default_for_roles = ${pinRoles}::jsonb,
          source_citation = ${citation},
          formula_ref = ${formulaRef},
          updated_at = now()
        WHERE id = ${calcId}
      `;
      await sql`DELETE FROM calculator_inputs  WHERE calc_id = ${calcId}`;
      await sql`DELETE FROM calculator_scoring WHERE calc_id = ${calcId}`;
      await sql`DELETE FROM calculator_bands   WHERE calc_id = ${calcId}`;
      steps.push(`updated existing MELD 3.0 calc ${calcId}`);
    } else {
      const inserted = (await sql`
        INSERT INTO calculators (
          hospital_id, slug, name, specialty,
          short_description, long_description, version,
          is_active, pin_default_for_roles, source_citation,
          formula_ref
        ) VALUES (
          ${HOSPITAL_ID}, ${slug}, ${name}, ${specialty},
          ${shortDesc}, ${longDesc}, ${version},
          true, ${pinRoles}::jsonb, ${citation},
          ${formulaRef}
        ) RETURNING id
      `) as Array<{ id: string }>;
      calcId = inserted[0].id;
      steps.push(`inserted new MELD 3.0 calc ${calcId}`);
    }

    // ── 4. Inputs (7 rows) ────────────────────────────────────────────
    const inputs = [
      { key: 'sex', label: 'Sex', type: 'select',
        chart_source_path: 'patient.sex',
        options: [
          { value: 'female', label: 'Female (+1.33)' },
          { value: 'male',   label: 'Male' },
        ],
        helper_text: null, unit: null, display_order: 10 },
      { key: 'on_dialysis', label: 'On dialysis ≥2×/week or 24h CVVH?', type: 'boolean',
        chart_source_path: null,
        options: null,
        helper_text: 'If true, creatinine is forced to 3.0 mg/dL per UNOS rules.',
        unit: null, display_order: 20 },
      { key: 'creatinine', label: 'Serum creatinine (mg/dL)', type: 'number',
        chart_source_path: 'labs.creatinine',
        options: { min: 0.1, max: 20, step: 0.1 },
        helper_text: 'Clamped to [1.0, 3.0] by formula.',
        unit: 'mg/dL', display_order: 30 },
      { key: 'bilirubin', label: 'Total bilirubin (mg/dL)', type: 'number',
        chart_source_path: 'labs.bilirubin',
        options: { min: 0.1, max: 50, step: 0.1 },
        helper_text: 'Clamped to ≥1.0 by formula.',
        unit: 'mg/dL', display_order: 40 },
      { key: 'inr', label: 'INR', type: 'number',
        chart_source_path: 'labs.inr',
        options: { min: 0.5, max: 10, step: 0.1 },
        helper_text: 'Clamped to ≥1.0 by formula.',
        unit: null, display_order: 50 },
      { key: 'albumin', label: 'Serum albumin (g/dL)', type: 'number',
        chart_source_path: 'labs.albumin',
        options: { min: 1.0, max: 5.5, step: 0.1 },
        helper_text: 'Clamped to [1.5, 3.5] by formula.',
        unit: 'g/dL', display_order: 60 },
      { key: 'sodium', label: 'Serum sodium (mEq/L)', type: 'number',
        chart_source_path: 'labs.sodium',
        options: { min: 100, max: 155, step: 1 },
        helper_text: 'Clamped to [125, 137] by formula.',
        unit: 'mEq/L', display_order: 70 },
    ];

    for (const i of inputs) {
      const optsJson = i.options == null ? null : JSON.stringify(i.options);
      await sql`
        INSERT INTO calculator_inputs (
          calc_id, key, label, type, unit, helper_text,
          chart_source_path, options, display_order
        ) VALUES (
          ${calcId}, ${i.key}, ${i.label}, ${i.type},
          ${i.unit}, ${i.helper_text},
          ${i.chart_source_path}, ${optsJson}::jsonb, ${i.display_order}
        )
      `;
    }
    steps.push(`inserted ${inputs.length} inputs`);

    // ── 5. Scoring (empty — dispatched to formula_ref) ────────────────
    steps.push('no scoring rules — formula_ref dispatch');

    // ── 6. Bands (5 rows) ─────────────────────────────────────────────
    const bands = [
      { band_key: 'low',       label: 'Low (MELD <10)',         min_score: 6,  max_score: 9,    color: 'green',  interpretation_default: '3-month mortality ~2%. Low ESLD severity. Routine follow-up.', display_order: 10 },
      { band_key: 'moderate',  label: 'Moderate (MELD 10-19)',  min_score: 10, max_score: 19,   color: 'yellow', interpretation_default: '3-month mortality ~6%. Optimise and monitor. Consider transplant referral if decompensated.', display_order: 20 },
      { band_key: 'high',      label: 'High (MELD 20-29)',      min_score: 20, max_score: 29,   color: 'yellow', interpretation_default: '3-month mortality ~20%. Transplant evaluation if not already in progress.', display_order: 30 },
      { band_key: 'very_high', label: 'Very high (MELD 30-39)', min_score: 30, max_score: 39,   color: 'red',    interpretation_default: '3-month mortality ~50%. Urgent transplant evaluation / ICU-level support.', display_order: 40 },
      { band_key: 'critical',  label: 'Critical (MELD 40)',     min_score: 40, max_score: 40,   color: 'red',    interpretation_default: '3-month mortality ~70%. Status 1A/exception territory; immediate transplant team involvement.', display_order: 50 },
    ];
    for (const b of bands) {
      await sql`
        INSERT INTO calculator_bands (
          calc_id, band_key, label, min_score, max_score,
          color, interpretation_default, display_order
        ) VALUES (
          ${calcId}, ${b.band_key}, ${b.label}, ${b.min_score}, ${b.max_score},
          ${b.color}, ${b.interpretation_default}, ${b.display_order}
        )
      `;
    }
    steps.push(`inserted ${bands.length} bands`);

    return NextResponse.json({
      ok: true,
      hospital_id: HOSPITAL_ID,
      calc_id: calcId,
      steps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message, steps },
      { status: 500 },
    );
  }
}
