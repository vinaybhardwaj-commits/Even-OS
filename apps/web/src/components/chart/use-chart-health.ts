/**
 * PC.4.C.2 — useChartHealth() client hook.
 *
 * Polls `chartHealth.status` every 15s. Pauses when the tab is hidden so
 * backgrounded charts don't burn probes (also aligns with PRD §27.5 —
 * refetchIntervalInBackground: false).
 *
 * Uses the plain `fetch` wrapper that the chart already uses (see
 * `patient-chart-client.tsx`). Intentionally not react-query: the chart
 * hasn't wired react-query in, and this hook needs to stay lightweight.
 *
 * Contract:
 *   const { data, error, lastUpdated } = useChartHealth();
 *   data?.db.status     → 'green' | 'yellow' | 'red' | 'unknown'
 *   data?.db.metric     → ms (db/qwen/oc/blob) or depth (queue)
 *   data?.generated_at  → ISO
 *
 * Failure modes:
 * - Network error → `error` set, `data` kept at last good value so the UI
 *   doesn't strobe grey during transient blips.
 * - First load  → `data` is null (component renders 5 grey dots).
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProbeResult } from '@/lib/chart/degraded-mode';

export type ChartHealthResponse = {
  db: ProbeResult;
  qwen: ProbeResult;
  oc: ProbeResult;
  blob: ProbeResult;
  queue: ProbeResult;
  generated_at: string;
};

const POLL_MS = 15_000;

async function fetchChartHealth(signal: AbortSignal): Promise<ChartHealthResponse | null> {
  const params = `?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`;
  const res = await fetch(`/api/trpc/chartHealth.status${params}`, { signal });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.error) return null;
  return json.result?.data?.json ?? null;
}

export function useChartHealth(): {
  data: ChartHealthResponse | null;
  error: string | null;
  lastUpdated: Date | null;
} {
  const [data, setData] = useState<ChartHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // We keep the latest-known value on a ref so the paused-tab resume path
  // can read it without re-triggering the effect.
  const latestRef = useRef<ChartHealthResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return; // skip when backgrounded
      try {
        const result = await fetchChartHealth(controller.signal);
        if (cancelled) return;
        if (result) {
          latestRef.current = result;
          setData(result);
          setLastUpdated(new Date());
          setError(null);
        } else {
          setError('Health check returned no data');
        }
      } catch (e: any) {
        if (cancelled || e?.name === 'AbortError') return;
        setError(e?.message || 'Network error');
      }
    };

    // Immediate first read, then 15s interval.
    tick();
    const interval = window.setInterval(tick, POLL_MS);

    // Resume a fresh probe as soon as the tab becomes visible again.
    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return { data, error, lastUpdated };
}
