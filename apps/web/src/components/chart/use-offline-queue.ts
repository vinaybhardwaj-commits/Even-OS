/**
 * PC.4.C.3 — useOfflineQueue() client hook.
 *
 * Bridges the IndexedDB queue (`lib/chart/offline-queue.ts`) with the
 * chart-health signal (`useChartHealth`). Provides:
 *
 *   - `count`         → number of drafts currently queued for this patient
 *   - `drafts`        → full list (for debugging / future drawer)
 *   - `enqueue(d)`    → append a draft; also LWW-squashes same field_set
 *   - `flush(fn)`     → caller-supplied replay handler for each Draft row
 *   - `refresh()`     → re-read count/list from IDB
 *
 * Flush-on-recovery:
 *   The hook tracks the previous `db.status` across renders. When the
 *   current status transitions *to* `'green'` from anything else
 *   (red / yellow / unknown), it fires a stored `onRecover` callback.
 *   Callers pass `onRecover` in options; typically that callback is a
 *   thin wrapper that calls `flush()` with the correct mutation handler.
 *
 * Safety nets:
 *   - 10s interval re-reads count in case writes happen from other
 *     chart surfaces within the same tab (badge stays honest).
 *   - All IDB calls are try/catch'd — if IndexedDB is unavailable
 *     (SSR, private mode), the hook degrades to a no-op returning 0.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  countDrafts,
  enqueueDraft,
  listDrafts,
  replayDrafts,
  type Draft,
} from '@/lib/chart/offline-queue';
import { useChartHealth } from './use-chart-health';

const REFRESH_MS = 10_000;

export type UseOfflineQueueOptions = {
  /**
   * Fired when `db.status` transitions to 'green' from red/yellow/unknown.
   * Callers typically use this to kick off a replay via `flush()`.
   */
  onRecover?: () => void;
};

export function useOfflineQueue(patientId: string | null | undefined, opts: UseOfflineQueueOptions = {}) {
  const [count, setCount] = useState(0);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const { data: health } = useChartHealth();
  const prevDbStatusRef = useRef<string | null>(null);
  const onRecoverRef = useRef(opts.onRecover);

  // Keep the callback ref current without restarting effects.
  useEffect(() => {
    onRecoverRef.current = opts.onRecover;
  }, [opts.onRecover]);

  const refresh = useCallback(async () => {
    if (!patientId) {
      setCount(0);
      setDrafts([]);
      return;
    }
    try {
      const [c, list] = await Promise.all([countDrafts(patientId), listDrafts(patientId)]);
      setCount(c);
      setDrafts(list);
    } catch {
      // IDB unavailable → stay at 0. Fail silently; this is UI sugar.
    }
  }, [patientId]);

  const enqueue = useCallback(
    async (input: Omit<Draft, 'id' | 'created_at' | 'updated_at' | 'attempts'>) => {
      const id = await enqueueDraft(input);
      await refresh();
      return id;
    },
    [refresh],
  );

  const flush = useCallback(
    async (handler: (d: Draft) => Promise<boolean>) => {
      if (!patientId || busy) return { attempted: 0, succeeded: 0, remaining: count };
      setBusy(true);
      try {
        const result = await replayDrafts(patientId, handler);
        await refresh();
        return result;
      } finally {
        setBusy(false);
      }
    },
    [patientId, busy, count, refresh],
  );

  // Initial load + whenever patientId changes.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Safety-net refresh every 10s so the badge count stays honest if some
  // other surface inside the same chart enqueues a draft.
  useEffect(() => {
    if (!patientId) return;
    const t = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [patientId, refresh]);

  // Flush-on-recovery — fires on red/yellow/unknown → green transition.
  useEffect(() => {
    const current = health?.db?.status ?? 'unknown';
    const prev = prevDbStatusRef.current;
    if (prev && prev !== 'green' && current === 'green' && count > 0) {
      onRecoverRef.current?.();
    }
    prevDbStatusRef.current = current;
  }, [health?.db?.status, count]);

  return { count, drafts, busy, enqueue, flush, refresh };
}
