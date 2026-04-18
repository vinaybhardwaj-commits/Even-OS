/**
 * Chart audit helpers — PC.3.1.
 *
 * Two writers:
 *   - `logChartEdit`       → inserts a row into `chart_audit_log`
 *   - `logChartFieldView`  → inserts a row into `chart_view_audit` (only
 *                            when the rendered field is in the role's
 *                            `sensitive_fields` list)
 *
 * Both are fire-and-forget: any failure swallows the error (console.warn)
 * so the core clinical path is never blocked by audit IO. Callers don't
 * need to await — but doing so guarantees the row is written before the
 * response is returned to the client.
 *
 * Policy (PRD v2.0 §9):
 *   - Every chart edit logs.
 *   - Normal reads are NOT logged — only sensitive-field views.
 *   - Small diff summaries only; never store PHI payloads.
 */

import { neon } from '@neondatabase/serverless';

export type ChartEditInput = {
  patient_id: string;
  encounter_id?: string | null;
  hospital_id: string;
  user_id?: string | null;
  user_role: string;
  action: string;          // 'note.create' | 'order.place' | …
  resource_type: string;   // 'note' | 'order' | 'condition' | …
  resource_id?: string | null;
  payload_summary?: Record<string, unknown>;
};

export type ChartFieldViewInput = {
  patient_id: string;
  hospital_id: string;
  user_id?: string | null;
  user_role: string;
  field_name: string;
  tab_id?: string | null;
  access_reason?: string | null;
};

export async function logChartEdit(input: ChartEditInput): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  try {
    const sql = neon(url);
    await sql`
      INSERT INTO chart_audit_log
        (patient_id, encounter_id, hospital_id, user_id, user_role,
         action, resource_type, resource_id, payload_summary)
      VALUES (
        ${input.patient_id},
        ${input.encounter_id ?? null},
        ${input.hospital_id},
        ${input.user_id ?? null},
        ${input.user_role},
        ${input.action},
        ${input.resource_type},
        ${input.resource_id ?? null},
        ${JSON.stringify(input.payload_summary ?? {})}::jsonb
      )
    `;
  } catch (err) {
    // Table missing pre-migration, network blip, etc. — don't block the
    // caller. The audit gap will show up in the Observatory's "audit write
    // failures" counter (future hook).
    // eslint-disable-next-line no-console
    console.warn('[chart-audit] logChartEdit failed:', (err as Error).message);
  }
}

export async function logChartFieldView(input: ChartFieldViewInput): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  try {
    const sql = neon(url);
    await sql`
      INSERT INTO chart_view_audit
        (patient_id, hospital_id, user_id, user_role,
         field_name, tab_id, access_reason)
      VALUES (
        ${input.patient_id},
        ${input.hospital_id},
        ${input.user_id ?? null},
        ${input.user_role},
        ${input.field_name},
        ${input.tab_id ?? null},
        ${input.access_reason ?? null}
      )
    `;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[chart-audit] logChartFieldView failed:', (err as Error).message);
  }
}
