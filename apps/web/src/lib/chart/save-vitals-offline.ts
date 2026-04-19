/**
 * PC.4.C.4 — Vitals write-path offline wrapper.
 *
 * Proof-of-pattern for PC.4.C.3. Two concerns in one file:
 *
 * 1. `shouldQueueVitals(dbStatus)` — decision helper. When the chart's
 *    DB probe is red OR unknown, vitals writes should go to IndexedDB
 *    instead of hitting the mutation directly.
 *
 * 2. `vitalsReplayHandler` — the `replayDrafts()` handler that turns a
 *    queued Draft back into a real `observations.createVitals` call.
 *    Success → returns true (row deleted by replayDrafts). Failure →
 *    returns false (row stays, attempts++).
 *
 * Kept in lib/chart/ so other surfaces (bedside nurse station, vitals
 * admin) can import the same replay handler once they wire the queue.
 */

'use client';

import type { Draft } from './offline-queue';

/** DB statuses that force writes into the offline queue. */
export function shouldQueueVitals(dbStatus: string | undefined): boolean {
  // 'red'      → probe failed (hard outage, timeouts, DB unreachable)
  // 'unknown'  → first page load before the first probe OR probe errored
  //              without returning a status — be safe, queue it
  // 'yellow'   → degraded but writes still land; don't queue
  // 'green'    → normal path
  return dbStatus === 'red' || dbStatus === 'unknown';
}

/**
 * Thin POST wrapper that mirrors the chart's existing `trpcMutate`. We
 * don't import it because this file must stay generic (library code).
 */
async function postTrpc(path: string, input: unknown): Promise<unknown> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) {
    throw new Error(`tRPC ${path} HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.message || json.error?.json?.message || 'tRPC error';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

/**
 * Replay handler for `observations.createVitals` drafts.
 *
 * Contract (from replayDrafts):
 *   - return true  → success, row removed
 *   - return false → keep queued, attempts++
 *   - throw        → keep queued, attempts++ (error captured via markAttempt)
 *
 * We swallow any error from postTrpc and return false instead of throwing
 * because the caller's error capture already lives in offline-queue.ts;
 * the queue will record `last_error`.
 */
export async function vitalsReplayHandler(d: Draft): Promise<boolean> {
  if (d.surface !== 'vitals') return false;
  try {
    await postTrpc('observations.createVitals', d.payload);
    return true;
  } catch (err) {
    // Let replayDrafts increment attempts and capture error via markAttempt.
    throw err;
  }
}

/** Minimal shape of a createVitals payload — used as the draft payload. */
export type VitalsPayload = {
  patient_id: string;
  encounter_id: string;
  effective_datetime: string;
  temperature?: number;
  pulse?: number;
  bp_systolic?: number;
  bp_diastolic?: number;
  spo2?: number;
  rr?: number;
  pain_score?: number;
  weight?: number;
  height?: number;
};
