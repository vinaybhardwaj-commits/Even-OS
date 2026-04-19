/**
 * Patient Chart Overhaul — PC.4.B.1 — Chart subscriptions + notification events
 *
 * V's locked decision #13 (PRD v2.0 §11.2 + §27.3): "Auto-subscribe care team +
 * manual 'Watch' button; events via OC DM + push." Built 19 Apr 2026 with three
 * V-locked defaults for PC.4.B.1:
 *   1. Auto-subscribe scope = patient-level (not encounter-level). Survives
 *      discharge/readmission; on discharge, auto_care_team rows are flipped to
 *      `silenced=true` via a sweep (leaving the row in place preserves the
 *      audit trail for "who WAS on this patient's care team"). Manual Watch
 *      rows are unaffected by the sweep — explicit opt-in is sticky.
 *   2. Silence granularity = per-patient, persistent across admissions. If a
 *      clinician mutes a chronic patient, the mute carries through to the next
 *      admission unless they explicitly unmute.
 *   3. Consulting specialists are subscribed on consult-REQUEST (not accept) —
 *      otherwise the consultant misses the critical-lab/vital event that
 *      prompted the consult in the first place.
 *
 * The 7 notification event types (LOCKED per PRD v2.0 §11.2 + §27.3, 18 Apr 2026):
 *   1. critical_vital         — NEWS2 ≥ 7, SpO₂ < 90, shock index, thresholds
 *   2. critical_lab           — auto-verified panic range on panels
 *   3. cosign_overdue         — clinical note past co-sign window
 *   4. llm_proposal_new       — ai_request_queue produced a new proposal
 *   5. calc_red_band          — calculator result hits red band on Overview
 *   6. encounter_transition   — admission, transfer, discharge (kind in payload)
 *   7. edit_lock_override     — admin overrode chart edit-lock on this chart
 *
 * Why TWO tables (not one):
 *   - chart_subscriptions is SLOW-MOVING state (hundreds of rows per hospital
 *     total; one per user×patient edge). Writes are rare: seed-on-admission,
 *     manual watch, silence toggle, discharge sweep.
 *   - chart_notification_events is FAST-MOVING log (can be dozens per patient
 *     per day when critical vitals fire). Writes are frequent (every emitter
 *     in PC.4.B.2), reads are bounded by time+patient.
 *
 * Why delivery tracking is NOT a third table in B.1:
 *   - PRD v2.0's 3-table count for PC.4 is `chart_subscriptions`,
 *     `chart_notification_events`, `chart_print_exports`. Deliveries piggyback
 *     on the OC chat message log (for the DM half) + a push queue stub added
 *     in PC.4.B.3. If we need per-channel delivery state later, we add a
 *     `chart_notification_deliveries` table in a follow-up without rework.
 *
 * Shape decisions (locked before B.2/B.3 read this schema):
 *   - `source = auto_care_team | watch` — how the subscription was created.
 *     Controls sweep behavior: auto_care_team rows can be silenced on discharge,
 *     watch rows are sticky.
 *   - `event_filters text[]` — per-user opt-out of specific event types.
 *     Default NULL means "all 7". Explicit array overrides. Future UI (PC.4.B.4).
 *   - `role_snapshot` — role the user had WHEN subscribed.
 *   - `dedup_key` — unique per-event-class window key to suppress duplicates.
 *   - `source_kind + source_id` — polymorphic FK pair (not enforced as a real
 *     FK because source_id can point to many tables).
 *   - `hospital_id` on every row per PRD locked decision #25.
 *
 * Index plan:
 *   chart_subscriptions:
 *     - UNIQUE (patient_id, user_id)
 *     - (user_id), (patient_id, silenced), (hospital_id)
 *   chart_notification_events:
 *     - UNIQUE (dedup_key) WHERE dedup_key IS NOT NULL (partial unique)
 *     - (patient_id, fired_at DESC), (event_type, fired_at DESC), (hospital_id, fired_at DESC)
 */

