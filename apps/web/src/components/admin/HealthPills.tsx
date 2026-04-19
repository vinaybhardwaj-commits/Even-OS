'use client';

/**
 * HealthPills — live row of component health pills.
 * Polls /api/admin/health-summary every 30 seconds.
 * Shows: DB, LLM, Blob, Queue, Deploy.
 */
import { useEffect, useState } from 'react';
import { HealthPill, type PillStatus } from './HealthPill';

type HealthResponse = {
  db: { status: PillStatus; latency_ms: number };
  llm: { status: PillStatus; latency_ms: number };
  blob: { status: PillStatus; latency_ms: number };
  queue: { status: PillStatus; latency_ms: number };
  deploy: { status: PillStatus; sha: string; env: string; time: string };
  timestamp: string;
};

const POLL_INTERVAL_MS = 30_000;

export function HealthPills() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/admin/health-summary', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as HealthResponse;
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

  if (error && !data) {
    return (
      <div className="flex items-center gap-2">
        <HealthPill label="Health" status="down" title="Failed to load health summary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center gap-2">
        <HealthPill label="Loading…" status="unknown" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <HealthPill label="DB" status={data.db.status} latencyMs={data.db.latency_ms} />
      <HealthPill label="LLM" status={data.llm.status} latencyMs={data.llm.latency_ms} />
      <HealthPill label="Blob" status={data.blob.status} />
      <HealthPill label="Queue" status={data.queue.status} />
      <HealthPill
        label={data.deploy.env}
        status={data.deploy.status}
        meta={data.deploy.sha}
        title={`Deployed: ${new Date(data.deploy.time).toLocaleString()} • env=${data.deploy.env} • sha=${data.deploy.sha}`}
      />
    </div>
  );
}
