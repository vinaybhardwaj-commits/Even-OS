/**
 * PC.4.C.1 — OC chat liveness probe.
 * Times a trivial SELECT against chat_channels. This is a proxy for the
 * native-chat backend being reachable; it doesn't measure SSE delivery
 * lag (that'd need a round-trip event), but for the degraded-mode dots
 * this is a faithful enough "can the OC write path work?" signal.
 */

import { neon } from '@neondatabase/serverless';
import { buildProbeResult, type ProbeResult } from '../degraded-mode';

const TIMEOUT_MS = 9_000; // just past red threshold (8s)

export async function probeOc(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const sql = neon(process.env.DATABASE_URL!);
    await Promise.race([
      sql`SELECT 1 FROM chat_channels LIMIT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`OC probe timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);
    return buildProbeResult('oc', { ok: true, metric: Date.now() - start });
  } catch (err: any) {
    return buildProbeResult('oc', {
      ok: false,
      metric: Date.now() - start,
      error: err?.message ?? String(err),
    });
  }
}
