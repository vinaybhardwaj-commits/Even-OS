/**
 * LLM extraction prompt + Zod result schema for `ingest_document` jobs (N.4).
 *
 * The worker passes raw extracted text from a clinical document (referral
 * letter, discharge summary, prescription, etc.) into Qwen 2.5 14B, which
 * returns a strict JSON object describing what should be proposed back to
 * the patient chart as `chart_update_proposals` rows.
 *
 * Per V's choice: confidence > 0.95 is auto-accepted (status='accepted',
 * applied_row_id set after insert into the canonical table); everything
 * else stays 'pending' for clinician review.
 *
 * Six proposal types map 1:1 to the `chart_update_proposals.proposal_type`
 * enum in `drizzle/schema/51-notes-v2.ts`:
 *   condition | allergy | medication | lab_result | procedure | problem
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Per-type payload schemas
//
// Payloads are intentionally narrow strings — the canonical clinical tables
// own enums + ICD codes; the worker downcasts these strings into whatever
// shape each target table accepts. Keeping the LLM contract small reduces
// hallucination surface and matches the PRD: "extract facts, not codes".
// ---------------------------------------------------------------------------

const conditionPayload = z.object({
  name: z.string().min(1),
  icd_hint: z.string().optional(),
  status: z.enum(['active', 'resolved', 'history']).default('active'),
  onset_date: z.string().optional(), // ISO 8601 if known
  notes: z.string().optional(),
});

const allergyPayload = z.object({
  substance: z.string().min(1),
  reaction: z.string().optional(),
  severity: z.enum(['mild', 'moderate', 'severe', 'unknown']).default('unknown'),
  notes: z.string().optional(),
});

const medicationPayload = z.object({
  drug_name: z.string().min(1),
  generic_name: z.string().optional(),
  dose: z.string().optional(),
  route: z.string().optional(),
  frequency: z.string().optional(),
  duration: z.string().optional(),
  indication: z.string().optional(),
  notes: z.string().optional(),
});

const labResultPayload = z.object({
  test_name: z.string().min(1),
  value: z.string(),
  unit: z.string().optional(),
  reference_range: z.string().optional(),
  flag: z.enum(['low', 'high', 'critical_low', 'critical_high', 'normal', 'unknown']).default('unknown'),
  collected_at: z.string().optional(),
  notes: z.string().optional(),
});

const procedurePayload = z.object({
  name: z.string().min(1),
  performed_date: z.string().optional(),
  performed_by: z.string().optional(),
  outcome: z.string().optional(),
  notes: z.string().optional(),
});

const problemPayload = z.object({
  description: z.string().min(1),
  category: z.string().optional(),
  notes: z.string().optional(),
});

// One discriminated proposal item ------------------------------------------------

export const proposalItemSchema = z.discriminatedUnion('proposal_type', [
  z.object({
    proposal_type: z.literal('condition'),
    confidence: z.number().min(0).max(1),
    extraction_notes: z.string().optional(),
    payload: conditionPayload,
  }),
  z.object({
    proposal_type: z.literal('allergy'),
    confidence: z.number().min(0).max(1),
    extraction_notes: z.string().optional(),
    payload: allergyPayload,
  }),
  z.object({
    proposal_type: z.literal('medication'),
    confidence: z.number().min(0).max(1),
    extraction_notes: z.string().optional(),
    payload: medicationPayload,
  }),
  z.object({
    proposal_type: z.literal('lab_result'),
    confidence: z.number().min(0).max(1),
    extraction_notes: z.string().optional(),
    payload: labResultPayload,
  }),
  z.object({
    proposal_type: z.literal('procedure'),
    confidence: z.number().min(0).max(1),
    extraction_notes: z.string().optional(),
    payload: procedurePayload,
  }),
  z.object({
    proposal_type: z.literal('problem'),
    confidence: z.number().min(0).max(1),
    extraction_notes: z.string().optional(),
    payload: problemPayload,
  }),
]);

export const extractionResultSchema = z.object({
  summary: z.string().min(1),
  doc_type_suggestion: z
    .enum([
      'discharge_summary',
      'referral_letter',
      'prescription',
      'lab_report',
      'imaging_report',
      'consultation_note',
      'consent_form',
      'insurance_document',
      'other',
    ])
    .optional(),
  proposals: z.array(proposalItemSchema).max(50),
});

export type ProposalItem = z.infer<typeof proposalItemSchema>;
export type ExtractionResultPayload = z.infer<typeof extractionResultSchema>;

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are a clinical-document extraction engine for an Indian hospital EMR.
You will be given the raw text of a clinical document (referral letter, discharge summary, prescription, lab report, etc.).

Your job is to:
1. Produce a one-paragraph summary of the document (max 4 sentences).
2. Suggest a doc_type from the allowed list (or "other").
3. Extract structured proposals to update the patient chart, as a JSON array.

Each proposal must include:
- proposal_type: one of "condition", "allergy", "medication", "lab_result", "procedure", "problem"
- confidence: a number 0.0-1.0 reflecting how certain you are this is in the source text
- extraction_notes: brief reason for the confidence score
- payload: the type-specific structured fields

Hard rules:
- DO NOT invent facts. If the text does not state it, do not propose it.
- DO NOT propose medication doses you cannot read with high certainty.
- Set confidence > 0.95 ONLY if the text states the fact verbatim and unambiguously.
- Set confidence 0.80–0.95 if you inferred from clear context.
- Set confidence < 0.80 if the source is ambiguous, abbreviated, or partially obscured.
- Output strictly valid JSON matching the response schema. No prose. No code fences.`;

export function buildUserPrompt(extractedText: string, hint?: { docTypeHint?: string; filename?: string }): string {
  const header = [
    hint?.filename ? `FILENAME: ${hint.filename}` : null,
    hint?.docTypeHint ? `DOCUMENT TYPE HINT (from upload classifier): ${hint.docTypeHint}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `${header ? header + '\n\n' : ''}DOCUMENT TEXT:
"""
${extractedText}
"""

Respond with a single JSON object of shape:
{
  "summary": "<one paragraph, max 4 sentences>",
  "doc_type_suggestion": "<one of: discharge_summary | referral_letter | prescription | lab_report | imaging_report | consultation_note | consent_form | insurance_document | other>",
  "proposals": [
    {
      "proposal_type": "condition" | "allergy" | "medication" | "lab_result" | "procedure" | "problem",
      "confidence": 0.0-1.0,
      "extraction_notes": "<short reason>",
      "payload": { ... type-specific fields ... }
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Robust JSON parsing — Qwen sometimes wraps in code fences despite the
// instructions, and very rarely emits a stray prefix sentence. Strip both
// before validating with Zod.
// ---------------------------------------------------------------------------

export function parseExtractionResult(raw: string): { ok: true; data: ExtractionResultPayload } | { ok: false; error: string; raw: string } {
  const cleaned = stripFences(raw);
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    // last resort: find the largest balanced { ... } block
    const sliced = sliceFirstJsonObject(cleaned);
    if (!sliced) return { ok: false, error: 'Model output is not valid JSON', raw };
    try {
      json = JSON.parse(sliced);
    } catch (e2) {
      return { ok: false, error: 'Model output is not valid JSON (after slice)', raw };
    }
  }
  const parsed = extractionResultSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `Schema validation failed: ${parsed.error.message}`, raw };
  }
  return { ok: true, data: parsed.data };
}

function stripFences(s: string): string {
  const trimmed = s.trim();
  if (trimmed.startsWith('```')) {
    const firstNl = trimmed.indexOf('\n');
    const last = trimmed.lastIndexOf('```');
    if (firstNl > -1 && last > firstNl) return trimmed.slice(firstNl + 1, last).trim();
  }
  return trimmed;
}

function sliceFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// Worker uses this to decide auto-accept vs queued-for-review.
export const AUTO_ACCEPT_THRESHOLD = 0.95;
