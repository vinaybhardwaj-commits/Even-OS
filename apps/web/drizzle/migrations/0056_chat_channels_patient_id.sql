-- PC.4.A.1 — chat_channels.patient_id for persistent patient channels
--
-- Adds a nullable patient_id uuid FK so a patient can have a single
-- long-running chat channel that spans all of their encounters (the
-- "Patient (all time)" room surfaced alongside the per-encounter room).
--
-- Semantics:
--   department channels  → patient_id NULL, encounter_id NULL
--   encounter-scoped     → patient_id NULL, encounter_id set  (channel_id = 'patient-<encounter_id>')
--   persistent patient   → patient_id set,  encounter_id NULL (channel_id = 'patient-persistent-<patient_id>')
--
-- The existing encounter-scoped rows are untouched. The HTTP migration
-- route backfills one persistent row per patient that doesn't have one.

ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id);

CREATE INDEX IF NOT EXISTS idx_chat_channels_patient
  ON chat_channels(hospital_id, patient_id);

COMMENT ON COLUMN chat_channels.patient_id IS
  'PC.4.A.1: set for persistent patient channels (encounter_id must be NULL in that case). Allows a single chat thread that spans all of a patient''s admissions.';
