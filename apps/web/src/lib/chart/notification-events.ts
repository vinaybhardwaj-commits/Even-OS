/**
 * Patient Chart Overhaul — PC.4.B.2 — Shared chart notification event emitter
 *
 * Central helper for writing into `chart_notification_events`. Every
 * write-path emitter in PC.4.B.2 calls `emitChartNotificationEvent` instead
 * of inlining the INSERT — this keeps the 7 event types consistent and
 * makes dedup / severity / payload shapes uniform across routers.
 *
 * V-locked PC.4.B.2 defaults (19 Apr 2026):
 *   1. Dedup strategy = ID-based per event type (source-row id encoded in
 *      dedup_key). Partial unique index on (dedup_key) WHERE dedup_key IS
 *      NOT NULL guarantees idempotency.
 *   2. System actor = NULL `fired_by_user_id` when the event is machine
 *      origin (cosign sweep). schema allows NULL.
 *   3. Severity mapping is per-event-type and set at emit-site (critical /
 *      critical / high / normal / high / normal+info / high).
 *   4. All emits are fire-and-forget via `void emit(...).catch(() => {})`
 *      so any emitter failure cannot block the primary clinical write.
 *
 * NOT responsible for delivery fan-out — that lives in PC.4.B.3 jobs.
 * This file ONLY writes to the immutable event log.
 */

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { neon } from '@neondatabase/serverless';

let _sqlClient: NeonQueryFunction<false, false> | null = null;
function getSql(): NeonQueryFunction<false, false> {
  if (!_sqlClient) _sqlClient = neon(process.env.DATABASE_URL!);
  return _sqlClient;
}

// ── Types ─────────────────────────────────────────────────────────────
// Must match the pg enum `cne_event_type` created in PC.4.B.1 migration.
export type ChartEventType =
  | 'critical_vital'
  | 'critical_lab'
  | 'cosign_overdue'
  | 'llm_proposal_new'
  | 'calc_red_band'
  | 'encounter_transition'
  | 'edit_lock_override';

export type ChartEventSeverity = 'critical' | 'high' | 'normal' | 'info';

export interface EmitChartEventInput {
  hospital_id: string;            // hospitals.hospital_id text key
  patient_id: string;             // patients.id uuid
  encounter_id?: string | null;   // nullable — patient-scope events ok
  event_type: ChartEventType;
  severity: ChartEventSeverity;
  source_kind: string;            // polymorphic — source table name
  source_id?: string | null;      // polymorphic — source row id (uuid)
  dedup_key?: string | null;      // unique across partial index
  fired_by_user_id?: string | null; // null = system-fired
  payload?: Record<string, unknown>;
}

/**
 * Insert a row into chart_notification_events. Idempotent when a dedup_key
 * is provided (ON CONFLICT DO NOTHING against the partial unique index).
 *
 * Returns the inserted event id, or null if the row was de-duped.
 */
