-- Notes v2 — Sprint N.3
-- clinical_note_drafts: per-(patient,encounter,note_type,author) autosave slot
-- for the Notes v2 editor. Server primary store; browser localStorage mirrors
-- as offline fallback.

CREATE TABLE IF NOT EXISTS clinical_note_drafts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  patient_id       uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id     uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  note_type        note_type NOT NULL,
  author_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id      uuid NULL,
  body             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_note_draft_slot
  ON clinical_note_drafts (patient_id, encounter_id, note_type, author_id);

CREATE INDEX IF NOT EXISTS idx_note_drafts_author
  ON clinical_note_drafts (author_id);

CREATE INDEX IF NOT EXISTS idx_note_drafts_encounter
  ON clinical_note_drafts (encounter_id);
