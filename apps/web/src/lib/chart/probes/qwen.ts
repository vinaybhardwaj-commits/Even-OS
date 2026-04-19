/**
 * PC.4.C.1 — Qwen LLM liveness probe.
 * Reuses checkHealth() from @/lib/ai/llm-client which already does a
 * ~10-token roundtrip. Cached at the router level (PROBE_CACHE_MS=10s)
 * so concurrent charts don't each fire a Qwen call.
 */

import { checkHealth } from '@/lib/ai/llm-client';
import { buildProbeResult, type ProbeResult } from '../degraded-mode';

const TIMEOUT_MS = 16_000; // just past red threshold (15s)

export async function probeQwen(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      checkHealth(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error(`Qwen probe timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);

    if (!result) {
      // llm-client returned null → offline
      return buildProbeResult('qwen', {
        ok: false,
        metric: Date.now() - start,
        error: 'Qwen reported offline',
      });
    }

    // Map llm-client status to our probe. If it reports 'degraded' we still
    // record the latency — computeStatus() will surface yellow/red on its own.
    const latency_ms = typeof result.latency_ms === 'number' ? result.latency_ms : Date.now() - start;

    if (result.status === 'offline') {
      return buildProbeResult('qwen', { ok: false, metric: latency_ms, error: 'offline' });
    }

    return buildProbeResult('qwen', { ok: true, metric: latency_ms });
  } catch (err: any) {
    return buildProbeResult('qwen', {
      ok: false,
      metric: Date.now() - start,
      error: err?.message ?? String(err),
    });
  }
}
