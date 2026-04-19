/**
 * Patient Chart Overhaul — PC.4.A.4 — Native patient_complaints
 *
 * V's locked decision #22 (PRD v2.0): "Sewa + LSQ tiles on Overview;
 * 'Raise complaint' pill in secondary action row for every role."
 *
 * Architectural fork — V picked Path A (native substrate) on 19 Apr 2026:
 * build our own patient-scoped complaints table in Even-OS rather than
 * mirror or live-proxy EHRC-Sewa. Reason (V): "Even-OS needs its own
 * patient-complaint substrate regardless — doctors/nurses/billing inside
 * Even-OS will raise patient-related complaints from the chart; only some
 * of those will ever flow to HR-side Sewa."
 *
 * Why a NEW table (not sewa_complaints from 18-safety-audits):
 *   - sewa_complaints is a patient-voice NABH complaint system (anonymous,
 *     acknowledgement + satisfaction survey, escalation tree). It models
 *     *complaints FROM patients/families TO the hospital*.
 *   - patient_complaints is an ops-voice chart-raised signal. It models
 *     *complaints ABOUT a patient situation raised BY staff from inside
 *     the chart* — a care-team-visible, SLA-tracked work item.
 *   - Overloading sewa_complaints would muddy both flows. Keep them
 *     separate; add a PC.5-era `sewa_sync_id` FK later if V chooses to
 *     bolt on HR-Sewa escalation.
 *
 * Shape decisions (deliberate — lock before UI consumers read):
 *   - `encounter_id` is NULLABLE. Most complaints will be encounter-scoped
 *     (raised from an active admission), but the chart's persistent-room
 *     surface can raise complaints at the patient level when there's no
 *     active encounter (e.g. follow-up, billing dispute).
 *   - `priority` is an enum — `low | normal | high | critical` — not a
 *     severity bucket. Priority drives SLA (see `sla_due_at`).
 *   - `category` is free-form text for v1 (so CCE can type "Billing",
 *     "Clinical care", "Facility", "Staff conduct", etc.). A lookup table
 *     + admin CRUD is deferred to PC.5.
 *   - `sla_due_at` is computed application-side at raise time from a
 *     priority→hours map in the router. Not stored as a generated column
 *     so we can tune thresholds without a migration.
 *   - Both user_id AND user_name stored as snapshots (same pattern as
 *     chart_edit_locks) — lets the UI render without a user lookup even
 *     if the user row is renamed/disabled.
 *   - `resolution_note` is required when transitioning to `resolved` or
 *     `closed` (enforced in the router, not the schema, so app logic is
 *     single-sourced).
 *   - `hospital_id` on every row per PRD locked decision #25
 *     (single-facility v1 but multi-tenant-future).
 *
 * Index plan:
 *   - (hospital_id, patient_id, status) — the dominant read: "open
 *     complaints for this patient" (Overview tile, SLA badge).
 *   - (encounter_id) — "complaints raised on this admission".
 *   - (status, sla_due_at) — SLA-breach sweeps in future worker.
 *   - (raised_by_user_id) — "my raised complaints" in future admin view.
 */

import {
  pgTable, pgEnum, text, timestamp, uuid, index,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

// ── Enums ────────────────────────────────────────────────────────────
// NOTE: deliberately scoped (pc_) to avoid collision with
// 18-safety-audits' `complaint_status`/`complaint_severity` pg enums.
export const patientComplaintPriorityEnum = pgEnum(
  'pc_complaint_priority',
  ['low', 'normal', 'high', 'critical'],
);

export const patientComplaintStatusEnum = pgEnum(
  'pc_complaint_status',
  ['open', 'in_progress', 'resolved', 'closed'],
);

// ── Table ────────────────────────────────────────────────────────────
export const patientComplaints = pgTable(
  'patient_complaints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hospitalId: text('hospital_id')
      .notNull()
      .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    /** Nullable — complaint can be patient-scoped (no active encounter). */
    encounterId: uuid('encounter_id')
      .references(() => encounters.id, { onDelete: 'set null' }),

    /** Free-form v1: "Billing", "Clinical care", "Facility", "Staff conduct"... */
    category: text('category').notNull(),
    priority: patientComplaintPriorityEnum('priority').notNull().default('normal'),
    status: patientComplaintStatusEnum('status').notNull().default('open'),

    /** Short headline — shown on Overview tile. */
    subject: text('subject').notNull(),
    /** Free-form body — shown in detail drawer. */
    description: text('description').notNull(),

    /**
     * Computed at raise time from priority→hours map in the router:
     *   critical → 1h, high → 4h, normal → 24h, low → 72h.
     * Breach = now() > sla_due_at AND status IN ('open','in_progress').
     */
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }).notNull(),

    // ── Raise snapshot ─────────────────────────────────────────────
    raisedByUserId: uuid('raised_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    raisedByUserName: text('raised_by_user_name').notNull(),
    raisedByUserRole: text('raised_by_user_role').notNull(),

    // ── Resolution snapshot (filled on status transition to resolved/closed) ──
    resolvedByUserId: uuid('resolved_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    resolvedByUserName: text('resolved_by_user_name'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Dominant read: "open complaints for this patient"
    byPatient: index('idx_patient_complaints_patient').on(t.hospitalId, t.patientId, t.status),
    byEncounter: index('idx_patient_complaints_encounter').on(t.encounterId),
    // SLA sweeps (future worker)
    byStatusSla: index('idx_patient_complaints_sla').on(t.status, t.slaDueAt),
    // "my raised complaints" admin view
    byRaiser: index('idx_patient_complaints_raiser').on(t.raisedByUserId),
  }),
);
