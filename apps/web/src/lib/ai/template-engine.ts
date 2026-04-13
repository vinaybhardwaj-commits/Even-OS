/**
 * Even AI — Template Engine
 * Rule-based fallback card generation when LLM is unavailable or for time-sensitive alerts
 *
 * Features:
 * - Condition evaluation: equals, not_equals, greater_than, less_than, within_hours, contains, is_empty, is_not_empty
 * - Template interpolation with {key} placeholders
 * - Fire count and last_fired_at tracking per rule
 * - InsightCard generation with identical shape to LLM cards
 * - Deterministic rule evaluation (confidence = 1.0)
 */

import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';

import type { InsightCard, TemplateRule, AIModule } from './types';

// ============================================================================
// Lazy Singleton
// ============================================================================

let _sql: any = null;

/**
 * Get or create the Neon SQL client (lazy singleton)
 */
function getSql() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

// ============================================================================
// Condition Evaluation
// ============================================================================

/**
 * Evaluates a single condition against input data.
 *
 * Supported operators:
 * - equals: data[field] === condition.value
 * - not_equals: data[field] !== condition.value
 * - greater_than: data[field] > condition.value
 * - less_than: data[field] < condition.value
 * - within_hours: (now - data[field]) < condition.value * 3600000 (ms)
 * - contains: data[field] includes condition.value (array or string)
 * - is_empty: data[field] is falsy or empty
 * - is_not_empty: data[field] is truthy and not empty
 *
 * @param condition - Condition config: { field: string, operator: string, value?: any }
 * @param data - Input data record to evaluate against
 * @returns true if condition matches
 */
export function evaluateCondition(
  condition: Record<string, any>,
  data: Record<string, any>
): boolean {
  const { field, operator, value } = condition;

  // Safely get field value from data
  const fieldValue = data[field];

  switch (operator) {
    case 'equals':
      return fieldValue === value;

    case 'not_equals':
      return fieldValue !== value;

    case 'greater_than':
      return Number(fieldValue) > Number(value);

    case 'less_than':
      return Number(fieldValue) < Number(value);

    case 'within_hours': {
      // Check if timestamp is within X hours of now
      const fieldTime = new Date(fieldValue).getTime();
      const hoursMs = Number(value) * 3600000;
      return Date.now() - fieldTime < hoursMs;
    }

    case 'contains':
      // Works for both arrays and strings
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(value);
      }
      if (typeof fieldValue === 'string') {
        return fieldValue.includes(value);
      }
      return false;

    case 'is_empty':
      return !fieldValue || (typeof fieldValue === 'string' && fieldValue.trim() === '') ||
        (Array.isArray(fieldValue) && fieldValue.length === 0);

    case 'is_not_empty':
      return !!fieldValue && (typeof fieldValue !== 'string' || fieldValue.trim() !== '') &&
        (!Array.isArray(fieldValue) || fieldValue.length > 0);

    default:
      return false;
  }
}

// ============================================================================
// Template Interpolation
// ============================================================================

/**
 * Replaces {key} placeholders in a template string with values from data.
 *
 * Example:
 *   interpolateTemplate('Predicted approval: ₹{amount}', { amount: '3,42,000' })
 *   → 'Predicted approval: ₹3,42,000'
 *
 * @param template - Template string with {key} placeholders
 * @param data - Data record containing placeholder values
 * @returns Interpolated string
 */
export function interpolateTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = data[key];
    return value !== undefined && value !== null ? String(value) : `{${key}}`;
  });
}

// ============================================================================
// Card Generation
// ============================================================================

/**
 * Generates InsightCards from matching template rules for a specific trigger.
 *
 * @param params.hospital_id - Hospital identifier
 * @param params.module - AI module (billing, clinical, etc.)
 * @param params.trigger_type - Trigger type to match (e.g., 'ot_procedure_overrun')
 * @param params.data - Input data to evaluate conditions against
 * @returns Promise<InsightCard[]> - Generated cards
 */