export async function emitChartNotificationEvent(
  input: EmitChartEventInput,
): Promise<string | null> {
  const sql = getSql();
  const payload = JSON.stringify(input.payload ?? {});
  const rows = (await sql`
    INSERT INTO chart_notification_events (
      hospital_id, patient_id, encounter_id,
      event_type, severity,
      source_kind, source_id, dedup_key,
      fired_by_user_id, payload
    ) VALUES (
      ${input.hospital_id},
      ${input.patient_id},
      ${input.encounter_id ?? null},
      ${input.event_type}::cne_event_type,
      ${input.severity}::cne_severity,
      ${input.source_kind},
      ${input.source_id ?? null},
      ${input.dedup_key ?? null},
      ${input.fired_by_user_id ?? null},
      ${payload}::jsonb
    )
    ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Emitter #1 guardrail — decide whether a fresh vitals row trips any
 * critical threshold. Used by clinical-orders.recordVitals.
 *
 * Thresholds are deliberately conservative (NEWS2-adjacent). A `null` /
 * missing field is skipped, never flagged.
 */
export function isCriticalVital(v: {
  spo2_percent?: number | null;
  pulse_bpm?: number | null;
  bp_systolic?: number | null;
  resp_rate?: number | null;
  temperature_c?: number | null;
  gcs_score?: number | null;
}): boolean {
  if (typeof v.spo2_percent === 'number' && v.spo2_percent < 90) return true;
  if (typeof v.pulse_bpm === 'number' && (v.pulse_bpm < 40 || v.pulse_bpm > 130)) return true;
  if (typeof v.bp_systolic === 'number' && (v.bp_systolic < 90 || v.bp_systolic > 220)) return true;
  if (typeof v.resp_rate === 'number' && (v.resp_rate < 8 || v.resp_rate > 30)) return true;
  if (typeof v.temperature_c === 'number' && (v.temperature_c < 35 || v.temperature_c > 39.5)) return true;
  if (typeof v.gcs_score === 'number' && v.gcs_score <= 8) return true;
  return false;
}

// ── Encounter transition helpers ──────────────────────────────────────
export type EncounterTransitionKind = 'admission' | 'transfer' | 'discharge';

/**
 * Severity mapping for encounter_transition events (locked PC.4.B.2):
 *   - admission → high     (care-team roster changing; attending reassigning)
 *   - transfer  → normal   (useful context, rarely clinically urgent)
 *   - discharge → high     (triggers downstream billing + follow-up)
 */
export function encounterTransitionSeverity(
  kind: EncounterTransitionKind,
): ChartEventSeverity {
  if (kind === 'admission' || kind === 'discharge') return 'high';
  return 'normal';
}

/**
 * Discharge sweep — flip auto_care_team subscription rows to silenced=true
 * for a patient whose encounter just completed. Watch-sourced rows are
 * NOT swept (explicit opt-in is sticky). Matches seedCareTeam's inverse.
 *
 * V-locked: silenced_reason = 'discharge_sweep' so re-admission seedCareTeam
 * can recognize this row as a sweep-silenced row and auto-unsilence it.
 *
 * Called fire-and-forget from encounter.completeDischarge.
 */
export async function dischargeSweepSubscriptions(
  patient_id: string,
): Promise<{ silenced: number }> {
  const sql = getSql();
  const rows = (await sql`
    UPDATE chart_subscriptions
       SET silenced           = true,
           silenced_at        = now(),
           silenced_by_user_id = NULL,
           silenced_reason    = 'discharge_sweep',
           updated_at         = now()
     WHERE patient_id = ${patient_id}
       AND source     = 'auto_care_team'::cs_source
       AND silenced   = false
    RETURNING id
  `) as Array<{ id: string }>;
  return { silenced: rows.length };
}

/**
 * Consult-request seed — idempotent upsert of a consulting-specialist row
 * into chart_subscriptions. Shared SQL with chartSubscriptions.seedConsultant
 * tRPC endpoint so both call paths stay consistent.
 *
 * Per V-lock #3 (PC.4.B.1): consulting specialists subscribe on consult
 * REQUEST, not accept — otherwise they miss the critical event that
 * prompted the consult in the first place.
 *
 * Called fire-and-forget from medication-orders.createServiceRequest when
 * request_type === 'consult'.
 */
export async function seedConsultantSubscription(input: {
  hospital_id: string;
  patient_id: string;
  consultant_user_id: string;
  created_by_user_id: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO chart_subscriptions (
      hospital_id, patient_id, user_id, source, role_snapshot,
      created_by_user_id
    ) VALUES (
      ${input.hospital_id},
      ${input.patient_id},
      ${input.consultant_user_id}::uuid,
      'auto_care_team'::cs_source,
      'consultant',
      ${input.created_by_user_id}::uuid
    )
    ON CONFLICT (patient_id, user_id) DO UPDATE SET
      -- Preserve 'watch' (stickier); preserve clinical roles over 'consultant'.
      source        = CASE
                        WHEN chart_subscriptions.source = 'watch'
                          THEN chart_subscriptions.source
                        ELSE EXCLUDED.source
                      END,
      role_snapshot = CASE
                        WHEN chart_subscriptions.role_snapshot IN ('attending','nurse')
                          THEN chart_subscriptions.role_snapshot
                        ELSE EXCLUDED.role_snapshot
                      END,
      -- Consult on a chronic/re-admitted patient should reverse a prior sweep.
      silenced      = CASE
                        WHEN chart_subscriptions.silenced_reason = 'discharge_sweep'
                          THEN false
                        ELSE chart_subscriptions.silenced
                      END,
      silenced_at   = CASE
                        WHEN chart_subscriptions.silenced_reason = 'discharge_sweep'
                          THEN NULL
                        ELSE chart_subscriptions.silenced_at
                      END,
      silenced_by_user_id = CASE
                        WHEN chart_subscriptions.silenced_reason = 'discharge_sweep'
                          THEN NULL
                        ELSE chart_subscriptions.silenced_by_user_id
                      END,
      silenced_reason = CASE
                        WHEN chart_subscriptions.silenced_reason = 'discharge_sweep'
                          THEN NULL
                        ELSE chart_subscriptions.silenced_reason
                      END,
      updated_at    = now()
  `;
}
