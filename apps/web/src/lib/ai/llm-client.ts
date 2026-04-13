/**
 * Even AI — LLM Client
 * OpenAI SDK wrapper for Qwen 2.5 14B via Ollama + Cloudflare Tunnel
 *
 * Features:
 * - Lazy singleton pattern for efficient resource use
 * - PII de-identification before LLM transmission
 * - Full audit logging to ai_audit_log table for traceability
 * - Graceful fallback (returns null if LLM unavailable)
 * - Health check and observability
 */

import OpenAI from 'openai';
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

import type { LLMResponse, AuditLogStatus } from './types';

// ============================================================================
// Lazy Singletons
// ============================================================================

let _client: OpenAI | null = null;
let _sql: any = null;

/**
 * Get or create the OpenAI client (lazy singleton)
 */
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
      apiKey: process.env.LLM_API_KEY || 'ollama',
      timeout: parseInt(process.env.LLM_TIMEOUT_MS || '30000'),
    });
  }
  return _client;
}

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
// PII De-identification
// ============================================================================

/**
 * De-identify text by replacing common PII patterns with placeholders
 * - Indian phone numbers (10-digit)
 * - Aadhaar numbers (12-digit with spaces)
 * - Email addresses
 * - IP addresses
 */
export function deidentifyText(text: string): string {
  if (!text) return text;

  let deidentified = text;

  // Indian phone numbers (10 digits, optionally preceded by +91 or 0)
  deidentified = deidentified.replace(
    /(?:\+91|0)?[6-9]\d{9}/g,
    '[REDACTED_PHONE]'
  );

  // Aadhaar numbers (12 digits with optional spaces: XXXX XXXX XXXX)
  deidentified = deidentified.replace(
    /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    '[REDACTED_AADHAAR]'
  );

  // Email addresses
  deidentified = deidentified.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    '[REDACTED_EMAIL]'
  );

  // IP addresses (IPv4)
  deidentified = deidentified.replace(
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    '[REDACTED_IP]'
  );

  return deidentified;
}

/**
 * Hash input data for audit trail (to detect duplicate requests)
 */
function hashInputData(userPrompt: string): string {
  return crypto
    .createHash('sha256')
    .update(userPrompt)
    .digest('hex');
}

// ============================================================================
// Core LLM Inference
// ============================================================================

export interface GenerateInsightParams {
  hospital_id: string;
  module: string;
  system_prompt: string;
  user_prompt: string;
  max_tokens?: number;
  temperature?: number;
  triggered_by: 'cron' | 'manual' | 'event' | 'template';
  user_id?: string;
}

/**
 * Generate an insight using the LLM
 * - De-identifies prompts before transmission
 * - Logs full request/response to ai_audit_log
 * - Returns null on error (graceful fallback)
 */
export async function generateInsight(
  params: GenerateInsightParams
): Promise<LLMResponse | null> {
  const {
    hospital_id,
    module,
    system_prompt,
    user_prompt,
    max_tokens = 500,
    temperature = 0.7,
    triggered_by,
    user_id,
  } = params;

  const startTime = Date.now();
  let status: AuditLogStatus = 'success';
  let errorMessage: string | null = null;
  let response: LLMResponse | null = null;

  try {
    // De-identify prompts before sending to LLM
    const deidentifiedSystem = deidentifyText(system_prompt);
    const deidentifiedUser = deidentifyText(user_prompt);

    // Call LLM
    const client = getClient();
    const model = process.env.LLM_MODEL || 'qwen2.5:14b';

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: deidentifiedSystem },
        { role: 'user', content: deidentifiedUser },
      ],
      max_tokens,
      temperature,
    });

    const latency = Date.now() - startTime;
    const promptTokens = completion.usage?.prompt_tokens || 0;
    const completionTokens = completion.usage?.completion_tokens || 0;

    response = {
      content: completion.choices[0]?.message?.content || '',
      tokens_used: {
        prompt: promptTokens,
        completion: completionTokens,
      },
      latency_ms: latency,
      model,
    };
  } catch (err) {
    status = 'error';
    errorMessage =
      err instanceof Error ? err.message : 'Unknown LLM error';

    // Log timeout separately for observability
    if (err instanceof Error && err.message.includes('timeout')) {
      status = 'timeout';
    }
  }

  // Audit log (async, non-blocking)
  logToAuditTable({
    hospital_id,
    module,
    prompt_text: user_prompt,
    prompt_tokens: response?.tokens_used.prompt,
    response_text: response?.content || '',
    response_tokens: response?.tokens_used.completion,
    model: response?.model || process.env.LLM_MODEL || 'qwen2.5:14b',
    latency_ms: Date.now() - startTime,
    status,
    error_message: errorMessage,
    input_data_hash: hashInputData(user_prompt),
    triggered_by,
    user_id,
  }).catch((err) => {
    // Audit failure should not break the main flow
    console.error('[LLM] Audit log error:', err);
  });

  return response;
}

// ============================================================================
// Health Check
// ============================================================================

export interface HealthCheckResult {
  status: 'online' | 'offline' | 'degraded';
  latency_ms: number;
  model: string;
}

/**
 * Check if the LLM is healthy and responsive
 * Returns null if LLM is offline
 */
