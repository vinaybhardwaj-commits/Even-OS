/**
 * PC.4.C.2 — DegradedBanner.
 *
 * Red-only sticky strip between the chart header and the tab bar.
 * Appears only when at least one probe is red; one concise line listing
 * which subsystem is failing plus what that means for the user right now.
 *
 * Design intent:
 * - Stays hidden by default. Shows only on red, never yellow — yellow is
 *   conveyed by the dots, the banner is the "actually broken" signal.
 * - No action buttons yet. That's PC.4.C.3 (retry / flush queue) territory.
 * - role="status" with aria-live="polite" so it's announced without
 *   stealing focus.
 */

'use client';

import { useChartHealth } from './use-chart-health';

const COPY: Record<string, { title: string; hint: string }> = {
  db: {
    title: 'Database is slow or unreachable',
    hint: 'Saves are being queued and will replay when it recovers.',
  },
  qwen: {
    title: 'AI assistance is offline',
    hint: 'Proposals, briefs, and auto-tagging paused. Manual workflows still work.',
  },
  oc: {
    title: 'Chat is unreachable',
    hint: 'Messages may take longer to deliver. Use voice/phone for urgent calls.',
  },
  blob: {
    title: 'Document storage is unreachable',
    hint: 'Uploads paused. View/download of existing files may be slow.',
  },
  queue: {
    title: 'Background job queue is backed up',
    hint: 'AI jobs and document processing may be delayed.',
  },
};

export function DegradedBanner() {
  const { data } = useChartHealth();
  if (!data) return null;

  const red: Array<keyof typeof COPY> = (['db', 'qwen', 'oc', 'blob', 'queue'] as const).filter(
    (k) => data[k].status === 'red',
  );
  if (red.length === 0) return null;

  const primary = red[0];
  const { title, hint } = COPY[primary];
  const extra = red.length > 1 ? ` (+${red.length - 1} more)` : '';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: '#FEF2F2',
        borderTop: '1px solid #FCA5A5',
        borderBottom: '1px solid #FCA5A5',
        color: '#991B1B',
        padding: '8px 20px',
        fontSize: 13,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: '#EF4444',
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <span>
        <strong>{title}{extra}.</strong> {hint}
      </span>
    </div>
  );
}