export async function generateFromTemplate(params: {
  hospital_id: string;
  module: AIModule;
  trigger_type: string;
  data: Record<string, any>;
}): Promise<InsightCard[]> {
  const { hospital_id, module, trigger_type, data } = params;

  try {
    const sql = getSql();

    // Query active template rules for this hospital + module + trigger_type
    const rules = await sql`
      SELECT *
      FROM ai_template_rules
      WHERE hospital_id = ${hospital_id}
        AND module = ${module}
        AND trigger_type = ${trigger_type}
        AND is_active = true
      ORDER BY priority DESC, created_at ASC
    `;

    const generatedCards: InsightCard[] = [];

    for (const rule of rules) {
      // Evaluate all conditions in the rule
      const conditions = Array.isArray(rule.condition_config)
        ? rule.condition_config
        : [rule.condition_config];

      const allConditionsMet = conditions.every((condition: Record<string, any>) =>
        evaluateCondition(condition, data)
      );

      if (!allConditionsMet) continue;

      // Generate card from template
      const cardTemplate = rule.card_template;
      const cardId = randomUUID();

      // Interpolate placeholders in template fields
      const title = interpolateTemplate(cardTemplate.title || '', data);
      const body = interpolateTemplate(cardTemplate.body || '', data);

      const card: InsightCard = {
        id: cardId,
        hospital_id,
        module,
        category: cardTemplate.category || 'alert',
        severity: cardTemplate.severity || 'medium',

        title,
        body,
        explanation: `Generated by template rule: ${rule.rule_name}`,
        data_sources: [],
        suggested_action: cardTemplate.suggested_action
          ? interpolateTemplate(cardTemplate.suggested_action, data)
          : undefined,
        action_url: cardTemplate.action_url
          ? interpolateTemplate(cardTemplate.action_url, data)
          : undefined,

        confidence: 1.0, // Templates are deterministic
        source: 'template',
        model_version: undefined,

        status: 'active',

        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Insert card into database
      await sql`
        INSERT INTO ai_insight_cards (
          id, hospital_id, module, category, severity, title, body, explanation,
          data_sources, suggested_action, action_url, confidence, source,
          status, created_at, updated_at
        )
        VALUES (
          ${card.id}, ${card.hospital_id}, ${card.module}, ${card.category}, ${card.severity},
          ${card.title}, ${card.body}, ${card.explanation},
          ${JSON.stringify(card.data_sources)}, ${card.suggested_action},
          ${card.action_url}, ${card.confidence}, ${card.source},
          ${card.status}, ${card.created_at}, ${card.updated_at}
        )
      `;

      // Update rule's fire_count and last_fired_at
      await sql`
        UPDATE ai_template_rules
        SET fire_count = fire_count + 1, last_fired_at = NOW()
        WHERE id = ${rule.id}
      `;

      generatedCards.push(card);
    }

    return generatedCards;
  } catch (error) {
    console.error(
      `[TemplateEngine] Error generating from template: ${params.trigger_type}`,
      error
    );
    throw error;
  }
}

// ============================================================================
// Bulk Generation
// ============================================================================

/**
 * Generates InsightCards from ALL active rules for a module (regardless of trigger_type).
 *
 * Used by background jobs that scan across all rules without a specific trigger.
 *
 * @param params.hospital_id - Hospital identifier
 * @param params.module - AI module (billing, clinical, etc.)
 * @param params.data - Input data to evaluate conditions against
 * @returns Promise<InsightCard[]> - Generated cards
 */
export async function generateFromAllRules(params: {
  hospital_id: string;
  module: AIModule;
  data: Record<string, any>;
}): Promise<InsightCard[]> {
  const { hospital_id, module, data } = params;

  try {
    const sql = getSql();

    // Query all active template rules for this hospital + module
    const rules = await sql`
      SELECT *
      FROM ai_template_rules
      WHERE hospital_id = ${hospital_id}
        AND module = ${module}
        AND is_active = true
      ORDER BY priority DESC, created_at ASC
    `;

    const generatedCards: InsightCard[] = [];

    for (const rule of rules) {
      // Evaluate all conditions in the rule
      const conditions = Array.isArray(rule.condition_config)
        ? rule.condition_config
        : [rule.condition_config];

      const allConditionsMet = conditions.every((condition: Record<string, any>) =>
        evaluateCondition(condition, data)
      );

      if (!allConditionsMet) continue;

      // Generate card from template
      const cardTemplate = rule.card_template;
      const cardId = randomUUID();

      // Interpolate placeholders in template fields
      const title = interpolateTemplate(cardTemplate.title || '', data);
      const body = interpolateTemplate(cardTemplate.body || '', data);

      const card: InsightCard = {
        id: cardId,
        hospital_id,
        module,
        category: cardTemplate.category || 'alert',
        severity: cardTemplate.severity || 'medium',

        title,
        body,
        explanation: `Generated by template rule: ${rule.rule_name}`,
        data_sources: [],
        suggested_action: cardTemplate.suggested_action
          ? interpolateTemplate(cardTemplate.suggested_action, data)
          : undefined,
        action_url: cardTemplate.action_url
          ? interpolateTemplate(cardTemplate.action_url, data)
          : undefined,

        confidence: 1.0,
        source: 'template',
        model_version: undefined,

        status: 'active',

        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Insert card into database
      await sql`
        INSERT INTO ai_insight_cards (
          id, hospital_id, module, category, severity, title, body, explanation,
          data_sources, suggested_action, action_url, confidence, source,
          status, created_at, updated_at
        )
        VALUES (
          ${card.id}, ${card.hospital_id}, ${card.module}, ${card.category}, ${card.severity},
          ${card.title}, ${card.body}, ${card.explanation},
          ${JSON.stringify(card.data_sources)}, ${card.suggested_action},
          ${card.action_url}, ${card.confidence}, ${card.source},
          ${card.status}, ${card.created_at}, ${card.updated_at}
        )
      `;

      // Update rule's fire_count and last_fired_at
      await sql`
        UPDATE ai_template_rules
        SET fire_count = fire_count + 1, last_fired_at = NOW()
        WHERE id = ${rule.id}
      `;

      generatedCards.push(card);
    }

    return generatedCards;
  } catch (error) {
    console.error(
      `[TemplateEngine] Error generating from all rules for module: ${module}`,
      error
    );
    throw error;
  }
}

// ============================================================================
// Rule Management
// ============================================================================

/**
 * Lists all active template rules for a hospital and optional module.
 *
 * @param hospital_id - Hospital identifier
 * @param module - Optional AI module filter
 * @returns Promise<TemplateRule[]> - Active rules
 */
export async function listActiveRules(
  hospital_id: string,
  module?: AIModule
): Promise<TemplateRule[]> {
  try {
    const sql = getSql();

    let query = sql`
      SELECT *
      FROM ai_template_rules
      WHERE hospital_id = ${hospital_id}
        AND is_active = true
    `;

    if (module) {
      query = sql`
        SELECT *
        FROM ai_template_rules
        WHERE hospital_id = ${hospital_id}
          AND module = ${module}
          AND is_active = true
        ORDER BY priority DESC, created_at ASC
      `;
    } else {
      query = sql`
        SELECT *
        FROM ai_template_rules
        WHERE hospital_id = ${hospital_id}
          AND is_active = true
        ORDER BY module, priority DESC, created_at ASC
      `;
    }

    const rules = await query;
    return rules as TemplateRule[];
  } catch (error) {
    console.error(`[TemplateEngine] Error listing active rules for hospital: ${hospital_id}`, error);
    throw error;
  }
}
