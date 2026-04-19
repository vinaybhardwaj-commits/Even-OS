/**
 * PC.4.C.2 — HealthDots.
 *
 * 5-dot chart-header widget: DB · Qwen · OC · Blob · Queue.
 * Colors: green / yellow / red / grey (unknown). Each dot has a title
 * tooltip with subsystem + status + metric + p95 + sample count.
 *
 * Designed to sit inside the chart's dark-blue Row 1 header alongside the
 * bed / day / attending badges. Compact (5 × 10px dots + 2px gaps).
 * Polite aria-live on status change so assistive tech announces
 * 'DB is red' without interrupting screen-reader flow.
 *
 * Clicking the row opens a tiny popover with the per-probe breakdown —
 * handy for eyeballing which subsystem is slow.
 */

'use client';

import { useState } from 'react';
import { useChartHealth } from './use-chart-health';
import type { ProbeResult } from '@/lib/chart/degraded-mode';

type DotKey = 'db' | 'qwen' | 'oc' | 'blob' | 'queue';

const LABELS: Record<DotKey, string> = {
  db:    'Database',
  qwen:  'AI (Qwen)',
  oc:    'Chat (OC)',
  blob:  'Document Storage',
  queue: 'Job Queue',
};

const COLORS: Record<string, string> = {
  green:   '#22C55E',
  yellow:  '#F59E0B',
  red:     '#EF4444',
  unknown: '#94A3B8',
};

function formatMetric(probe: ProbeResult | undefined): string {
  if (!probe) return '—';
  if (probe.skipped) return `disabled (${probe.error || 'opt-out'})`;
  if (probe.metric === null) return '—';
  if (probe.metric_label === 'latency_ms') return `${Math.round(probe.metric)}ms`;
  if (probe.metric_label === 'depth') return `${probe.metric} jobs`;
  return String(probe.metric);
}

function titleFor(key: DotKey, probe: ProbeResult | undefined): string {
  if (!probe) return `${LABELS[key]}: loading…`;
  const parts = [
    `${LABELS[key]}: ${probe.status.toUpperCase()}`,
    formatMetric(probe),
  ];
  if (probe.p95 !== undefined && probe.samples !== undefined) {
    parts.push(`p95 ${Math.round(probe.p95)}${probe.metric_label === 'depth' ? '' : 'ms'} (n=${probe.samples})`);
  }
  if (probe.error && !probe.skipped) parts.push(`error: ${probe.error}`);
  return parts.join(' · ');
}

function summarize(data: { db: ProbeResult; qwen: ProbeResult; oc: ProbeResult; blob: ProbeResult; queue: ProbeResult } | null): string {
  if (!data) return 'System health: loading';
  const worst = (['db', 'qwen', 'oc', 'blob', 'queue'] as DotKey[])
    .map((k) => data[k].status)
    .reduce((acc, s) => (s === 'red' ? 'red' : acc === 'red' ? 'red' : s === 'yellow' ? 'yellow' : acc), 'green');
  return `System health: ${worst}`;
}

export function HealthDots({ inverted = false }: { inverted?: boolean }) {
  const { data } = useChartHealth();
  const [open, setOpen] = useState(false);

  const keys: DotKey[] = ['db', 'qwen', 'oc', 'blob', 'queue'];
  const dotColor = (k: DotKey) => {
    const probe = data?.[k];
    return probe ? COLORS[probe.status] : COLORS.unknown;
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="System health — click for details"
        style={{
          background: 'transparent',
          border: inverted ? '1px solid rgba(255,255,255,0.25)' : '1px solid #e2e8f0',
          borderRadius: 999,
          padding: '3px 8px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          cursor: 'pointer',
          lineHeight: 1,
        }}
        aria-label={summarize(data)}
      >
        {keys.map((k) => (
          <span
            key={k}
            title={titleFor(k, data?.[k])}
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: dotColor(k),
              boxShadow: '0 0 0 1px rgba(0,0,0,0.06) inset',
              display: 'inline-block',
            }}
          />
        ))}
      </button>

      {/* aria-live announcer (visually hidden) */}
      <span
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {summarize(data)}
      </span>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'white',
            color: '#0f172a',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 10px 24px rgba(0,0,0,0.14)',
            padding: 10,
            minWidth: 240,
            zIndex: 100,
            fontSize: 12,
          }}
          role="dialog"
          aria-label="System health detail"
        >
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>System Health</div>
          {keys.map((k) => {
            const probe = data?.[k];
            return (
              <div
                key={k}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '3px 0',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: dotColor(k),
                      display: 'inline-block',
                    }}
                  />
                  {LABELS[k]}
                </span>
                <span style={{ color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                  {formatMetric(probe)}
                </span>
              </div>
            );
          })}
          {data?.generated_at && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
              checked {new Date(data.generated_at).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
