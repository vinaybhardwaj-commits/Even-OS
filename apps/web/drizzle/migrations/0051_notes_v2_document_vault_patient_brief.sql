-- =====================================================================
-- Migration 0051 — Notes v2 + Document Vault + Patient Brief (Sprint N.1)
-- =====================================================================

-- 1. EXTEND note_type ENUM (must run one statement at a time in PG <= 12; safe in 14+)
ALTER TYPE note_type ADD VALUE IF NOT EXISTS 'progress_note';
ALTER TYPE note_type ADD VALUE IF NOT EXISTS 'admission_note';
ALTER TYPE note_type ADD VALUE IF NOT EXISTS 'physical_exam';
ALTER TYPE note_type ADD VALUE IF NOT EXISTS 'procedure_note';
ALTER TYPE note_type ADD VALUE IF NOT EXISTS 'consultation_note';
ALTER TYPE note_type ADD VALUE IF NOT EXISTS 'ward_round_note';

-- 2. NEW ENUM TYPES
DO $$ BEGIN
  CREATE TYPE brief_trigger AS ENUM (
    'admission','new_note','new_document','new_lab','vitals_abnormal',
    'problem_list_change','med_list_change','discharge','scheduled','manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chart_proposal_type AS ENUM (
    'condition','allergy','medication','lab_result','procedure','problem'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE chart_proposal_status AS ENUM (
    'pending','accepted','rejected','modified'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE storage_tier AS ENUM ('vercel_blob','legacy_base64');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. NEW TABLES
CREATE TABLE IF NOT EXISTS patient_briefs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id          text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  patient_id           uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id         uuid REFERENCES encounters(id) ON DELETE SET NULL,
  version              integer NOT NULL,
  narrative            text NOT NULL,
  structured           jsonb NOT NULL,
  trigger_event        brief_trigger NOT NULL,
  triggered_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  llm_audit_id         uuid,
  source_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  hallucination_flags  jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_stale             boolean NOT NULL DEFAULT false,
  supersedes_id        uuid,
  generated_at         timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_briefs_patient_version_idx ON patient_briefs (patient_id, version);
CREATE INDEX IF NOT EXISTS patient_briefs_hospital_idx ON patient_briefs (hospital_id);
CREATE INDEX IF NOT EXISTS patient_briefs_generated_idx ON patient_briefs (generated_at);
CREATE INDEX IF NOT EXISTS patient_briefs_stale_idx ON patient_briefs (is_stale);

CREATE TABLE IF NOT EXISTS patient_brief_sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id       uuid NOT NULL REFERENCES patient_briefs(id) ON DELETE CASCADE,
  source_table   text NOT NULL,
  source_id      uuid NOT NULL,
  included_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_brief_sources_brief_idx ON patient_brief_sources (brief_id);
CREATE INDEX IF NOT EXISTS patient_brief_sources_source_idx ON patient_brief_sources (source_table, source_id);

CREATE TABLE IF NOT EXISTS patient_brief_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id          uuid NOT NULL REFERENCES patient_briefs(id) ON DELETE CASCADE,
  flagged_by        uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  flagged_by_role   text NOT NULL,
  description       text NOT NULL,
  status            text NOT NULL DEFAULT 'open',
  resolved_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at       timestamptz,
  resolution_notes  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_brief_flags_brief_idx ON patient_brief_flags (brief_id);
CREATE INDEX IF NOT EXISTS patient_brief_flags_status_idx ON patient_brief_flags (status);

CREATE TABLE IF NOT EXISTS chart_update_proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id        text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  encounter_id       uuid REFERENCES encounters(id) ON DELETE SET NULL,
  source_document    uuid NOT NULL,
  proposal_type      chart_proposal_type NOT NULL,
  payload            jsonb NOT NULL,
  confidence         real,
  extraction_notes   text,
  status             chart_proposal_status NOT NULL DEFAULT 'pending',
  reviewed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  review_notes       text,
  applied_row_id     uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chart_update_proposals_patient_status_idx ON chart_update_proposals (patient_id, status);
CREATE INDEX IF NOT EXISTS chart_update_proposals_hospital_idx ON chart_update_proposals (hospital_id);
CREATE INDEX IF NOT EXISTS chart_update_proposals_source_doc_idx ON chart_update_proposals (source_document);
CREATE INDEX IF NOT EXISTS chart_update_proposals_created_idx ON chart_update_proposals (created_at);

-- 4. ADDITIVE COLUMNS
ALTER TABLE clinical_impressions ADD COLUMN IF NOT EXISTS template_id uuid;
ALTER TABLE mrd_document_references ADD COLUMN IF NOT EXISTS storage_tier storage_tier DEFAULT 'vercel_blob';
