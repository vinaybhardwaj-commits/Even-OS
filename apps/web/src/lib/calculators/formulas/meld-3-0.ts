/**
 * Patient Chart Overhaul — PC.2c1 — MELD 3.0 (2022 UNOS) — exact formula
 *
 * MELD 3.0 is the 2022 UNOS liver-allocation score. It extends MELD-Na
 * with sex and albumin adjustments and is the formula currently used for
 * U.S. organ allocation (OPTN policy eff. 2023-07-11).
 *
 * Reference: Kim WR et al., Gastroenterology 2021;161:1887-1895.
 * DOI: 10.1053/j.gastro.2021.08.050
 *
 * Formula:
 *   S = 1.33 · (female ? 1 : 0)
 *     + 4.56 · ln(bilirubin)
 *     + 0.82 · (137 − Na)
 *     − 0.24 · (137 − Na) · ln(bilirubin)
 *     + 9.09 · ln(INR)
 *     + 11.14 · ln(creatinine)
 *     + 1.85 · (3.5 − albumin)
 *     − 1.83 · (3.5 − albumin) · ln(bilirubin)
 *     + 6
 *
 * Per-UNOS clamps applied BEFORE the formula:
 *   - creatinine:  [1.0, 3.0]       mg/dL
 *   - bilirubin:   max(1.0, value)  mg/dL (no upper clamp)
 *   - INR:         max(1.0, value)  (no upper clamp)
 *   - albumin:     [1.5, 3.5]       g/dL
 *   - sodium:      [125, 137]       mEq/L
 *
 * Patients on dialysis ≥2x in the last week OR 24h CVVH get creatinine = 3.0.
 * For MVP we expose that as a boolean input and the formula substitutes.
 *
 * Final score clamped to [6, 40] per UNOS.
 *
 * Determinism: pure function, no side effects, no LLM, no I/O. Lives on
 * the server side and is called by scoring-engine.ts when a calculator's
 * `formula_ref === 'meld_3_0'`.
 */

import type { CalcInputs } from '../scoring-engine';

function num(v: unknown, fallback: number): number {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return false;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function meld_3_0(inputs: CalcInputs): number {
  // Sex: accept 'female' | 'male' | 'other' (string) or boolean is_female.
  const sexRaw = inputs['sex'];
  const isFemale =
    sexRaw === 'female' ||
    sexRaw === 'F' ||
    sexRaw === 'f' ||
    bool(inputs['is_female']);

  // Dialysis override: if on dialysis ≥2x in last week OR 24h CVVH, Cr := 3.0.
  const onDialysis = bool(inputs['on_dialysis']);

  // Inputs — raw values (mg/dL, mEq/L, g/dL).
  const biliRaw = num(inputs['bilirubin'], 1.0);
  const inrRaw = num(inputs['inr'], 1.0);
  const crRaw = num(inputs['creatinine'], 1.0);
  const albRaw = num(inputs['albumin'], 3.5);
  const naRaw = num(inputs['sodium'], 137);

  // Apply UNOS clamps BEFORE the formula.
  const bilirubin = Math.max(1.0, biliRaw);
  const inr = Math.max(1.0, inrRaw);
  const creatinine = onDialysis ? 3.0 : clamp(crRaw, 1.0, 3.0);
  const albumin = clamp(albRaw, 1.5, 3.5);
  const sodium = clamp(naRaw, 125, 137);

  const lnBili = Math.log(bilirubin);
  const lnInr = Math.log(inr);
  const lnCr = Math.log(creatinine);

  const deltaNa = 137 - sodium;
  const deltaAlb = 3.5 - albumin;

  let score =
    1.33 * (isFemale ? 1 : 0) +
    4.56 * lnBili +
    0.82 * deltaNa -
    0.24 * deltaNa * lnBili +
    9.09 * lnInr +
    11.14 * lnCr +
    1.85 * deltaAlb -
    1.83 * deltaAlb * lnBili +
    6;

  // Final clamp per UNOS allocation rules.
  score = clamp(score, 6, 40);

  // Round to integer per UNOS convention (score is an integer on the match run).
  return Math.round(score);
}
