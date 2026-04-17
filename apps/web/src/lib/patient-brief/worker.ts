/**
 * Patient Brief — Worker
 *
 * Consumes ai_request_queue items where prompt_template = 'regenerate_brief'.
 * Steps:
 *   1. Resolve patient_id + trigger_event from input_data
 *   2. Gather context (gatherBriefContext)
 *   3. Build prompt + call Qwen via generateInsight (module='patient_brief')
 *   4. Parse JSON output (parseBriefOutput) — Zod-validated
 *   5. Run structured grounding check (groundBrief)
 *   6. Mark previous brief is_stale = true (supersede)
 *   7. INSERT patient_briefs + patient_brief_sources rows
 *
 * Failure modes:
 *   - patient missing → ok:false, do not throw (process-queue marks failed)
 *   - LLM no content / parse fail → ok:false with reason
 *   - we never block on grounding flags — they're written and surfaced in UI
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { generateInsight } from '@/lib/ai/llm-client';
import { gatherBriefContext, type BriefContext } from './context';
import { BRIEF_SYSTEM_PROMPT, buildBriefUserPrompt, parseBriefOutput } from './prompt';
import { groundBrief } from './grounding';

export interface RegenerateBriefInput {
  id: string;                                  // queue row id (for audit)
  hospital_id: string;                          // uuid (queue's audit hospital_id)
  input_data: unknown;                          // {patient_id, trigger, trigger_tags?, triggered_by?}
  attempts?: number;
  max_attempts?: number;
}

export interface RegenerateBriefResult {
  ok: boolean;
  brief_id?: string;
  version?: number;
  superseded_id?: string;
  hallucination_count?: number;
  error?: string;
}

// ============================================================
// MAIN
// ============================================================

export async function processRegenerateBrief(
  sql: NeonQueryFunction<false, false>,
  item: RegenerateBriefInput,
): Promise<RegenerateBriefResult> {
  // 1. Parse input ----------------------------------------------------------
  const input = typeof item.input_data === 'string' ? JSON.parse(item.input_data) : item.input_data;
  const patientId: string | undefined = input?.patient_id;
  const triggerEvent: string         = input?.trigger ?? input?.trigger_event ?? 'manual';
  const triggeredBy: string | null   = input?.triggered_by ?? null;
  if (!patientId) return { ok: false, error: 'input_data.patient_id missing' };

  // 2. Resolve text-key hospital + previous brief --------------------------
  const patientLookup = await sql`
    SELECT p.hospital_id AS hospital_text_id
    FROM patients p
    WHERE p.id = ${patientId}
    LIMIT 1
  ` as Array<{ hospital_text_id: string }>;
  if (patientLookup.length === 0) return { ok: false, error: `patient ${patientId} not found` };
  const hospitalTextId = patientLookup[0]!.hospital_text_id;

  const prevRows = await sql`
    SELECT id, version
    FROM patient_briefs
    WHERE patient_id = ${patientId}
    ORDER BY version DESC
    LIMIT 1
  ` as Array<{ id: string; version: number }>;
  const prev = prevRows[0] ?? null;
  const nextVersion = (prev?.version ?? 0) + 1;

  // 3. Gather context -------------------------------------------------------
  let ctx: BriefContext;
  try {
    ctx = await gatherBriefContext(sql, patientId);
  } catch (err) {
    return { ok: false, error: `gatherBriefContext failed: ${(err as Error).message}` };
  }

  // 4. Build prompt + call LLM ---------------------------------------------
  const userPrompt = buildBriefUserPrompt(ctx);
  const llm = await generateInsight({
    hospital_id:    item.hospital_id,
    module:         'patient_brief',
    system_prompt:  BRIEF_SYSTEM_PROMPT,
    user_prompt:    userPrompt,
    max_tokens:     1500,
    temperature:    0.1,
    triggered_by:   'event',
  });
  if (!llm || !llm.content) {
    return { ok: false, error: 'LLM returned no content' };
  }

  // 5. Parse + validate -----------------------------------------------------
  const parsed = parseBriefOutput(llm.content);
  if (!parsed.ok || !parsed.data) {
    return { ok: false, error: `parse failed: ${parsed.error ?? 'unknown'}` };
  }
  const brief = parsed.data;

  // 6. Grounding check ------------------------------------------------------
  const grounding = groundBrief(ctx, brief);

  // 7. Supersede previous (mark stale), then insert new --------------------
  if (prev) {
    await sql`
      UPDATE patient_briefs
      SET is_stale = true
      WHERE id = ${prev.id}
    `;
  }

  const insertRows = await sql`
    INSERT INTO patient_briefs (
      hospital_id, patient_id, encounter_id, version,
      narrative, structured,
      trigger_event, triggered_by,
      llm_audit_id, source_ids, hallucination_flags,
      is_stale, supersedes_id,
      generated_at, created_at
    ) VALUES (
      ${hospitalTextId},
      ${patientId},
      ${ctx.encounter?.id ?? null},
      ${nextVersion},
      ${brief.narrative},
      ${JSON.stringify(brief.structured)}::jsonb,
      ${triggerEvent}::brief_trigger,
      ${triggeredBy},
      ${(llm as any).audit_id ?? null},
      ${JSON.stringify(ctx.source_ids)}::jsonb,
      ${JSON.stringify(grounding.flags)}::jsonb,
      false,
      ${prev?.id ?? null},
      NOW(), NOW()
    )
    RETURNING id
  ` as Array<{ id: string }>;

  const briefId = insertRows[0]!.id;

  // 8. Write detail rows for traceability ----------------------------------
  if (ctx.source_ids.length > 0) {
    // Build a single multi-row INSERT — Neon http driver supports this via tagged template.
    // We do it in chunks of 100 to stay well under any statement-size limits.
    const chunkSize = 100;
    for (let i = 0; i < ctx.source_ids.length; i += chunkSize) {
      const chunk = ctx.source_ids.slice(i, i + chunkSize);
      const values = chunk.map((s) => `('${briefId}','${s.source_table.replace(/'/g, "''")}','${s.source_id}', NOW())`).join(',');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sql as any)(`INSERT INTO patient_brief_sources (brief_id, source_table, source_id, included_at) VALUES ${values}`);
    }
  }

  return {
    ok:                  true,
    brief_id:            briefId,
    version:             nextVersion,
    superseded_id:       prev?.id,
    hallucination_count: grounding.flags.length,
  };
}
