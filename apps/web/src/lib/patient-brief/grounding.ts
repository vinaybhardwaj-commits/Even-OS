/**
 * Patient Brief — Structured Grounding Check
 *
 * V's choice (17 Apr 2026): "Structured grounding check (Recommended)".
 *
 * What we do:
 *  - Walk every fact in the LLM output (problems, allergies, current_meds, recent_labs)
 *    and check that the salient values (drug names, ICD codes, lab values, allergy substances)
 *    appear in the source context.
 *  - Numbers are matched as exact-string-token presence inside any source field.
 *  - Names / substances are matched case-insensitive substring.
 *  - Anything that doesn't ground produces a hallucinationFlag entry.
 *
 * The flags are written to patient_briefs.hallucination_flags (jsonb) and the
 * brief itself is still written — the UI shows a yellow banner ("ungrounded
 * facts: 2") rather than discarding the brief, because the narrative may
 * still be useful and clinicians want the option to acknowledge.
 */

import type { BriefContext } from './context';
import type { BriefOutput }  from './prompt';

export interface HallucinationFlag {
  category: 'problem' | 'allergy' | 'medication' | 'lab' | 'narrative';
  field:    string;          // e.g. 'drug', 'icd10', 'value'
  value:    string;           // the suspect string
  reason:   string;           // human-readable why
  index?:   number;            // index in the array if applicable
}

export interface GroundingResult {
  flags: HallucinationFlag[];
  /** number of distinct facts that DID ground successfully — useful to log */
  groundedCount: number;
}

// ============================================================
// MAIN
// ============================================================

export function groundBrief(
  ctx: BriefContext,
  brief: BriefOutput,
): GroundingResult {
  const flags: HallucinationFlag[] = [];
  let grounded = 0;

  // Build searchable corpora -------------------------------------------------
  const corpus = buildCorpus(ctx);          // big lower-cased haystack of every text field
  const numbers = buildNumberSet(ctx);      // set of numeric tokens seen in source

  // 1. Problems --------------------------------------------------------------
  const conditionNames = ctx.conditions.map((c) => c.condition_name.toLowerCase());
  const conditionIcds  = new Set(
    ctx.conditions
      .map((c) => (c.icd10_code ?? '').toUpperCase().trim())
      .filter((v): v is string => v.length > 0),
  );
  // Accepted-proposal payloads can also contribute condition names
  for (const p of ctx.accepted_proposals) {
    if (p.proposal_type === 'condition' && typeof (p.payload as any)?.name === 'string') {
      conditionNames.push(((p.payload as any).name as string).toLowerCase());
    }
  }
  brief.structured.problems.forEach((p, i) => {
    const nameOk = conditionNames.some((c) => c.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(c));
    if (!nameOk) {
      flags.push({ category: 'problem', field: 'name', value: p.name, reason: 'name not present in active conditions or accepted proposals', index: i });
    } else {
      grounded++;
    }
    if (p.icd10) {
      const code = p.icd10.toUpperCase().trim();
      if (!conditionIcds.has(code) && !corpus.includes(code.toLowerCase())) {
        flags.push({ category: 'problem', field: 'icd10', value: p.icd10, reason: 'ICD-10 code not present in source', index: i });
      } else {
        grounded++;
      }
    }
  });

  // 2. Allergies -------------------------------------------------------------
  const allergySubs = ctx.allergies.map((a) => a.substance.toLowerCase());
  for (const p of ctx.accepted_proposals) {
    if (p.proposal_type === 'allergy' && typeof (p.payload as any)?.substance === 'string') {
      allergySubs.push(((p.payload as any).substance as string).toLowerCase());
    }
  }
  brief.structured.allergies.forEach((a, i) => {
    const ok = allergySubs.some((s) => s.includes(a.substance.toLowerCase()) || a.substance.toLowerCase().includes(s));
    if (!ok) {
      flags.push({ category: 'allergy', field: 'substance', value: a.substance, reason: 'substance not present in allergy list', index: i });
    } else {
      grounded++;
    }
  });

  // 3. Current medications ---------------------------------------------------
  const medNames = new Set<string>();
  for (const m of ctx.medications) {
    medNames.add(m.drug_name.toLowerCase());
    if (m.generic_name) medNames.add(m.generic_name.toLowerCase());
  }
  for (const p of ctx.accepted_proposals) {
    if (p.proposal_type === 'medication') {
      const drug   = (p.payload as any)?.drug_name;
      const generic = (p.payload as any)?.generic_name;
      if (typeof drug === 'string') medNames.add(drug.toLowerCase());
      if (typeof generic === 'string') medNames.add(generic.toLowerCase());
    }
  }
  brief.structured.current_meds.forEach((m, i) => {
    const drug = m.drug.toLowerCase();
    const drugOk = Array.from(medNames).some((n) => n.includes(drug) || drug.includes(n));
    if (!drugOk) {
      flags.push({ category: 'medication', field: 'drug', value: m.drug, reason: 'drug not in current medications', index: i });
    } else {
      grounded++;
    }
    // Dose: if present, the numeric tokens of the dose string must all appear in the source's dose tokens
    if (m.dose) {
      const tokens = extractNumericTokens(m.dose);
      for (const t of tokens) {
        if (!numbers.has(t)) {
          flags.push({ category: 'medication', field: 'dose', value: m.dose, reason: `dose value "${t}" not present in source`, index: i });
          break;
        }
      }
    }
  });

  // 4. Recent labs -----------------------------------------------------------
  const labTests = new Set<string>();
  for (const l of ctx.labs) {
    labTests.add(l.test_name.toLowerCase());
    labTests.add(l.test_code.toLowerCase());
  }
  brief.structured.recent_labs.forEach((l, i) => {
    const test = l.test.toLowerCase();
    const testOk = Array.from(labTests).some((n) => n.includes(test) || test.includes(n));
    if (!testOk) {
      flags.push({ category: 'lab', field: 'test', value: l.test, reason: 'test not in recent labs', index: i });
    } else {
      grounded++;
    }
    // Value tokens
    const tokens = extractNumericTokens(String(l.value));
    for (const t of tokens) {
      if (!numbers.has(t)) {
        flags.push({ category: 'lab', field: 'value', value: String(l.value), reason: `value "${t}" not present in source`, index: i });
        break;
      }
    }
  });

  // 5. Narrative numeric tokens ---------------------------------------------
  // Narrative is the loosest part — we just check that any number with >= 2 digits
  // (which is the kind of number that usually carries clinical meaning, e.g. dose, lab value, year)
  // is grounded in source numbers. Single digits get a free pass to avoid noise from "3 days", "2x".
  const narrTokens = extractNumericTokens(brief.narrative).filter((t) => t.replace(/\D/g, '').length >= 2);
  for (const t of narrTokens) {
    if (!numbers.has(t)) {
      flags.push({ category: 'narrative', field: 'number', value: t, reason: 'number in narrative not present in source' });
    }
  }

  return { flags, groundedCount: grounded };
}

