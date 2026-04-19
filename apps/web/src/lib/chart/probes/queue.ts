/**
 * PC.4.C.1 — ai_request_queue depth probe.
 * Counts pending entries that are ready to process. Depth (not latency)
 * is the metric; thresholds 50/250 from PRD §27.5. Uses the existing
 * partial index on (status, process_after) WHERE status='pending'.
 */

import { neon } from '@neondatabase/serverless';
import { buildProbeResult, type ProbeResult } from '../degraded-mode';

const TIMEOUT_MS = 5_000;

export async function probeQueue(): Promise<ProbeResult> {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = (await Promise.race([
      sql`SELECT COUNT(*)::int AS depth
          FROM ai_request_queue
          WHERE status = 'pending' AND process_after <= NOW()`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Queue probe timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ])) as Array<{ depth: number }>;

    const depth = Number(rows?.[0]?.depth ?? 0);
    return buildProbeResult('queue', { ok: true, metric: depth });
  } catch (err: any) {
    return buildProbeResult('queue', {
      ok: false,
      error: err?.message ?? String(err),
    });
  }
}
