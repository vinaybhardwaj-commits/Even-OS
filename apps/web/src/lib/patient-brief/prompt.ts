/**
 * Patient Brief — Prompt builder + Zod schema for LLM output.
 *
 * Output is intentionally narrow: a single narrative paragraph plus a
 * structured payload that mirrors a SOAP-ish brief but keyed for cards.
 * The grounding check (./grounding.ts) walks the structured payload
 * against the source set we passed in, so the LLM cannot smuggle in a
 * fact, name, or number that wasn't in the context.
 */

import { z } from 'zod';
import type { BriefContext } from './context';

// ============================================================
// SYSTEM PROMPT
// ============================================================

export const BRIEF_SYSTEM_PROMPT = `You are a clinical brief generator for a hospital patient chart.

Your job: read structured patient context (demographics, encounter, conditions, allergies, current medications, recent labs, recent vitals, signed clinical notes, accepted chart proposals) and produce a concise, accurate brief that a busy clinician can absorb in under 30 seconds before walking into the room.

HARD RULES:
1. NEVER fabricate. Only state facts present verbatim in the input context. If a section has no data, omit it from the structured payload (use empty arrays / null).
2. NEVER invent ICD codes, drug doses, lab values, dates, names, or numbers that aren't in the input.
3. NEVER produce diagnoses or recommendations beyond what the source notes already state.
4. Use SI / Indian clinical conventions.
5. Output JSON ONLY — no prose, no markdown fences, no commentary.

The structured.* fields are clinician-facing summaries — keep each item short (one line, ideally < 100 chars) and quote the source where it makes sense (e.g. "as per Dr X's note 17 Apr").

The narrative is one paragraph (3–6 sentences) — chronological if the encounter is active, otherwise problem-first.`;

// ============================================================
// USER PROMPT BUILDER
// ============================================================

/**
 * Compact context into a token-efficient JSON payload for the user message.
 * We keep raw arrays so the LLM has full source material; the prompt header
 * tells it what each section is.
 */
export function buildBriefUserPrompt(ctx: BriefContext): string {
  const payload = {
    patient: ctx.patient,
    encounter: ctx.encounter,
    active_conditions: ctx.conditions.map((c) => ({
      id: c.id,
      name: c.condition_name,
      icd10: c.icd10_code,
      status: c.clinical_status,
      severity: c.severity,
      onset: c.onset_date,
      notes: c.notes,
    })),
    allergies: ctx.allergies.map((a) => ({
      id: a.id,
      substance: a.substance,
      reaction: a.reaction,
      severity: a.severity,
      criticality: a.criticality,
      verification: a.verification_status,
    })),
    current_medications: ctx.medications.map((m) => ({
      id: m.id,
      drug: m.drug_name,
      generic: m.generic_name,
      dose: m.dose_quantity ? `${m.dose_quantity} ${m.dose_unit ?? ''}`.trim() : null,
      route: m.route,
      frequency: m.frequency_code,
      duration_days: m.duration_days,
      status: m.status,
      prn: m.is_prn ? (m.prn_indication ?? 'PRN') : null,
      high_alert: m.is_high_alert,
      narcotics: m.narcotics_class,
      ordered_by: m.prescriber_name,
      ordered_at: m.ordered_at,
    })),
    recent_labs: ctx.labs.map((l) => ({
      id: l.id,
      test: l.test_name,
      code: l.test_code,
      value: l.value_numeric ?? l.value_text,
      unit: l.unit,
      ref: l.ref_range_text ?? (l.ref_range_low != null && l.ref_range_high != null
        ? `${l.ref_range_low}-${l.ref_range_high}`
        : null),
      flag: l.flag,
      critical: l.is_critical,
      at: l.resulted_at,
    })),
    recent_vitals: ctx.vitals.map((v) => ({
      id: v.id,
      type: v.observation_type,
      value: v.value_quantity ?? v.value_string,
      unit: v.unit,
      interpretation: v.interpretation,
      at: v.effective_datetime,
    })),
    signed_notes: ctx.notes.map((n) => ({
      id: n.id,
      type: n.note_type,
      author: n.author_name,
      signed_at: n.signed_at ?? n.created_at,
      // Keep subjective + assessment + plan; objective is usually long
      // and most of the relevant numbers live in vitals/labs anyway.
      s: clip(n.subjective, 600),
      a: clip(n.assessment, 600),
      p: clip(n.plan, 600),
      free: clip(n.free_text_content, 800),
    })),
    accepted_proposals: ctx.accepted_proposals.map((p) => ({
      id: p.id,
      type: p.proposal_type,
      payload: p.payload,
      reviewed_at: p.reviewed_at,
    })),
  };

  return [
    `Generate a patient brief from the following context. Return JSON matching this shape:`,
    `{`,
    `  "narrative": "<one paragraph, 3-6 sentences>",`,
    `  "structured": {`,
    `    "hpi": "<2-4 sentence HPI summary, or empty string>",`,
    `    "problems":      [ { "name": "...", "icd10": "..." | null, "note": "..." | null } ],`,
    `    "allergies":     [ { "substance": "...", "reaction": "..." | null, "severity": "..." } ],`,
    `    "current_meds":  [ { "drug": "...", "dose": "..." | null, "route": "..." | null, "frequency": "..." | null, "indication": "..." | null } ],`,
    `    "recent_labs":   [ { "test": "...", "value": "...", "unit": "..." | null, "flag": "..." | null, "at": "<ISO>" } ],`,
    `    "plan":          [ "..." ]`,
    `  }`,
    `}`,
    ``,
    `CONTEXT:`,
    JSON.stringify(payload),
  ].join('\n');
}

