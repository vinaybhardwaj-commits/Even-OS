'use client';

/**
 * HealthPill — single status dot + label + optional latency/meta.
 * Used inside <HealthPills /> on the admin top bar.
 */
export type PillStatus = 'ok' | 'degraded' | 'down' | 'unknown';

interface HealthPillProps {
  label: string;
  status: PillStatus;
  latencyMs?: number;
  meta?: string; // for Deploy: short SHA
  title?: string; // tooltip
}

const STATUS_DOT: Record<PillStatus, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-rose-500',
  unknown: 'bg-slate-300',
};

const STATUS_RING: Record<PillStatus, string> = {
  ok: 'ring-emerald-100',
  degraded: 'ring-amber-100',
  down: 'ring-rose-100',
  unknown: 'ring-slate-100',
};

export function HealthPill({ label, status, latencyMs, meta, title }: HealthPillProps) {
  return (
    <span
      title={title || `${label}: ${status}${latencyMs != null ? ` • ${latencyMs}ms` : ''}`}
      className={`inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-inset ${STATUS_RING[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
      <span>{label}</span>
      {meta && <span className="font-mono text-[10px] text-slate-400">{meta}</span>}
      {latencyMs != null && latencyMs > 0 && (
        <span className="font-mono text-[10px] text-slate-400">{latencyMs}ms</span>
      )}
    </span>
  );
}
