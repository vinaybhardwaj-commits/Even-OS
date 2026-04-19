/**
 * PC.4.C.1 — Degraded-mode thresholds, ring buffers, and status computation.
 *
 * Per PRD v2.0 §27.5, each chart-critical subsystem has a (yellow, red)
 * threshold pair. Status is derived from a rolling p95 over the last ~5 min.
 * Subsystems with fewer than MIN_SAMPLES fresh samples report 'unknown'
 * (shown as grey in the UI) so cold-start instances don't flash false red.
 *
 * Shape is identical for latency-based probes (DB/Qwen/OC/Blob) and
 * depth-based probes (queue). The `metric` units differ — callers should
 * interpret via `metric_label`.
 */

export type ProbeKey = 'db' | 'qwen' | 'oc' | 'blob' | 'queue';
export type ProbeStatus = 'green' | 'yellow' | 'red' | 'unknown';
export type MetricLabel = 'latency_ms' | 'depth';

export type ProbeResult = {
  status: ProbeStatus;
  metric: number | null;         // null when skipped (e.g. blob probe off)
  metric_label: MetricLabel;
  sampled_at: string;            // ISO — when the most-recent *fresh* probe ran
  error?: string;                // only present when the latest attempt errored
  skipped?: boolean;             // true when probe is disabled (env flag)
  p95?: number;                  // smoothed value the status was computed from
  samples?: number;              // # of samples in the ring at compute time
};

/**
 * Per-PRD thresholds. yellow = probe is slow; red = probe is broken / overloaded.
 * All latencies in ms. Queue is depth.
 */
export const THRESHOLDS: Record<ProbeKey, { yellow: number; red: number; label: MetricLabel }> = {
  db:    { yellow: 1_000, red: 5_000,  label: 'latency_ms' },
  qwen:  { yellow: 5_000, red: 15_000, label: 'latency_ms' },
  oc:    { yellow: 2_000, red: 8_000,  label: 'latency_ms' },
  blob:  { yellow: 3_000, red: 10_000, label: 'latency_ms' },
  queue: { yellow: 50,    red: 250,    label: 'depth' },
};

/** Min samples before a probe reports anything other than 'unknown'. */
export const MIN_SAMPLES = 3;

/** Ring buffer capacity. At 10s cached probes, 30 entries ≈ 5 min of history. */
export const BUFFER_CAPACITY = 30;

/** How long a fresh probe result is served before we re-run the underlying call. */
export const PROBE_CACHE_MS = 10_000;

// ─── Ring buffer ─────────────────────────────────────────────────────────

export class RingBuffer {
  private buf: number[] = [];
  constructor(private readonly capacity: number = BUFFER_CAPACITY) {}

  push(n: number): void {
    this.buf.push(n);
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  /** Classic nearest-rank p95. Returns 0 when empty. */
  p95(): number {
    if (this.buf.length === 0) return 0;
    const sorted = [...this.buf].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  }

  size(): number {
    return this.buf.length;
  }

  /** For tests. */
  clear(): void {
    this.buf = [];
  }
}

// Module-scoped buffers, per Vercel function instance.
const buffers = new Map<ProbeKey, RingBuffer>();
export function getBuffer(key: ProbeKey): RingBuffer {
  let b = buffers.get(key);
  if (!b) {
    b = new RingBuffer(BUFFER_CAPACITY);
    buffers.set(key, b);
  }
  return b;
}

/**
 * Given a metric reading (latency or depth) and the thresholds for a probe,
 * return the status tier. Callers should pass the p95 — not the raw reading.
 */
export function computeStatus(
  metric: number,
  yellow: number,
  red: number,
  sampleCount: number,
): ProbeStatus {
  if (sampleCount < MIN_SAMPLES) return 'unknown';
  if (metric >= red) return 'red';
  if (metric >= yellow) return 'yellow';
  return 'green';
}

// ─── Probe-result cache (server-side dedup) ──────────────────────────────
// Prevents N concurrent open charts from each firing 5 probes every 15s.
// Cache invalidates after PROBE_CACHE_MS; then the next call actually probes.

type CacheEntry = { at: number; result: ProbeResult };
const resultCache = new Map<ProbeKey, CacheEntry>();

export function getCachedProbe(key: ProbeKey): ProbeResult | null {
  const e = resultCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > PROBE_CACHE_MS) return null;
  return e.result;
}

export function setCachedProbe(key: ProbeKey, result: ProbeResult): void {
  resultCache.set(key, { at: Date.now(), result });
}

/**
 * Build a ProbeResult from a raw probe reading. Caller supplies either a
 * successful metric (push to buffer, compute p95 status) or an error (skip
 * buffer push, report red with the error message).
 *
 * `skipped: true` yields status='unknown' and no buffer impact — use when
 * the probe itself is disabled (e.g. missing env var).
 */
export function buildProbeResult(
  key: ProbeKey,
  input:
    | { ok: true; metric: number }
    | { ok: false; error: string; metric?: number }
    | { skipped: true; reason: string },
): ProbeResult {
  const { label } = THRESHOLDS[key];
  const now = new Date().toISOString();

  if ('skipped' in input) {
    return {
      status: 'unknown',
      metric: null,
      metric_label: label,
      sampled_at: now,
      skipped: true,
      error: input.reason,
    };
  }

  const buf = getBuffer(key);

  if (input.ok) {
    buf.push(input.metric);
    const p95 = buf.p95();
    const { yellow, red } = THRESHOLDS[key];
    return {
      status: computeStatus(p95, yellow, red, buf.size()),
      metric: input.metric,
      metric_label: label,
      sampled_at: now,
      p95,
      samples: buf.size(),
    };
  }

  // Errored probes don't push to the buffer — we don't want a transient
  // blip to poison the p95 for the next 5 minutes. But status is forced red.
  return {
    status: 'red',
    metric: input.metric ?? null,
    metric_label: label,
    sampled_at: now,
    error: input.error,
    p95: buf.p95(),
    samples: buf.size(),
  };
}