function clip(s: string | null, max: number): string | null {
  if (!s) return null;
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ============================================================
// ZOD OUTPUT SCHEMA
// ============================================================

export const briefStructuredSchema = z.object({
  hpi: z.string().default(''),
  problems: z.array(z.object({
    name:  z.string(),
    icd10: z.string().nullable().optional(),
    note:  z.string().nullable().optional(),
  })).default([]),
  allergies: z.array(z.object({
    substance: z.string(),
    reaction:  z.string().nullable().optional(),
    severity:  z.string(),
  })).default([]),
  current_meds: z.array(z.object({
    drug:       z.string(),
    dose:       z.string().nullable().optional(),
    route:      z.string().nullable().optional(),
    frequency:  z.string().nullable().optional(),
    indication: z.string().nullable().optional(),
  })).default([]),
  recent_labs: z.array(z.object({
    test:  z.string(),
    value: z.union([z.string(), z.number()]).transform((v) => String(v)),
    unit:  z.string().nullable().optional(),
    flag:  z.string().nullable().optional(),
    at:    z.string().nullable().optional(),
  })).default([]),
  plan: z.array(z.string()).default([]),
});

export const briefOutputSchema = z.object({
  narrative:  z.string().min(1),
  structured: briefStructuredSchema,
});

export type BriefStructured = z.infer<typeof briefStructuredSchema>;
export type BriefOutput     = z.infer<typeof briefOutputSchema>;

// ============================================================
// PARSER (with code-fence + balanced-brace fallback)
// ============================================================

export interface BriefParseResult {
  ok: boolean;
  data?: BriefOutput;
  error?: string;
  rawJson?: string;
}

export function parseBriefOutput(raw: string): BriefParseResult {
  const trimmed = stripFences(raw).trim();
  let candidate = trimmed;

  // First attempt: parse the whole string
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    // Fallback: find first balanced {...} block
    const sliced = sliceFirstJsonObject(trimmed);
    if (!sliced) return { ok: false, error: 'no JSON object found in LLM output' };
    candidate = sliced;
    try {
      json = JSON.parse(candidate);
    } catch (err) {
      return { ok: false, error: `JSON.parse failed: ${(err as Error).message}`, rawJson: candidate };
    }
  }

  const parsed = briefOutputSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `schema validation failed: ${parsed.error.message}`, rawJson: candidate };
  }

  return { ok: true, data: parsed.data, rawJson: candidate };
}

function stripFences(s: string): string {
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]! : s;
}

function sliceFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