// ============================================================
// HELPERS
// ============================================================

function buildCorpus(ctx: BriefContext): string {
  const parts: string[] = [];
  parts.push(JSON.stringify(ctx.encounter ?? {}));
  parts.push(ctx.conditions.map((c) =>
    `${c.condition_name} ${c.icd10_code ?? ''} ${c.notes ?? ''}`).join(' '));
  parts.push(ctx.allergies.map((a) =>
    `${a.substance} ${a.reaction ?? ''} ${a.notes ?? ''}`).join(' '));
  parts.push(ctx.medications.map((m) =>
    `${m.drug_name} ${m.generic_name ?? ''} ${m.dose_quantity ?? ''} ${m.dose_unit ?? ''} ${m.route ?? ''} ${m.frequency_code ?? ''} ${m.instructions ?? ''}`).join(' '));
  parts.push(ctx.labs.map((l) =>
    `${l.test_name} ${l.test_code} ${l.value_numeric ?? ''} ${l.value_text ?? ''} ${l.unit ?? ''} ${l.flag ?? ''}`).join(' '));
  parts.push(ctx.vitals.map((v) =>
    `${v.observation_type} ${v.value_quantity ?? ''} ${v.value_string ?? ''} ${v.unit ?? ''}`).join(' '));
  parts.push(ctx.notes.map((n) =>
    `${n.subjective ?? ''} ${n.objective ?? ''} ${n.assessment ?? ''} ${n.plan ?? ''} ${n.free_text_content ?? ''}`).join(' '));
  parts.push(ctx.accepted_proposals.map((p) => JSON.stringify(p.payload)).join(' '));
  return parts.join(' ').toLowerCase();
}

/** Build a set of every numeric token we can find in source data. */
function buildNumberSet(ctx: BriefContext): Set<string> {
  const out = new Set<string>();
  const push = (s: unknown) => {
    if (s == null) return;
    for (const t of extractNumericTokens(String(s))) out.add(t);
  };

  // Demographics
  if (ctx.patient.age_years != null) out.add(String(ctx.patient.age_years));

  // Conditions
  for (const c of ctx.conditions) {
    push(c.icd10_code);
    push(c.notes);
    push(c.onset_date);
  }
  // Allergies
  for (const a of ctx.allergies) { push(a.notes); push(a.reaction); }
  // Medications
  for (const m of ctx.medications) {
    if (m.dose_quantity != null) out.add(String(m.dose_quantity));
    if (m.duration_days != null) out.add(String(m.duration_days));
    push(m.frequency_code);
    push(m.instructions);
    push(m.start_date);
    push(m.end_date);
  }
  // Labs
  for (const l of ctx.labs) {
    if (l.value_numeric != null) out.add(String(l.value_numeric));
    push(l.value_text);
    if (l.ref_range_low  != null) out.add(String(l.ref_range_low));
    if (l.ref_range_high != null) out.add(String(l.ref_range_high));
    push(l.ref_range_text);
    push(l.resulted_at);
  }
  // Vitals
  for (const v of ctx.vitals) {
    if (v.value_quantity != null) out.add(String(v.value_quantity));
    push(v.value_string);
    push(v.effective_datetime);
  }
  // Notes (free-text — pull all numbers)
  for (const n of ctx.notes) {
    push(n.subjective); push(n.objective); push(n.assessment); push(n.plan); push(n.free_text_content);
  }
  // Encounter
  if (ctx.encounter) push(JSON.stringify(ctx.encounter));
  // Accepted proposals
  for (const p of ctx.accepted_proposals) push(JSON.stringify(p.payload));

  return out;
}

/**
 * Pull numeric tokens out of free text. Captures decimals and
 * 4-digit years; ignores dashes-as-separators (so "10-20" → "10", "20").
 */
function extractNumericTokens(s: string): string[] {
  const matches = s.match(/-?\d+(?:\.\d+)?/g);
  return matches ? matches.map((m) => m.replace(/^-/, '')) : [];
}
