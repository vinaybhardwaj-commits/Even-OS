/**
 * PC.4.C.1 — DB liveness probe.
 * Runs SELECT 1 via the Neon HTTP driver and times the roundtrip.
 * Cached for PROBE_CACHE_MS at the router level.
 */

import { neon } from '@neondatabase/serverless';
import { buildProbeResult, type ProbeResult } from '../degraded-mode';

const TIMEOUT_MS = 6_000; // just past red threshold (5s)

export async function probeDb(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      // neon HTTP driver doesn't accept AbortSignal directly; rely on timing.
      await Promise.race([
        sql`SELECT 1 AS ok`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`DB probe timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
        ),
      ]);
    } finally {
      clearTimeout(timer);
    }
    const latency_ms = Date.now() - start;
    return buildProbeResult('db', { ok: true, metric: latency_ms });
  } catch (err: any) {
    const latency_ms = Date.now() - start;
    return buildProbeResult('db', {
      ok: false,
      metric: latency_ms,
      error: err?.message ?? String(err),
    });
  }
}
