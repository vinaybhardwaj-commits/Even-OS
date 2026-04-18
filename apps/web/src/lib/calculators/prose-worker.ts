/**
 * Patient Chart Overhaul — PC.2c2 — Qwen prose worker for calculators.
 *
 * Consumes `ai_request_queue` items with `prompt_template = 'calc_interpret'`.
 * Called by `/api/ai/jobs/process-queue` after the generic `ingest_document`,
 * `ocr_document`, and `regenerate_brief` branches.
 *
 * Contract (PRD v2.0 §53):
 *   • Deterministic · LLM NEVER touches the score.
 *   • Prose is strictly additive narrative. It may *reference* the score
 *     and the inputs but must not introduce new numbers.
 *   • Output length is tight — 2–3 sentences. Temperature 0.2.
 *
 * Pipeline:
 *   1. Parse `input_data.calc_result_id`.
 *   2. Load calc result + calc metadata + matching band + input field defs.
 *   3. Idempotency: skip if prose_status already advanced past 'pending'.
 *   4. Build prompt (system = hard constraints, user = score + band + inputs).
 *   5. Call `generateInsight` with module='clinical', triggered_by='event'.
 *   6. Grounding: any numeric token in the prose MUST match an input value
 *      or the deterministic score. Unmatched numbers get flagged (PC.2c3
 *      will surface these through a review queue; for now we still save
 *      the prose with prose_status='ready' so the reviewer sees it).
 *   7. UPDATE calculator_results SET prose_text, prose_status='ready'.
 *
 * Failure modes are non-throwing — we return `{ ok: false, error }` so the
 * queue dispatcher can retry / mark failed without blowing up the run.
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { generateInsight } from '@/lib/ai/llm-client';

export interface CalcInterpretInput {
  id: string;              // queue row id (audit only)
  hospital_id: string;     // uuid (queue's audit hospital_id)
  input_data: unknown;     // { calc_result_id, calc_slug?, score?, band_key?, inputs? }
  attempts?: number;
  max_attempts?: number;
}

export interface CalcInterpretResult {
  ok: boolean;
  result_id?: string;
  error?: string;
  /** Ungrounded number tokens found in the prose, if any. */
  flags?: string[];
  /** Set when we skipped because the row was already past 'pending'. */
  skipped?: boolean;
}

// ============================================================
// MAIN
// ============================================================

export async function processCalcInterpret(
  sql: NeonQueryFunction<false, false>,
  item: CalcInterpretInput,
): Promise<CalcInterpretResult> {
  // 1. Parse input ----------------------------------------------------------
  const input = typeof item.input_data === 'string'
    ? JSON.parse(item.input_data)
    : item.input_data;
  const calcResultId: string | undefined = input?.calc_result_id;
  if (!calcResultId) return { ok: false, error: 'input_data.calc_result_id missing' };

  // 2. Load result + calc + band --------------------------------------------
  const rows = await sql`
    SELECT r.id              AS result_id,
           r.score            AS score,
           r.band_key         AS band_key,
           r.inputs           AS inputs,
           r.calc_id          AS calc_id,
           r.calc_slug        AS calc_slug,
           r.calc_version     AS calc_version,
           r.prose_status     AS prose_status,
           c.name             AS calc_name,
           c.specialty        AS calc_specialty,
           c.description      AS calc_description,
           b.label            AS band_label,
           b.color            AS band_color,
           b.interpretation_default AS band_default_prose
      FROM calculator_results r
      JOIN calculators c ON c.id = r.calc_id
 LEFT JOIN calculator_bands b
        ON b.calc_id = c.id
       AND b.band_key = r.band_key
     WHERE r.id = ${calcResultId}
     LIMIT 1
  ` as Array<{
    result_id: string;
    score: string;                 // numeric in Neon comes back as string
    band_key: string;
    inputs: Record<string, unknown>;
    calc_id: string;
    calc_slug: string;
    calc_version: string;
    prose_status: string;
    calc_name: string;
    calc_specialty: string;
    calc_description: string | null;
    band_label: string | null;
    band_color: string | null;
    band_default_prose: string | null;
  }>;
  if (rows.length === 0) return { ok: false, error: `calc result ${calcResultId} not found` };
  const r = rows[0]!;

  // 3. Idempotency — only run on 'pending' rows -----------------------------
  if (r.prose_status !== 'pending') {
    return {
      ok: true,
      result_id: calcResultId,
      skipped: true,
      error: `prose_status already '${r.prose_status}' — skipping`,
    };
  }

  // 4. Load input-field label map for a readable prompt --------------------
  const inputDefs = await sql`
    SELECT key, label, unit
      FROM calculator_inputs
     WHERE calc_id = ${r.calc_id}
  ` as Array<{ key: string; label: string; unit: string | null }>;
  const labelMap = new Map(inputDefs.map((d) => [d.key, { label: d.label, unit: d.unit }]));

  const inputsForPrompt = Object.entries(r.inputs ?? {})
    .map(([k, v]) => {
      const def = labelMap.get(k);
      const label = def?.label ?? k;
      const unit = def?.unit ? ` ${def.unit}` : '';
      return `- ${label}: ${formatInputValue(v)}${unit}`;
    })
    .join('\n');

  // 5. Build prompt ---------------------------------------------------------
  const bandLabel = r.band_label ?? r.band_key ?? 'unknown';
  const bandColor = r.band_color ?? 'grey';
  const calcDesc = r.calc_description ?? '';

  const systemPrompt = [
    'You are a clinical decision-support assistant writing a short narrative interpretation of a deterministic clinical calculator result.',
    '',
    'HARD CONSTRAINTS:',
    '1. NEVER compute, re-derive, correct, or second-guess the numeric score. The score is deterministic and authoritative.',
    '2. NEVER introduce numbers that are not already present either as an input value or as the final score. If you need a threshold, describe it qualitatively ("moderately elevated", "in the high band").',
    '3. Output exactly 2–3 sentences of narrative. No bullet points, no headings, no disclaimers, no markdown.',
    '4. Acknowledge the risk band plainly and, where clear, name the one or two input drivers most responsible.',
    '5. Where appropriate, suggest at most one next clinical step consistent with the band-default guidance. Stay cautious — avoid specific drug/dose/therapy recommendations.',
    '6. Never include a patient name, MRN, or other identifier. Never speculate beyond what the inputs say.',
    '',
    'OUTPUT FORMAT: plain text, 2–3 sentences, no quotes, no markdown.',
  ].join('\n');

  const userPrompt = [
    `Calculator: ${r.calc_name} (${r.calc_specialty})`,
    calcDesc ? `Purpose: ${calcDesc}` : null,
    `Score: ${r.score}`,
    `Band: ${bandLabel} (${bandColor})`,
    `Band-default guidance: ${r.band_default_prose ?? 'not specified'}`,
    '',
    'Inputs:',
    inputsForPrompt || '(none)',
    '',
    'Write the narrative interpretation under the hard constraints above.',
  ].filter((l) => l !== null).join('\n');

  // 6. Call LLM -------------------------------------------------------------
  const llm = await generateInsight({
    hospital_id:   item.hospital_id,
    module:        'clinical',
    system_prompt: systemPrompt,
    user_prompt:   userPrompt,
    max_tokens:    300,
    temperature:   0.2,
    triggered_by:  'event',
  });
  if (!llm || !llm.content) {
    return { ok: false, error: 'LLM returned no content' };
  }

  const prose = (llm.content || '').trim();
  if (!prose) return { ok: false, error: 'LLM returned empty prose' };

  // 7. Grounding check ------------------------------------------------------
  const flags = groundProse(prose, r.score, r.inputs ?? {});

  // 8. Persist --------------------------------------------------------------
  // We save the prose even when grounding flags fire — the reviewer still
  // needs to see the text to decide whether to accept or flag/decline.
  // PC.2c3 will add a proper hallucination_flags queue; until then, flags
  // live in the worker return value (surfaced via cron summary) and the
  // reviewer gate ('I've reviewed' vs 'Flag') catches issues manually.
  await sql`
    UPDATE calculator_results
       SET prose_text   = ${prose},
           prose_status = 'ready',
           updated_at   = now()
     WHERE id = ${calcResultId}
       AND prose_status = 'pending'
  `;

  return {
    ok: true,
    result_id: calcResultId,
    flags: flags.length ? flags : undefined,
  };
}

