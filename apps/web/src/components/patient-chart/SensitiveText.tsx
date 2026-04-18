'use client';
/**
 * SensitiveText — PC.3.2.3.
 *
 * Render-time redaction for matrix-flagged fields. When the current role's
 * chartConfig.sensitive_fields contains `field`, the component shows a
 * neutral "Restricted" badge instead of the real value — and fires a
 * one-time chart_view_audit entry so we know the field was hidden from
 * this user in this session.
 *
 * Fallback configs never redact (source must be 'matrix'). See
 * `isFieldSensitive` in @/lib/chart/redact.
 */

import React from 'react';
import type { ChartConfig } from '@/lib/chart/selectors';
import { isFieldSensitive, REDACTED_LABEL } from '@/lib/chart/redact';

// Per-page Set so duplicate field-views in the same session don't hammer
// the audit table. The Set lives for the lifetime of the page — refresh
// resets it, which is the intended behaviour (one audit per field per
// session).
const VIEWED_FIELDS = new Set<string>();

function keyOf(patient_id: string, field: string): string {
  return `${patient_id}::${field}`;
}

// Fire-and-forget tRPC mutation call using the repo's existing fetch
// pattern (same shape as CalcRunner's trpcMutate). We deliberately DO NOT
// await or throw — audit failures must never block a render.
function fireLogFieldView(input: {
  patient_id: string;
  field_name: string;
  tab_id?: string;
  access_reason?: string;
}): void {
  try {
    void fetch('/api/trpc/chartAudit.logFieldView', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: input }),
    }).catch(() => {
      /* swallow */
    });
  } catch {
    /* swallow */
  }
}

/**
 * Hook version — returns a stable callback for callers that need to log
 * a sensitive-field view programmatically (e.g. when expanding a row
 * that reveals a redacted value on demand). Deduplicates per session.
 */
export function useLogFieldView() {
  return React.useCallback(
    (args: {
      patient_id: string;
      field_name: string;
      tab_id?: string;
      access_reason?: string;
    }) => {
      const k = keyOf(args.patient_id, args.field_name);
      if (VIEWED_FIELDS.has(k)) return;
      VIEWED_FIELDS.add(k);
      fireLogFieldView(args);
    },
    [],
  );
}

export type SensitiveTextProps = {
  field: string;
  chartConfig?: ChartConfig | null;
  patientId: string;
  tabId?: string;
  /** The real value to render if not redacted. */
  children: React.ReactNode;
  /** Optional CSS class on the redacted badge. */
  className?: string;
};

/**
 * Wrap a field value with this component to get automatic matrix-driven
 * redaction. Safe to use for all roles — non-sensitive fields render
 * the children untouched with zero overhead.
 */
export function SensitiveText(props: SensitiveTextProps) {
  const redacted = isFieldSensitive(props.field, props.chartConfig);

  React.useEffect(() => {
    if (!redacted) return;
    const k = keyOf(props.patientId, props.field);
    if (VIEWED_FIELDS.has(k)) return;
    VIEWED_FIELDS.add(k);
    fireLogFieldView({
      patient_id: props.patientId,
      field_name: props.field,
      tab_id: props.tabId,
      access_reason: 'sensitive_field_render',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redacted, props.patientId, props.field]);

  if (!redacted) return <>{props.children}</>;

  return (
    <span
      className={
        props.className ??
        'inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-gray-200'
      }
      title="Hidden for this role per hospital policy"
    >
      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M10 2a4 4 0 00-4 4v2H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-1V6a4 4 0 00-4-4zm2 6V6a2 2 0 10-4 0v2h4z"
          clipRule="evenodd"
        />
      </svg>
      {REDACTED_LABEL}
    </span>
  );
}
