'use client';

/**
 * SystemStatusClient — renders the 6-section /admin/status body.
 *
 * Layout:
 *   ┌─────────────────────────────┬─────────────────────────────┐
 *   │ Deploy                      │ Database                    │
 *   ├─────────────────────────────┼─────────────────────────────┤
 *   │ Row Counts (top 20)         │ LLM                         │
 *   ├─────────────────────────────┼─────────────────────────────┤
 *   │ Errors                      │ Activity                    │
 *   └─────────────────────────────┴─────────────────────────────┘
 *
 * Manual Refresh All button + 60s auto-poll. Loading states are per-page
 * (not per-section) since we fetch from one aggregator endpoint.
 *
 * All colors/status pills are derived from tone helpers to keep the look
 * consistent with LiveOpsStrip.
 */

import { useCallback, useEffect, useState } from 'react';

// Keep POLL_INTERVAL > /api/admin/live-ops's 30s — this endpoint has a
// serial LLM probe that can take 1-3s.
const POLL_INTERVAL_MS = 60_000;

type SystemStatus = {
  deploy: {
    sha: string;
    short_sha: string;
    branch: string;
    env: string;
    commit_message: string;
    author: string;
    repo: string;
    deploy_url: string;
    time: string;
  };
  database: {
    status: 'ok' | 'degraded' | 'down';
    latency_ms: number;
    size_bytes: number;
    size_pretty: string;
    connection_count: number;
    longest_query_seconds: number | null;
    version: string;
  };
  row_counts: Array<{ table: string; rows: number }>;
  llm: {
    status: 'online' | 'offline' | 'degraded' | 'error';
    latency_ms: number | null;
    model: string;
    base_url_host: string;
  };
  errors: {
    last_1h: number;
    last_24h: number;
    top_types_24h: Array<{ error_type: string; count: number; last_seen: string }>;
  };
  activity: {
    active_sessions: number;
    logins_24h: number;
    unique_users_24h: number;
    recent_logins: Array<{
      user_id: string;
      email: string | null;
      full_name: string | null;
      role: string | null;
      created_at: string;
    }>;
  };
  timestamp: string;
};

export function SystemStatusClient() {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/system-status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SystemStatus;
      setData(json);
      setLastLoaded(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            System Status
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Deploy, database, LLM, errors, and activity — one screen.
            {lastLoaded && (
              <>
                <span className="ml-2 text-slate-400">·</span>
                <span className="ml-2 tabular-nums">
                  Last checked {formatRelative(lastLoaded)}
                </span>
              </>
            )}
            {error && (
              <span className="ml-2 rounded bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                Failed: {error}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh All'}
        </button>
      </div>

      {/* 2-column grid of sections */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DeploySection data={data?.deploy} loading={loading && !data} />
        <DatabaseSection data={data?.database} loading={loading && !data} />
        <RowCountsSection data={data?.row_counts} loading={loading && !data} />
        <LlmSection data={data?.llm} loading={loading && !data} />
        <ErrorsSection data={data?.errors} loading={loading && !data} />
        <ActivitySection data={data?.activity} loading={loading && !data} />
      </div>
    </div>
  );
}

// ─── Section primitives ──────────────────────────────────────────────────

function Section({
  title,
  icon,
  tone = 'slate',
  children,
}: {
  title: string;
  icon: string;
  tone?: 'slate' | 'emerald' | 'amber' | 'rose';
  children: React.ReactNode;
}) {
  const toneRing = {
    slate: 'ring-slate-200',
    emerald: 'ring-emerald-200',
    amber: 'ring-amber-200',
    rose: 'ring-rose-200',
  }[tone];
  return (
    <section
      className={`rounded-xl bg-white p-5 shadow-sm ring-1 ${toneRing}`}
    >
      <header className="mb-4 flex items-center gap-2">
        <span className="text-lg" aria-hidden="true">
          {icon}
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
          {title}
        </h2>
      </header>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span
        className={`min-w-0 text-right text-slate-900 ${
          mono ? 'font-mono text-[12px]' : ''
        }`}
        style={{ wordBreak: 'break-all' }}
      >
        {value}
      </span>
    </div>
  );
}

function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 w-full animate-pulse rounded bg-slate-100"
        />
      ))}
    </div>
  );
}

