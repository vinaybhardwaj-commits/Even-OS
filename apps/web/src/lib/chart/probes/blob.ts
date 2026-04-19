/**
 * PC.4.C.1 — Vercel Blob liveness probe.
 *
 * Uses `list({ limit: 1 })` from @vercel/blob as a light GET against the
 * Blob API. The call is lazy-imported so this module still compiles when
 * the package isn't resolved (matches the mrd-doctor.ts pattern from N.1).
 *
 * Two disable paths:
 *   1. CHART_HEALTH_BLOB_PROBE=off       → reports `status:'unknown'`, `skipped:true`
 *   2. BLOB_READ_WRITE_TOKEN missing     → reports `status:'unknown'`, `skipped:true`
 *
 * Feature flag semantics: only `'off'` disables. Anything else (incl.
 * undefined) keeps the probe active — so the default is on, per V's call.
 */

import { buildProbeResult, type ProbeResult } from '../degraded-mode';

const TIMEOUT_MS = 11_000; // just past red threshold (10s)

export async function probeBlob(): Promise<ProbeResult> {
  if ((process.env.CHART_HEALTH_BLOB_PROBE ?? '').toLowerCase() === 'off') {
    return buildProbeResult('blob', { skipped: true, reason: 'CHART_HEALTH_BLOB_PROBE=off' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return buildProbeResult('blob', { skipped: true, reason: 'BLOB_READ_WRITE_TOKEN unset' });
  }

  const start = Date.now();
  try {
    // Lazy import so this file compiles when @vercel/blob isn't installed
    // in a dev shell. Mirrors mrd-doctor.ts pattern.
    const mod = await import('@vercel/blob').catch(() => null);
    if (!mod || typeof (mod as any).list !== 'function') {
      return buildProbeResult('blob', {
        skipped: true,
        reason: '@vercel/blob module not available',
      });
    }

    await Promise.race([
      (mod as any).list({ limit: 1 }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Blob probe timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);
    return buildProbeResult('blob', { ok: true, metric: Date.now() - start });
  } catch (err: any) {
    return buildProbeResult('blob', {
      ok: false,
      metric: Date.now() - start,
      error: err?.message ?? String(err),
    });
  }
}
