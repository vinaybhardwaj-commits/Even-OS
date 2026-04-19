'use client';

/**
 * LiveOpsStrip — 4-cell horizontal strip at the top of the Command Center.
 *
 * Cells (left to right):
 *   1. Ops        — Bed occupancy, admissions/discharges today, active inpatients
 *   2. Alerts     — Open incidents, unacknowledged critical lab values
 *   3. Revenue    — Today's collections, pending claims, draft invoices
 *   4. Health     — DB latency + deploy sha
 *
 * Polls /api/admin/live-ops every 30s. Each cell is clickable and drills
 * into a real admin page so V never hits a dead-end metric.
 *
 * Design: each cell shows one "headline" number + two secondary numbers
 * underneath, keeping the strip scannable at a glance. Compact on desktop,
 * scrollable horizontally on narrow viewports.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';

type LiveOpsResponse = {
  ops: {
    beds_occupied: number;
    beds_total: number;
    admissions_today: number;
    discharges_today: number;
    active_inpatients: number;
  };
  alerts: {
    open_incidents: number;
    unack_critical: number;
  };
  revenue: {
    collections_today_inr: number;
    pending_claims: number;
    draft_invoices: number;
  };
  health: {
    db: { status: 'ok' | 'degraded' | 'down'; latency_ms: number };
    sha: string;
    env: string;
  };
  timestamp: string;
};

const POLL_INTERVAL_MS = 30_000;

export function LiveOpsStrip() {
  const [data, setData] = useState<LiveOpsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/admin/live-ops', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as LiveOpsResponse;
        if (!cancelled) {
          setData(json);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const loading = !data && !error;

  const bedsPct =
    data && data.ops.beds_total > 0
      ? Math.round((data.ops.beds_occupied / data.ops.beds_total) * 100)
      : 0;

  return (
    <section aria-label="Live Ops" className="mb-6 overflow-x-auto">
      <div className="grid min-w-[1000px] grid-cols-4 gap-3">
        {/* OPS */}
        <Cell
          href="/admin/bed-board"
          tone="slate"
          label="Operations"
          headline={
            loading
              ? '—'
              : data
              ? `${data.ops.beds_occupied}/${data.ops.beds_total}`
              : '—'
          }
          sub1={loading ? 'loading…' : `${bedsPct}% beds occupied`}
          sub2={
            data
              ? `+${data.ops.admissions_today} adm · ${data.ops.discharges_today} disch · ${data.ops.active_inpatients} in-house`
              : ''
          }
          icon="🛏️"
        />

        {/* ALERTS */}
        <Cell
          href="/admin/incident-reporting"
          tone={
            (data?.alerts.open_incidents ?? 0) + (data?.alerts.unack_critical ?? 0) > 0
              ? 'amber'
              : 'slate'
          }
          label="Alerts"
          headline={
            loading
              ? '—'
              : data
              ? String(data.alerts.open_incidents + data.alerts.unack_critical)
              : '—'
          }
          sub1={
            data
              ? `${data.alerts.open_incidents} incidents open`
              : 'loading…'
          }
          sub2={
            data
              ? `${data.alerts.unack_critical} critical values unack'd`
              : ''
          }
          icon="⚠️"
        />

        {/* REVENUE */}
        <Cell
          href="/admin/revenue-dashboard"
          tone="emerald"
          label="Revenue"
          headline={
            loading
              ? '—'
              : data
              ? formatInr(data.revenue.collections_today_inr)
              : '—'
          }
          sub1={data ? 'collected today' : 'loading…'}
          sub2={
            data
              ? `${data.revenue.pending_claims} claims pending · ${data.revenue.draft_invoices} draft bills`
              : ''
          }
          icon="₹"
        />

        {/* HEALTH */}
        {/* NOTE: /admin/status ships in AD.4 — until then we route to the
            closest existing surface so this cell never dead-ends. */}
        <Cell
          href="/admin/ai-observatory"
          tone={
            data?.health.db.status === 'ok'
              ? 'emerald'
              : data?.health.db.status === 'degraded'
              ? 'amber'
              : error || data?.health.db.status === 'down'
              ? 'rose'
              : 'slate'
          }
          label="System"
          headline={
            loading
              ? '—'
              : error
              ? 'down'
              : data
              ? data.health.db.status.toUpperCase()
              : '—'
          }
          sub1={
            data
              ? `DB ${data.health.db.latency_ms}ms · ${data.health.env}`
              : 'loading…'
          }
          sub2={data ? `sha ${data.health.sha}` : ''}
          icon="◉"
        />
      </div>
    </section>
  );
}

// ─── Cell primitive ───────────────────────────────────────────────────────

type CellTone = 'slate' | 'amber' | 'emerald' | 'rose';

function toneClasses(tone: CellTone): {
  border: string;
  bg: string;
  headline: string;
  label: string;
} {
  switch (tone) {
    case 'amber':
      return {
        border: 'border-amber-200',
        bg: 'bg-amber-50',
        headline: 'text-amber-900',
        label: 'text-amber-700',
      };
    case 'emerald':
      return {
        border: 'border-emerald-200',
        bg: 'bg-emerald-50',
        headline: 'text-emerald-900',
        label: 'text-emerald-700',
      };
    case 'rose':
      return {
        border: 'border-rose-200',
        bg: 'bg-rose-50',
        headline: 'text-rose-900',
        label: 'text-rose-700',
      };
    case 'slate':
    default:
      return {
        border: 'border-slate-200',
        bg: 'bg-white',
        headline: 'text-slate-900',
        label: 'text-slate-600',
      };
  }
}

function Cell({
  href,
  tone,
  label,
  headline,
  sub1,
  sub2,
  icon,
}: {
  href: string;
  tone: CellTone;
  label: string;
  headline: string;
  sub1: string;
  sub2: string;
  icon: string;
}) {
  const c = toneClasses(tone);
  return (
    <Link
      href={href}
      className={`group flex flex-col gap-1 rounded-xl border ${c.border} ${c.bg} px-4 py-3 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${c.label}`}>
          {label}
        </span>
        <span className="text-base opacity-60" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className={`text-2xl font-semibold tabular-nums leading-tight ${c.headline}`}>
        {headline}
      </div>
      <div className="text-[12px] leading-tight text-slate-600">{sub1}</div>
      {sub2 && (
        <div className="text-[11px] leading-tight text-slate-500">{sub2}</div>
      )}
    </Link>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Indian number notation: "₹ 1.25 Cr", "₹ 45 L", "₹ 12.5 K".
 * Fits V's preference (seen in reference memory) for Cr/L/K formatting.
 */
function formatInr(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '₹0';
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)} L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)} K`;
  return `₹${n}`;
}