// ============================================================
// Helpers
// ============================================================

function formatInputValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return String(v);
  return String(v);
}

/**
 * Returns an array of flag strings when the prose contains numeric tokens
 * that are NOT derivable from the inputs or the computed score.
 *
 * Rules:
 *   • Strip numbers that are string-equal to the score (as string and as
 *     rounded-to-integer string).
 *   • Strip numbers that are string-equal to any raw input value or to
 *     the numeric content of a stringy input (e.g. "137" from "137 mEq/L").
 *   • Small integers 1–3 get a free pass so "1 or 2 sentences"-style
 *     structural numbers don't fire. Clinical numbers that matter are
 *     almost never 1, 2, or 3 standalone (counts, enumerations).
 *   • Years like "2023" get a free pass (4-digit numbers 1900–2100) —
 *     they're almost always dates/publications.
 */
function groundProse(
  prose: string,
  score: string | number,
  inputs: Record<string, unknown>,
): string[] {
  const allowed = new Set<string>();

  const scoreStr = String(score);
  const scoreNum = Number(score);
  allowed.add(scoreStr);
  if (Number.isFinite(scoreNum)) {
    allowed.add(String(Math.round(scoreNum)));
    allowed.add(scoreNum.toFixed(0));
    allowed.add(scoreNum.toFixed(1));
    allowed.add(scoreNum.toFixed(2));
  }

  for (const v of Object.values(inputs)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      allowed.add(String(v));
      allowed.add(v.toFixed(0));
      allowed.add(v.toFixed(1));
      allowed.add(v.toFixed(2));
    } else if (typeof v === 'string') {
      const m = v.match(/-?\d+(?:\.\d+)?/g);
      if (m) for (const x of m) allowed.add(x);
    }
  }

  const found = prose.match(/-?\d+(?:\.\d+)?/g) || [];
  const ungrounded = found.filter((tok) => {
    if (allowed.has(tok)) return false;
    const n = Number(tok);
    if (Number.isInteger(n) && n >= 1 && n <= 3) return false;         // structural small ints
    if (Number.isInteger(n) && n >= 1900 && n <= 2100) return false;   // years
    return true;
  });

  if (ungrounded.length === 0) return [];
  // De-dupe, cap at 5.
  const unique = Array.from(new Set(ungrounded)).slice(0, 5);
  return [`ungrounded_numbers:${unique.join(',')}`];
}