function StatusPill({
  status,
  label,
}: {
  status: 'ok' | 'online' | 'degraded' | 'down' | 'offline' | 'error';
  label?: string;
}) {
  const map: Record<typeof status, { bg: string; text: string }> = {
    ok: { bg: 'bg-emerald-100', text: 'text-emerald-800' },
    online: { bg: 'bg-emerald-100', text: 'text-emerald-800' },
    degraded: { bg: 'bg-amber-100', text: 'text-amber-800' },
    down: { bg: 'bg-rose-100', text: 'text-rose-800' },
    offline: { bg: 'bg-slate-100', text: 'text-slate-600' },
    error: { bg: 'bg-rose-100', text: 'text-rose-800' },
  };
  const c = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${c.bg} ${c.text}`}
    >
      {label || status}
    </span>
  );
}

// ─── Deploy ──────────────────────────────────────────────────────────────

function DeploySection({
  data,
  loading,
}: {
  data?: SystemStatus['deploy'];
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <Section title="Deploy" icon="🚀" tone="slate">
        <Skeleton lines={5} />
      </Section>
    );
  }

  const envTone: 'emerald' | 'amber' | 'slate' =
    data.env === 'production' ? 'emerald' : data.env === 'preview' ? 'amber' : 'slate';

  return (
    <Section title="Deploy" icon="🚀" tone={envTone}>
      <Row
        label="Environment"
        value={
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
              envTone === 'emerald'
                ? 'bg-emerald-100 text-emerald-800'
                : envTone === 'amber'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {data.env}
          </span>
        }
      />
      <Row label="Branch" value={data.branch} mono />
      <Row label="SHA" value={data.short_sha} mono />
      <Row label="Repo" value={data.repo || '—'} mono />
      <Row label="Author" value={data.author || '—'} />
      <Row
        label="Last commit"
        value={
          data.commit_message ? (
            <span className="italic">&ldquo;{data.commit_message}&rdquo;</span>
          ) : (
            '—'
          )
        }
      />
      {data.deploy_url && (
        <Row
          label="URL"
          value={
            <a
              href={data.deploy_url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              {data.deploy_url.replace(/^https?:\/\//, '')}
            </a>
          }
          mono
        />
      )}
    </Section>
  );
}

// ─── Database ────────────────────────────────────────────────────────────

function DatabaseSection({
  data,
  loading,
}: {
  data?: SystemStatus['database'];
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <Section title="Database" icon="🗄️" tone="slate">
        <Skeleton lines={5} />
      </Section>
    );
  }
  const tone =
    data.status === 'ok' ? 'emerald' : data.status === 'degraded' ? 'amber' : 'rose';
  return (
    <Section title="Database" icon="🗄️" tone={tone}>
      <Row label="Status" value={<StatusPill status={data.status} />} />
      <Row
        label="Latency"
        value={<span className="tabular-nums">{data.latency_ms} ms</span>}
      />
      <Row label="Size" value={data.size_pretty} />
      <Row
        label="Connections"
        value={<span className="tabular-nums">{data.connection_count}</span>}
      />
      <Row
        label="Longest query"
        value={
          data.longest_query_seconds == null
            ? 'idle'
            : `${data.longest_query_seconds.toFixed(1)}s`
        }
      />
      <Row label="Version" value={data.version || '—'} mono />
    </Section>
  );
}

// ─── Row counts ──────────────────────────────────────────────────────────

function RowCountsSection({
  data,
  loading,
}: {
  data?: SystemStatus['row_counts'];
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <Section title="Top Tables (rows)" icon="📊">
        <Skeleton lines={8} />
      </Section>
    );
  }
  if (data.length === 0) {
    return (
      <Section title="Top Tables (rows)" icon="📊">
        <p className="text-sm text-slate-500">No table statistics available.</p>
      </Section>
    );
  }
  const max = Math.max(1, ...data.map(r => r.rows));
  return (
    <Section title="Top Tables (rows)" icon="📊">
      <p className="mb-2 text-[11px] text-slate-400">
        Top 20 public tables by estimated row count (pg_class.reltuples).
      </p>
      <ul className="space-y-1">
        {data.map(r => (
          <li
            key={r.table}
            className="flex items-center gap-2 text-[12px]"
          >
            <span className="w-40 shrink-0 truncate font-mono text-slate-700">
              {r.table}
            </span>
            <span className="relative flex-1">
              <span
                className="absolute inset-y-0 left-0 rounded bg-blue-100"
                style={{ width: `${Math.max(2, (r.rows / max) * 100)}%` }}
              />
              <span className="relative block h-4 rounded" />
            </span>
            <span className="w-16 shrink-0 text-right font-mono tabular-nums text-slate-700">
              {formatCount(r.rows)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ─── LLM ─────────────────────────────────────────────────────────────────

function LlmSection({
  data,
  loading,
}: {
  data?: SystemStatus['llm'];
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <Section title="LLM" icon="🧠" tone="slate">
        <Skeleton lines={4} />
      </Section>
    );
  }
  const tone =
    data.status === 'online'
      ? 'emerald'
      : data.status === 'degraded'
      ? 'amber'
      : 'rose';
  return (
    <Section title="LLM" icon="🧠" tone={tone}>
      <Row label="Status" value={<StatusPill status={data.status} />} />
      <Row
        label="Latency"
        value={
          data.latency_ms == null ? (
            '—'
          ) : (
            <span className="tabular-nums">{data.latency_ms} ms</span>
          )
        }
      />
      <Row label="Model" value={data.model} mono />
      <Row label="Host" value={data.base_url_host || '—'} mono />
      <p className="mt-3 text-[11px] text-slate-400">
        Qwen via Ollama behind Cloudflare Tunnel. Probe prompt &ldquo;Say OK&rdquo;,
        max 10 tokens. Shows &ldquo;offline&rdquo; if the tunnel is down or the
        model hasn&rsquo;t warmed.
      </p>
    </Section>
  );
}

// ─── Errors ──────────────────────────────────────────────────────────────

function ErrorsSection({
  data,
  loading,
}: {
  data?: SystemStatus['errors'];
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <Section title="Errors" icon="⚠️" tone="slate">
        <Skeleton lines={5} />
      </Section>
    );
  }
  const tone =
    data.last_1h > 0 ? 'rose' : data.last_24h > 0 ? 'amber' : 'emerald';
  return (
    <Section title="Errors" icon="⚠️" tone={tone}>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Last 1h
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {data.last_1h}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Last 24h
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {data.last_24h}
          </div>
        </div>
      </div>
      {data.top_types_24h.length === 0 ? (
        <p className="text-sm text-emerald-700">
          ✓ No errors logged in the last 24h.
        </p>
      ) : (
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">
            Top types (24h)
          </div>
          <ul className="space-y-1">
            {data.top_types_24h.map(e => (
              <li
                key={e.error_type}
                className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-[12px]"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-slate-700">
                  {e.error_type}
                </span>
                <span className="shrink-0 text-[10px] text-slate-500">
                  last {formatRelative(new Date(e.last_seen))}
                </span>
                <span className="w-10 shrink-0 text-right font-mono tabular-nums text-slate-700">
                  {e.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────

function ActivitySection({
  data,
  loading,
}: {
  data?: SystemStatus['activity'];
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <Section title="Activity" icon="👥">
        <Skeleton lines={5} />
      </Section>
    );
  }
  return (
    <Section title="Activity" icon="👥">
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="Active sessions" value={data.active_sessions} />
        <Stat label="Logins 24h" value={data.logins_24h} />
        <Stat label="Unique users" value={data.unique_users_24h} />
      </div>
      {data.recent_logins.length === 0 ? (
        <p className="text-sm text-slate-500">No recent logins.</p>
      ) : (
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">
            Recent logins
          </div>
          <ul className="divide-y divide-slate-100">
            {data.recent_logins.map((l, i) => (
              <li
                key={`${l.user_id}-${i}`}
                className="flex items-center justify-between gap-3 py-1.5 text-[12px]"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-slate-900">
                    {l.full_name || l.email || l.user_id.slice(0, 8)}
                  </span>
                  {l.role && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {l.role}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                  {formatRelative(new Date(l.created_at))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
        {value}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatRelative(when: Date): string {
  const diffSec = Math.floor((Date.now() - when.getTime()) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}
