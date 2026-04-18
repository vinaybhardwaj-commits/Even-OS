/**
 * Chart field redaction — PC.3.2.3.
 *
 * Tiny helper layer that decides, for a given ChartConfig + field name,
 * whether the value must be hidden before it renders. Redaction is a pure
 * function of (field_name, chartConfig.sensitive_fields), and only kicks
 * in when the config came from the matrix — fallback configs never redact
 * (so an offline matrix never silently hides fields from clinicians).
 *
 * Policy (PRD v2.0 §7, §9):
 *   - Sensitive fields for a role are listed in chart_permission_matrix.
 *   - When redacted, the UI shows a neutral "Restricted" badge instead
 *     of the real value. The raw value never reaches the client-side
 *     component instance (in PC.3.3 we'll move the redact to the query
 *     layer so it's not even on the wire; for PC.3.2.3 we do it at the
 *     render boundary, which is the narrowest place to wire it without
 *     rewriting every tRPC procedure).
 *   - First sensitive-field view fires chart_view_audit. See useLogFieldView.
 */

import type { ChartConfig } from './selectors';

export const REDACTED_LABEL = 'Restricted';

/**
 * Is this field redacted for this chartConfig?
 *
 * Returns false if chartConfig is missing, the list is empty, or source is
 * 'fallback' (matrix layer is down — don't start hiding fields we can't
 * verify the role shouldn't see).
 */
export function isFieldSensitive(
  field: string,
  chartConfig?: ChartConfig | null,
): boolean {
  if (!chartConfig) return false;
  if (chartConfig.source !== 'matrix') return false;
  if (!Array.isArray(chartConfig.sensitive_fields)) return false;
  if (chartConfig.sensitive_fields.length === 0) return false;
  return chartConfig.sensitive_fields.includes(field);
}

/**
 * Returns the raw value if not redacted, otherwise the REDACTED_LABEL
 * string. Useful for simple text cells that don't need styling.
 */
export function redactValue<T>(
  value: T,
  field: string,
  chartConfig?: ChartConfig | null,
): T | typeof REDACTED_LABEL {
  if (!isFieldSensitive(field, chartConfig)) return value;
  return REDACTED_LABEL;
}

/**
 * Does this chartConfig have any sensitive fields at all? Used by the
 * useLogFieldView hook to skip the dedupe Set when nothing can fire.
 */
export function hasAnySensitiveFields(chartConfig?: ChartConfig | null): boolean {
  if (!chartConfig) return false;
  if (chartConfig.source !== 'matrix') return false;
  return Array.isArray(chartConfig.sensitive_fields) && chartConfig.sensitive_fields.length > 0;
}


// ─── PC.3.3.D — server-side projection ─────────────────────────
//
// Until PC.3.3, sensitive-field redaction was a *client-side* render pass
// (SensitiveText) — the raw value still travelled over the wire. PRD §7
// demands server-side projection. `projectRowsForRole` gives tRPC
// procedures a one-line helper to enforce it before the query returns.
//
//   rows   — the raw DB rows (array of POJOs)
//   fieldMap — { dbColumn: sensitiveFieldName }  (so the caller maps
//              e.g. `drug_name` → `medications`)
//   chartConfig — from chartSelectors.forRole()
//
// If `chartConfig.source !== 'matrix'` we do NOT redact (fallback mode
// is permissive by design, per the same safety argument as the client
// layer — don't hide fields when the matrix is offline, clinicians need
// them). When the field IS sensitive we replace the cell with the
// REDACTED_LABEL sentinel string, leaving all other columns untouched.
//
// Safe on empty / null values (they stay null), safe on arrays (mapped
// row-by-row), safe on non-string values (coerced to sentinel string).

export function projectRowsForRole<T extends Record<string, unknown>>(
  rows: T[] | null | undefined,
  fieldMap: Record<string, string>,
  chartConfig?: ChartConfig | null,
): T[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows ?? [];
  if (!chartConfig) return rows;
  if (chartConfig.source !== 'matrix') return rows;
  const sensitive = new Set(chartConfig.sensitive_fields ?? []);
  if (sensitive.size === 0) return rows;

  // Compute which DB columns to redact once, not per-row.
  const redactCols: string[] = [];
  for (const [col, field] of Object.entries(fieldMap)) {
    if (sensitive.has(field)) redactCols.push(col);
  }
  if (redactCols.length === 0) return rows;

  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const col of redactCols) {
      if (out[col] !== null && out[col] !== undefined) {
        out[col] = REDACTED_LABEL;
      }
    }
    return out as T;
  });
}

// Single-row variant. Same semantics as projectRowsForRole but for
// procedures that return a scalar object (e.g. getDetail).
export function projectRowForRole<T extends Record<string, unknown>>(
  row: T | null | undefined,
  fieldMap: Record<string, string>,
  chartConfig?: ChartConfig | null,
): T | null {
  if (!row) return null;
  const [r] = projectRowsForRole([row], fieldMap, chartConfig);
  return r ?? null;
}