import {
  pgTable, pgEnum, text, timestamp, uuid, boolean, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ── Enums ─────────────────────────────────────────────────────────────
// Prefixed `cs_` / `cne_` to avoid any future collision.
export const chartSubscriptionSourceEnum = pgEnum(
  'cs_source',
  ['auto_care_team', 'watch'],
);

// 7 locked event types per PRD §11.2 + §27.3.
export const chartNotificationEventTypeEnum = pgEnum(
  'cne_event_type',
  [
    'critical_vital',
    'critical_lab',
    'cosign_overdue',
    'llm_proposal_new',
    'calc_red_band',
    'encounter_transition',
    'edit_lock_override',
  ],
);

export const chartNotificationSeverityEnum = pgEnum(
  'cne_severity',
  ['critical', 'high', 'normal', 'info'],
);

// ── chart_subscriptions ───────────────────────────────────────────────
export const chartSubscriptions = pgTable(
  'chart_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hospitalId: text('hospital_id')
      .notNull()
      .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** How the subscription was created. Controls discharge-sweep behavior. */
    source: chartSubscriptionSourceEnum('source').notNull(),

    /** Snapshot of the user's role at subscribe time (e.g. 'attending'). */
    roleSnapshot: text('role_snapshot').notNull(),

    /**
     * Per-chart silence toggle (§11.2). Preserves subscription, suppresses
     * notifications. Persists across admissions per V-lock (19 Apr 2026).
     */
    silenced: boolean('silenced').notNull().default(false),
    silencedAt: timestamp('silenced_at', { withTimezone: true }),
    silencedByUserId: uuid('silenced_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    silencedReason: text('silenced_reason'),

    /**
     * Per-user event-type opt-out. NULL = subscribe to all 7.
     * Populated by PC.4.B.4 subscription UI.
     */
    eventFilters: text('event_filters').array(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: uuid('created_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    // One subscription per (patient, user) — watch-then-auto collapses to single row.
    uniqEdge: uniqueIndex('uniq_chart_sub_patient_user').on(t.patientId, t.userId),
    byUser: index('idx_chart_sub_user').on(t.userId),
    byPatientSilenced: index('idx_chart_sub_patient_silenced').on(t.patientId, t.silenced),
    byHospital: index('idx_chart_sub_hospital').on(t.hospitalId),
  }),
);

// ── chart_notification_events ─────────────────────────────────────────
export const chartNotificationEvents = pgTable(
  'chart_notification_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hospitalId: text('hospital_id')
      .notNull()
      .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    /** Nullable — patient-scope events may have no encounter. */
    encounterId: uuid('encounter_id')
      .references(() => encounters.id, { onDelete: 'set null' }),

    eventType: chartNotificationEventTypeEnum('event_type').notNull(),
    severity: chartNotificationSeverityEnum('severity').notNull().default('normal'),

    /**
     * Polymorphic source pointer. source_kind is free-form text so PC.5
     * can add new event sources without a migration.
     */
    sourceKind: text('source_kind').notNull(),
    sourceId: uuid('source_id'),

    /**
     * Deterministic idempotency key composed by the emitter (PC.4.B.2).
     * Partial-unique so NULL is allowed (guard rail).
     */
    dedupKey: text('dedup_key'),

    /** Free-form payload: trigger value, thresholds, headline, etc. */
    payload: jsonb('payload'),

    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
    /** Nullable: system-fired events leave this NULL. */
    firedByUserId: uuid('fired_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    // Partial unique: idempotent on dedup_key when present.
    uniqDedup: uniqueIndex('uniq_chart_evt_dedup')
      .on(t.dedupKey)
      .where(sql`dedup_key IS NOT NULL`),
    byPatientFired: index('idx_chart_evt_patient_fired').on(t.patientId, t.firedAt),
    byTypeFired: index('idx_chart_evt_type_fired').on(t.eventType, t.firedAt),
    byHospitalFired: index('idx_chart_evt_hospital_fired').on(t.hospitalId, t.firedAt),
  }),
);
