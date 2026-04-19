/**
 * PC.4.C.1 — chartHealth tRPC router.
 *
 * Single endpoint `status` returns the live/cached state of the 5 chart-critical
 * subsystems: DB, Qwen LLM, OC chat, Vercel Blob, ai_request_queue.
 *
 * - Probes run in parallel via Promise.allSettled — one slow subsystem never
 *   blocks another's reading.
 * - Results are cached server-side for PROBE_CACHE_MS (10s) so N concurrent
 *   open charts don't each fire 5 probes every 15s. Cache is per-process
 *   (module-scoped), which is the right granularity for Vercel functions.
 * - Rolling p95 is computed over the last ~5 min of fresh probes. Cold-start
 *   instances with <3 samples report 'unknown' (grey dot) instead of flashing
 *   false green/red.
 *
 * Status contract: protectedProcedure — every authenticated user can read
 * their own chart-health. These are operational signals (no PHI, no secrets).
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import {
  getCachedProbe,
  setCachedProbe,
  type ProbeKey,
  type ProbeResult,
} from '@/lib/chart/degraded-mode';
import { probeDb } from '@/lib/chart/probes/db';
import { probeQwen } from '@/lib/chart/probes/qwen';
import { probeOc } from '@/lib/chart/probes/oc';
import { probeBlob } from '@/lib/chart/probes/blob';
import { probeQueue } from '@/lib/chart/probes/queue';

type StatusResponse = {
  db: ProbeResult;
  qwen: ProbeResult;
  oc: ProbeResult;
  blob: ProbeResult;
  queue: ProbeResult;
  generated_at: string;
};

const PROBES: Record<ProbeKey, () => Promise<ProbeResult>> = {
  db: probeDb,
  qwen: probeQwen,
  oc: probeOc,
  blob: probeBlob,
  queue: probeQueue,
};

async function runOne(key: ProbeKey): Promise<ProbeResult> {
  // Cache short-circuit: if a fresh probe result exists, return it.
  const cached = getCachedProbe(key);
  if (cached) return cached;

  try {
    const result = await PROBES[key]();
    setCachedProbe(key, result);
    return result;
  } catch (err: any) {
    // A probe throwing here means the probe wrapper itself broke — treat
    // as a transient red reading and DON'T cache, so the next poll retries.
    return {
      status: 'red',
      metric: null,
      metric_label: key === 'queue' ? 'depth' : 'latency_ms',
      sampled_at: new Date().toISOString(),
      error: err?.message ?? String(err),
    };
  }
}

export const chartHealthRouter = router({
  /**
   * Returns the current status of all 5 probes. Never throws — a failing
   * subsystem just gets status='red' with an `error` message.
   *
   * Client calls this on a 15s interval (see useChartHealth in PC.4.C.2).
   * The 10s result cache means ~1.5 actual probes per poll cycle in the
   * worst case across concurrent users.
   */
  status: protectedProcedure
    .output(
      z.object({
        db: z.any(),
        qwen: z.any(),
        oc: z.any(),
        blob: z.any(),
        queue: z.any(),
        generated_at: z.string(),
      }),
    )
    .query(async (): Promise<StatusResponse> => {
      const [db, qwen, oc, blob, queue] = await Promise.all([
        runOne('db'),
        runOne('qwen'),
        runOne('oc'),
        runOne('blob'),
        runOne('queue'),
      ]);
      return {
        db,
        qwen,
        oc,
        blob,
        queue,
        generated_at: new Date().toISOString(),
      };
    }),
});
