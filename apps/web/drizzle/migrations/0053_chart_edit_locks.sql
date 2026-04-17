-- Patient Chart Overhaul — PC.1a
-- chart_edit_locks: pessimistic, short-lived locks guarding clinical writes.
-- One row per (patient, encounter, surface). Default 5-minute TTL enforced
-- application-side via chartLocks.{acquire, release, extend}.

CREATE TABLE IF NOT EXISTS chart_edit_locks (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id              text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  patient_id               uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id             uuid NULL REFERENCES encounters(id) ON DELETE CASCADE,
  surface                  text NOT NULL,
  locked_by_user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locked_by_user_name      text NOT NULL,
  locked_by_user_role      text NOT NULL,
  reason                   text NULL,
  locked_at                timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- One active lock per (patient, encounter, surface). Release deletes the row;
-- acquire overwrites a stale row where expires_at <= now().
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chart_lock_slot
  ON chart_edit_locks (patient_id, encounter_id, surface);

CREATE INDEX IF NOT EXISTS idx_chart_locks_patient
  ON chart_edit_locks (patient_id);

CREATE INDEX IF NOT EXISTS idx_chart_locks_holder
  ON chart_edit_locks (locked_by_user_id);

CREATE INDEX IF NOT EXISTS idx_chart_locks_expires
  ON chart_edit_locks (expires_at);
