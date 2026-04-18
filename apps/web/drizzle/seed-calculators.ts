/**
 * PC.2a seed — loads the 10 fixture calculators into EHRC.
 *
 * Direct-to-SQL (bypasses tRPC auth). Idempotent:
 *   - On slug conflict (hospital_id, slug) we UPDATE the calc row and WIPE+REINSERT
 *     children (inputs / scoring / bands) so every run is authoritative.
 *
 * Post-seed sanity:
 *   1. Count of active calcs for EHRC = 10.
 *   2. Run CHA2DS2-VASc with a known-high-risk input set → expect score 6, band "high".
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { CALCULATOR_FIXTURES, type CalcFixture } from './fixtures/calculators';
import { scoreCalculator, resolveBand } from '../src/lib/calculators/scoring-engine';

const HOSPITAL_ID = process.env.HOSPITAL_ID ?? 'EHRC';

async function upsertFixture(sql: NeonQueryFunction<false, false>, f: CalcFixture): Promise<string> {
  const { def, inputs, scoring, bands } = f;

  // 1. Upsert calc row
  const existing = (await sql`
    SELECT id FROM calculators
    WHERE hospital_id = ${HOSPITAL_ID} AND slug = ${def.slug}
    LIMIT 1
  `) as Array<{ id: string }>;

  let calcId: string;
  if (existing.length > 0) {
    calcId = existing[0].id;
    await sql`
      UPDATE calculators SET
        name = ${def.name},
        specialty = ${def.specialty},
        short_description = ${def.short_description ?? null},
        long_description = ${def.long_description ?? null},
        version = ${def.version ?? '1.0'},
        is_active = ${def.is_active ?? true},
        pin_default_for_roles = ${JSON.stringify(def.pin_default_for_roles ?? [])}::jsonb,
        source_citation = ${def.source_citation ?? null},
        formula_ref = ${def.formula_ref ?? null},
        updated_at = now()
      WHERE id = ${calcId}
    `;
    // wipe children
    await sql`DELETE FROM calculator_inputs  WHERE calc_id = ${calcId}`;
    await sql`DELETE FROM calculator_scoring WHERE calc_id = ${calcId}`;
    await sql`DELETE FROM calculator_bands   WHERE calc_id = ${calcId}`;
    console.log(`  ↻ updated ${def.slug}`);
  } else {
    const inserted = (await sql`
      INSERT INTO calculators (
        hospital_id, slug, name, specialty,
        short_description, long_description, version,
        is_active, pin_default_for_roles, source_citation,
        formula_ref, created_by_user_id
      ) VALUES (
        ${HOSPITAL_ID}, ${def.slug}, ${def.name}, ${def.specialty},
        ${def.short_description ?? null}, ${def.long_description ?? null}, ${def.version ?? '1.0'},
        ${def.is_active ?? true}, ${JSON.stringify(def.pin_default_for_roles ?? [])}::jsonb, ${def.source_citation ?? null},
        ${def.formula_ref ?? null}, NULL
      )
      RETURNING id
    `) as Array<{ id: string }>;
    calcId = inserted[0].id;
    console.log(`  + inserted ${def.slug}`);
  }

  // 2. Insert children
  for (const inp of inputs) {
    await sql`
      INSERT INTO calculator_inputs (
        calc_id, key, label, helper_text, type, unit, options,
        chart_source_path, required, display_order
      ) VALUES (
        ${calcId}, ${inp.key}, ${inp.label}, ${inp.helper_text ?? null},
        ${inp.type}, ${inp.unit ?? null}, ${inp.options ? JSON.stringify(inp.options) : null}::jsonb,
        ${inp.chart_source_path ?? null}, ${inp.required ?? true}, ${inp.display_order ?? 0}
      )
    `;
  }
  for (const s of scoring) {
    await sql`
      INSERT INTO calculator_scoring (
        calc_id, rule_type, input_key, when_value, points, formula_expr, display_order
      ) VALUES (
        ${calcId}, ${s.rule_type}, ${s.input_key}, ${s.when_value ?? null},
        ${s.points}, ${s.formula_expr ?? null}, ${s.display_order ?? 0}
      )
    `;
  }
  for (const b of bands) {
    await sql`
      INSERT INTO calculator_bands (
        calc_id, band_key, label, min_score, max_score,
        color, interpretation_default, display_order
      ) VALUES (
        ${calcId}, ${b.band_key}, ${b.label}, ${b.min_score}, ${b.max_score},
        ${b.color}, ${b.interpretation_default ?? null}, ${b.display_order ?? 0}
      )
    `;
  }
  return calcId;
}

async function sanityCheck(sql: NeonQueryFunction<false, false>): Promise<void> {
  // A. Count active calcs
  const [{ n }] = (await sql`
    SELECT COUNT(*)::int AS n FROM calculators
    WHERE hospital_id = ${HOSPITAL_ID} AND is_active = true
  `) as Array<{ n: number }>;
  if (n !== CALCULATOR_FIXTURES.length) {
    throw new Error(`Sanity FAIL: expected ${CALCULATOR_FIXTURES.length} active calcs for ${HOSPITAL_ID}, found ${n}`);
  }
  console.log(`  ✓ calc count OK (${n})`);

  // B. Run CHA2DS2-VASc with a known input set
  // All-true except female and age_65_74 (already age_ge75). Expected:
  //   chf(1) + htn(1) + age≥75(2) + dm(1) + stroke(2) + vascular(1) - 0 - 0 = 8 ... wait let me pick
  // Use simpler: chf+htn+stroke_tia+female = 1+1+2+1 = 5 → band moderate_high → actually 5 >=4 so "high"
  // Actually bands: 0, 1, 2-3, ≥4 → 5 = high (red)
  const calcRow = (await sql`
    SELECT id FROM calculators WHERE hospital_id = ${HOSPITAL_ID} AND slug = 'cha2ds2-vasc' LIMIT 1
  `) as Array<{ id: string }>;
  const calcId = calcRow[0].id;
  const scoringRows = (await sql`
    SELECT rule_type, input_key, when_value, points::text AS points, formula_expr
    FROM calculator_scoring WHERE calc_id = ${calcId}
  `) as Array<{ rule_type: 'sum'|'weighted'|'conditional'; input_key: string; when_value: string|null; points: string; formula_expr: string|null }>;
  const bandRows = (await sql`
    SELECT band_key, label, min_score::text AS min_score, max_score::text AS max_score, color, interpretation_default, display_order
    FROM calculator_bands WHERE calc_id = ${calcId} ORDER BY display_order
  `) as Array<{ band_key: string; label: string; min_score: string; max_score: string|null; color: 'green'|'yellow'|'red'|'grey'; interpretation_default: string|null; display_order: number }>;

  const rules = scoringRows.map(r => ({
    rule_type: r.rule_type,
    input_key: r.input_key,
    when_value: r.when_value,
    points: Number(r.points),
    formula_expr: r.formula_expr,
  }));
  const bands = bandRows.map(b => ({
    band_key: b.band_key,
    label: b.label,
    min_score: Number(b.min_score),
    max_score: b.max_score === null ? null : Number(b.max_score),
    color: b.color,
    interpretation_default: b.interpretation_default,
    display_order: b.display_order,
  }));

  // Inputs: chf + htn + stroke_tia + female = 1+1+2+1 = 5 → "high" band (≥4)
  const testInputs = {
    chf_hx: true,
    htn_hx: true,
    age_ge75: false,
    dm_hx: false,
    stroke_tia_hx: true,
    vascular_hx: false,
    age_65_74: false,
    female: true,
  };
  const score = scoreCalculator(rules, testInputs);
  const band = resolveBand(bands, score);
  if (score !== 5) throw new Error(`Sanity FAIL: CHA2DS2-VASc expected score 5, got ${score}`);
  if (!band || band.band_key !== 'high') throw new Error(`Sanity FAIL: expected band 'high', got ${band?.band_key}`);
  console.log(`  ✓ CHA2DS2-VASc sanity run: score=${score}, band=${band.band_key} (${band.color})`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  const sql = neon(process.env.DATABASE_URL);

  // Confirm hospital exists (otherwise FK fails)
  const hospRow = (await sql`SELECT hospital_id FROM hospitals WHERE hospital_id = ${HOSPITAL_ID} LIMIT 1`) as Array<{ hospital_id: string }>;
  if (hospRow.length === 0) {
    throw new Error(`Hospital ${HOSPITAL_ID} not found — run base seed first.`);
  }

  console.log(`\n🧮 Seeding ${CALCULATOR_FIXTURES.length} calculators into ${HOSPITAL_ID}...\n`);
  for (const f of CALCULATOR_FIXTURES) {
    await upsertFixture(sql, f);
  }

  console.log(`\n🔎 Running post-seed sanity checks...\n`);
  await sanityCheck(sql);

  console.log(`\n✅ Calculator seed complete.\n`);
}

main().catch((err) => {
  console.error('\n❌ Calculator seed FAILED:', err);
  process.exit(1);
});