export async function checkHealth(): Promise<HealthCheckResult | null> {
  const startTime = Date.now();

  try {
    const client = getClient();
    const model = process.env.LLM_MODEL || 'qwen2.5:14b';

    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'user',
          content: 'Say OK',
        },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const latency = Date.now() - startTime;

    // Determine health status based on latency
    let status: 'online' | 'degraded' = 'online';
    if (latency > 10000) {
      status = 'degraded';
    }

    return {
      status,
      latency_ms: latency,
      model,
    };
  } catch (err) {
    return {
      status: 'offline',
      latency_ms: Date.now() - startTime,
      model: process.env.LLM_MODEL || 'qwen2.5:14b',
    };
  }
}

// ============================================================================
// Audit Logging
// ============================================================================

interface AuditLogParams {
  hospital_id: string;
  module: string;
  prompt_text: string;
  prompt_tokens?: number;
  response_text: string;
  response_tokens?: number;
  model: string;
  latency_ms: number;
  status: AuditLogStatus;
  error_message: string | null;
  input_data_hash?: string;
  triggered_by: 'cron' | 'manual' | 'event' | 'template';
  user_id?: string;
}

/**
 * Log an LLM request/response to the audit table (async, non-blocking)
 */
async function logToAuditTable(params: AuditLogParams): Promise<void> {
  try {
    const sql = getSql();

    await sql`
      INSERT INTO ai_audit_log (
        hospital_id,
        module,
        prompt_text,
        prompt_tokens,
        response_text,
        response_tokens,
        model,
        latency_ms,
        status,
        error_message,
        input_data_hash,
        triggered_by,
        user_id,
        created_at
      )
      VALUES (
        ${params.hospital_id},
        ${params.module},
        ${params.prompt_text},
        ${params.prompt_tokens || null},
        ${params.response_text},
        ${params.response_tokens || null},
        ${params.model},
        ${params.latency_ms},
        ${params.status},
        ${params.error_message || null},
        ${params.input_data_hash || null},
        ${params.triggered_by},
        ${params.user_id || null},
        NOW()
      )
    `;
  } catch (err) {
    // Silently fail to avoid breaking the main flow
    console.error('[LLM] Failed to write audit log:', err);
  }
}

// ============================================================================
// Observability & Stats
// ============================================================================

export interface AuditStats {
  cards_generated_today: number;
  last_successful_inference: string | null;
  avg_latency_ms: number;
}

/**
 * Get recent audit statistics for a hospital
 */
export async function getRecentAuditStats(
  hospital_id: string
): Promise<AuditStats> {
  try {
    const sql = getSql();

    // Today's successful inferences
    const statsResult = await sql`
      SELECT
        COUNT(*) as count,
        AVG(latency_ms)::int as avg_latency,
        MAX(created_at) as last_successful
      FROM ai_audit_log
      WHERE hospital_id = ${hospital_id}
        AND status = 'success'
        AND created_at >= CURRENT_DATE
    `;

    const row = statsResult[0] || {};

    return {
      cards_generated_today: parseInt(row.count || '0', 10),
      last_successful_inference: row.last_successful || null,
      avg_latency_ms: parseInt(row.avg_latency || '0', 10),
    };
  } catch (err) {
    console.error('[LLM] Failed to fetch audit stats:', err);
    return {
      cards_generated_today: 0,
      last_successful_inference: null,
      avg_latency_ms: 0,
    };
  }
}

/**
 * Get error count in the last hour
 */
export async function getErrorCountLastHour(
  hospital_id: string
): Promise<number> {
  try {
    const sql = getSql();

    const result = await sql`
      SELECT COUNT(*) as count
      FROM ai_audit_log
      WHERE hospital_id = ${hospital_id}
        AND status IN ('error', 'timeout')
        AND created_at >= NOW() - INTERVAL '1 hour'
    `;

    return parseInt(result[0]?.count || '0', 10);
  } catch (err) {
    console.error('[LLM] Failed to fetch error count:', err);
    return 0;
  }
}

/**
 * Get average latency in the last hour (for trends)
 */
export async function getLatencyTrendLastHour(
  hospital_id: string
): Promise<Array<{ timestamp: string; latency_ms: number }>> {
  try {
    const sql = getSql();

    const result = await sql`
      SELECT
        DATE_TRUNC('5 minutes', created_at) as timestamp,
        AVG(latency_ms)::int as latency_ms
      FROM ai_audit_log
      WHERE hospital_id = ${hospital_id}
        AND status = 'success'
        AND created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY DATE_TRUNC('5 minutes', created_at)
      ORDER BY timestamp ASC
    `;

    return result.map((row: any) => ({
      timestamp: row.timestamp || '',
      latency_ms: parseInt(row.latency_ms || '0', 10),
    }));
  } catch (err) {
    console.error('[LLM] Failed to fetch latency trend:', err);
    return [];
  }
}

/**
 * Get request distribution by module (last 24h)
 */
export async function getRequestsByModule(
  hospital_id: string
): Promise<Array<{ module: string; count: number; avg_latency: number }>> {
  try {
    const sql = getSql();

    const result = await sql`
      SELECT
        module,
        COUNT(*) as count,
        AVG(latency_ms)::int as avg_latency
      FROM ai_audit_log
      WHERE hospital_id = ${hospital_id}
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY module
      ORDER BY count DESC
    `;

    return result.map((row: any) => ({
      module: row.module || '',
      count: parseInt(row.count || '0', 10),
      avg_latency: parseInt(row.avg_latency || '0', 10),
    }));
  } catch (err) {
    console.error('[LLM] Failed to fetch requests by module:', err);
    return [];
  }
}
