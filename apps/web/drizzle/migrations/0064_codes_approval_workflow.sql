-- =============================================================================
-- Migration 0064 — Codes Module Phase 2 (Approval Workflow)
-- =============================================================================
-- Implements Q3's locked design (5-state machine + role-routing per code kind),
-- scoped per Phase 2 PRD line: drug 2-stage + general-item 1-stage flows.
--
-- 4 schema deltas:
--   1. inventory_items.status TEXT NOT NULL with CHECK enum
--   2. codes_approval_history (audit log, append-only)
--   3. codes_approval_routing (config, seeded for EHRC drug + consumable)
--   4. codes_role_assignments (domain RBAC mirroring scm_role_assignments)
--
-- Idempotent: all CREATEs use IF NOT EXISTS; ALTER COLUMN ADD only if missing.
-- Historical bootstrap of existing 1,762 inventory_items to status='active' +
-- one codes_approval_history row each is handled by a separate admin
-- procedure (codes.approvals.bootstrapHistorical) — keeps this migration
-- DDL-only and safely re-runnable.
-- =============================================================================

-- ─── 1. inventory_items.status ──────────────────────────────────────────────
-- Add column with default 'active' so existing 1,762 rows backfill silently.
-- After backfill, the schema layer (66-codes.ts) declares default 'draft' for
-- NEW inserts; we sync the SQL DEFAULT after backfill below.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventory_items' AND column_name='status'
  ) THEN
    ALTER TABLE inventory_items
      ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
  END IF;
END$$;

-- Add CHECK constraint (idempotent by name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_status_check'
  ) THEN
    ALTER TABLE inventory_items
      ADD CONSTRAINT inventory_items_status_check
      CHECK (status IN (
        'draft',
        'pending_clinical_review',
        'pending_master_data_review',
        'pending_cms_gm_review',
        'active',
        'rejected'
      ));
  END IF;
END$$;

-- Flip the column default to 'draft' for all NEW rows from now on.
-- Existing rows keep status='active' (set above). Fresh inserts get 'draft'.
ALTER TABLE inventory_items ALTER COLUMN status SET DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS idx_inventory_items_status ON inventory_items (status);


-- ─── 2. codes_approval_history (audit log) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS codes_approval_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  code_kind TEXT NOT NULL
    CHECK (code_kind IN ('drug','implant','consumable','procedure','lab_test','imaging_study','pack','charge_tier','lookup','deprecation')),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL
    CHECK (to_state IN (
      'draft',
      'pending_clinical_review',
      'pending_master_data_review',
      'pending_cms_gm_review',
      'active',
      'rejected'
    )),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  sla_remaining_pct_at_action NUMERIC(5, 2),
  feedback_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_codes_approval_history_item ON codes_approval_history (item_id);
CREATE INDEX IF NOT EXISTS idx_codes_approval_history_to_state ON codes_approval_history (to_state);
CREATE INDEX IF NOT EXISTS idx_codes_approval_history_hospital_created ON codes_approval_history (hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_codes_approval_history_actor ON codes_approval_history (actor_user_id);


-- ─── 3. codes_approval_routing (config + seed) ──────────────────────────────
CREATE TABLE IF NOT EXISTS codes_approval_routing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE CASCADE,
  code_kind TEXT NOT NULL
    CHECK (code_kind IN ('drug','implant','consumable','procedure','lab_test','imaging_study','pack','charge_tier','lookup','deprecation')),
  clinical_role TEXT,
  requires_cms_gm_for_high_impact BOOLEAN NOT NULL DEFAULT FALSE,
  sla_clinical_working_days INTEGER NOT NULL DEFAULT 3,
  sla_mdo_working_days INTEGER NOT NULL DEFAULT 2,
  sla_cms_gm_working_days INTEGER NOT NULL DEFAULT 2,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_codes_approval_routing_hospital_kind ON codes_approval_routing (hospital_id, code_kind);
CREATE INDEX IF NOT EXISTS idx_codes_approval_routing_active ON codes_approval_routing (is_active);

-- Seed default routing for EHRC. Phase 2 covers 'drug' + 'consumable' kinds;
-- other kinds get added when downstream PRDs ship.
INSERT INTO codes_approval_routing
  (hospital_id, code_kind, clinical_role, requires_cms_gm_for_high_impact,
   sla_clinical_working_days, sla_mdo_working_days, sla_cms_gm_working_days, notes)
VALUES
  ('EHRC', 'drug',       'pharmacy_supervisor', FALSE, 3, 2, 2, 'SOP §5.6 — Pharmacy Supervisor → MDO → active'),
  ('EHRC', 'consumable', NULL,                  FALSE, 0, 2, 2, 'General item — MDO only (no clinical stage)')
ON CONFLICT (hospital_id, code_kind) DO NOTHING;


-- ─── 4. codes_role_assignments (domain RBAC — mirrors scm_role_assignments) ─
CREATE TABLE IF NOT EXISTS codes_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  codes_role TEXT NOT NULL
    CHECK (codes_role IN (
      'pharmacy_supervisor',
      'master_data_officer',
      'cath_lab_lead',
      'lab_lead',
      'radiology_lead',
      'cms_gm_approver'
    )),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT
);

-- Partial UNIQUE INDEX: only active (non-revoked) assignments are unique per
-- (hospital, user, role). Allows a role to be granted, revoked, then re-granted.
DROP INDEX IF EXISTS idx_codes_role_assignments_active;
CREATE UNIQUE INDEX idx_codes_role_assignments_active
  ON codes_role_assignments (hospital_id, user_id, codes_role)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_codes_role_assignments_user ON codes_role_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_codes_role_assignments_hospital_role ON codes_role_assignments (hospital_id, codes_role);
