/**
 * Patient Chart Overhaul — PC.1a — Pessimistic chart-edit locking
 *
 * Locked decision (PRD v2.0 #19): clinical writes to the patient chart are
 * guarded by a short-lived pessimistic lock. When a user opens an editable
 * surface (notes editor, med order, vitals entry, problem list, etc.) the
 * client acquires a lock scoped to the patient + encounter + surface. Other
 * users see a banner + "Request to edit" CTA that routes through OC chat.
 *
 * Why this table exists (from PRD §11 and the 26 locked decisions):
 *   - Two people editing the same note at the same time used to silently
 *     trample each other. The fix is pessimistic — a lock row with a TTL.
 *   - TTL is enforced application-side: `expires_at` defaults to now + 5 min;
 *     the tRPC `chartLocks.extend` mutation bumps it while the editor stays
 *     active, and `acquire` will overwrite an expired row.
 *   - PC.3 layers audit + admin-overlay override on top; both read this table.
 *
 * Shape decisions (deliberate, documented here so PC.3 doesn't regress them):
 *   - `surface` is a free-form text so new lockable surfaces can come online
 *     without a migration. A check constraint would fight PC.2 (calculators).
 *   - `(patient_id, encounter_id, surface)` is UNIQUE — one active lock per
 *     (patient, encounter, surface). Release deletes the row; acquire on
 *     contention either returns the current holder (409) or overwrites if
 *     the existing row is past `expires_at`.
 *   - `locked_by_user_id` and `locked_by_user_name` are both stored — the
 *     name snapshot lets the banner render without a user lookup even if the
 *     user row gets renamed/disabled.
 *   - `reason` is optional and free-form. PC.3 uses a prefix of `override:`
 *     to encode admin overrides (mirroring the Dedup Hub convention).
 */

import {
  pgTable, text, timestamp, uuid, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { hospitals, users } from './00-foundations';
import { patients, encounters } from './03-registration';

export const chartEditLocks = pgTable(
  'chart_edit_locks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    hospitalId: text('hospital_id')
      .notNull()
      .references(() => hospitals.hospital_id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    encounterId: uuid('encounter_id')
      .references(() => encounters.id, { onDelete: 'cascade' }),
    /**
     * Lockable surface identifier. Examples:
     *   - 'note:progress'       — progress note editor
     *   - 'note:admission'      — admission note editor
     *   - 'orders:medication'   — medication order slider
     *   - 'orders:labs'         — lab order slider
     *   - 'vitals'              — vitals entry
     *   - 'problem_list'        — problem list form
     *   - 'care_plan'           — care plan editor
     * Kept as text so PC.2 calculators + PC.3 new surfaces can register
     * without a migration.
     */
    surface: text('surface').notNull(),
    lockedByUserId: uuid('locked_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Snapshot of the holder's display name at acquire time. */
    lockedByUserName: text('locked_by_user_name').notNull(),
    /** Snapshot of the holder's role at acquire time (for banner copy). */
    lockedByUserRole: text('locked_by_user_role').notNull(),
    /** Optional free-form reason. `override:` prefix encodes admin override. */
    reason: text('reason'),
    lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Application-enforced TTL. Default +5min at acquire; `chartLocks.extend`
     * bumps to now+5min while the editor is active.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One active lock per (patient, encounter, surface). Release deletes.
    uniqSlot: uniqueIndex('uniq_chart_lock_slot').on(
      t.patientId,
      t.encounterId,
      t.surface,
    ),
    byPatient: index('idx_chart_locks_patient').on(t.patientId),
    byHolder: index('idx_chart_locks_holder').on(t.lockedByUserId),
    byExpiry: index('idx_chart_locks_expires').on(t.expiresAt),
  }),
);
