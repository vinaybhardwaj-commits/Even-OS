/**
 * Template Evolution Engine — TM.4
 *
 * Analyzes clinical_template_usage_log to detect patterns:
 * - Fields consistently modified → suggest new defaults
 * - Fields consistently skipped → suggest marking optional or removing
 * - Generates AI suggestions with confidence scores
 *
 * Threshold: 80% of users making same modification across 20+ uses
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { generateInsight } from './llm-client';

let _sql: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

const MIN_USES_THRESHOLD = 20;
const MODIFICATION_THRESHOLD = 0.80; // 80%
const SKIP_THRESHOLD = 0.80;         // 80%

interface EvolutionResult {
  templates_analyzed: number;
  suggestions_created: number;
  errors: number;
  details: string[];
}

export async function runTemplateEvolution(hospitalId: string): Promise<EvolutionResult> {
  const result: EvolutionResult = { templates_analyzed: 0, suggestions_created: 0, errors: 0, details: [] };

  try {
    // Get all active templates with enough usage
    const templates = await getSql()`
      SELECT id, template_name, template_category, template_fields, template_version, template_usage_count
      FROM clinical_templates
      WHERE hospital_id = ${hospitalId}
        AND template_is_active = true
        AND template_usage_count >= ${MIN_USES_THRESHOLD}
    `;

    if (!templates || (templates as any[]).length === 0) {
      result.details.push('No templates with sufficient usage found');
      return result;
    }

    for (const tpl of templates as any[]) {
      result.templates_analyzed++;
      try {
        await analyzeTemplate(tpl, hospitalId, result);
      } catch (err: any) {
        result.errors++;
        result.details.push(`Error analyzing ${tpl.template_name}: ${err.message}`);
      }
    }
  } catch (err: any) {
    result.errors++;
    result.details.push(`Fatal error: ${err.message}`);
  }

  return result;
}

async function analyzeTemplate(tpl: any, hospitalId: string, result: EvolutionResult) {
  const templateId = tpl.id;
  const fields: any[] = tpl.template_fields || [];
  const totalUses = tpl.template_usage_count || 0;

  if (fields.length === 0 || totalUses < MIN_USES_THRESHOLD) return;

  // Get usage logs for this template
  const logs = await getSql()`
    SELECT ctul_fields_modified, ctul_fields_skipped, ctul_completion_time_seconds
    FROM clinical_template_usage_log
    WHERE ctul_template_id = ${templateId}
    ORDER BY ctul_created_at DESC
    LIMIT 200
  `;

  const usageLogs = (logs as any[]) || [];
  if (usageLogs.length < MIN_USES_THRESHOLD) return;

  const logCount = usageLogs.length;

  // ── Analyze field modification patterns ────────────────────────────
  const modifiedCounts: Record<string, number> = {};
  const skippedCounts: Record<string, number> = {};

  for (const log of usageLogs) {
    const modified = log.ctul_fields_modified || [];
    const skipped = log.ctul_fields_skipped || [];

    for (const fid of (Array.isArray(modified) ? modified : [])) {
      modifiedCounts[fid] = (modifiedCounts[fid] || 0) + 1;
    }
    for (const fid of (Array.isArray(skipped) ? skipped : [])) {
      skippedCounts[fid] = (skippedCounts[fid] || 0) + 1;
    }
  }

  // Check for existing pending suggestions to avoid duplicates
  const existingSuggestions = await getSql()`
    SELECT ctas_suggestion_type, ctas_suggestion_data
    FROM clinical_template_ai_suggestions
    WHERE ctas_template_id = ${templateId} AND ctas_status = 'pending'
  `;
  const existingKeys = new Set(
    (existingSuggestions as any[]).map(s => `${s.ctas_suggestion_type}:${JSON.stringify(s.ctas_suggestion_data)}`)
  );

  // ── Generate suggestions for frequently modified fields ────────────
  for (const field of fields) {
    const fid = field.id;
    if (!fid || field.type === 'section_header' || field.type === 'divider') continue;

    const modRate = (modifiedCounts[fid] || 0) / logCount;
    const skipRate = (skippedCounts[fid] || 0) / logCount;

    // Suggestion: field consistently modified → suggest default change
    if (modRate >= MODIFICATION_THRESHOLD) {
      const suggestionData = { field_id: fid, field_label: field.label, modification_rate: Math.round(modRate * 100) };
      const key = `default_change:${JSON.stringify(suggestionData)}`;
      if (!existingKeys.has(key)) {
        await createSuggestion(templateId, 'default_change', suggestionData, modRate, {
          total_uses: logCount,
          times_modified: modifiedCounts[fid] || 0,
          threshold: `${Math.round(MODIFICATION_THRESHOLD * 100)}%`,
        });
        result.suggestions_created++;
        result.details.push(`${tpl.template_name}: "${field.label}" modified ${Math.round(modRate * 100)}% of the time → suggested default change`);
      }
    }

    // Suggestion: field consistently skipped → suggest removal or mark optional
    if (skipRate >= SKIP_THRESHOLD && field.required) {
      const suggestionData = { field_id: fid, field_label: field.label, skip_rate: Math.round(skipRate * 100) };
      const key = `field_removal:${JSON.stringify(suggestionData)}`;
      if (!existingKeys.has(key)) {
        await createSuggestion(templateId, 'field_removal', suggestionData, skipRate, {
          total_uses: logCount,
          times_skipped: skippedCounts[fid] || 0,
          threshold: `${Math.round(SKIP_THRESHOLD * 100)}%`,
        });
        result.suggestions_created++;
        result.details.push(`${tpl.template_name}: "${field.label}" skipped ${Math.round(skipRate * 100)}% of the time → suggested removal or make optional`);
      }
    }
  }

  // ── Analyze completion time for overall template optimization ──────
  const avgTime = usageLogs.reduce((s, l) => s + (l.ctul_completion_time_seconds || 0), 0) / logCount;
  if (avgTime > 600) { // >10 minutes average
    result.details.push(`${tpl.template_name}: avg completion time ${Math.round(avgTime / 60)}m — may need simplification`);
  }
}

async function createSuggestion(
  templateId: string,
  type: string,
  data: Record<string, any>,
  confidence: number,
  evidence: Record<string, any>,
) {
  const id = crypto.randomUUID();
  await getSql()`
    INSERT INTO clinical_template_ai_suggestions (
      id, ctas_template_id, ctas_suggestion_type, ctas_suggestion_data,
      ctas_confidence_score, ctas_supporting_evidence, ctas_status, ctas_created_at
    ) VALUES (
      ${id}, ${templateId}, ${type}, ${JSON.stringify(data)}::jsonb,
      ${confidence}, ${JSON.stringify(evidence)}::jsonb, 'pending', NOW()
    )
  `;
}
