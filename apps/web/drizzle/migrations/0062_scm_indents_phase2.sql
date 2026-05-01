-- 0062 — SCM Indents Phase 2 — multi-tier approval tracking + indent-number sequence
--
-- Phase 2 of SCM Core PRD #2.
--
-- ADDS:
--   1. indent_approvals — per-tier sign-off rows for multi-step KPMG matrix
--      (Q-A1 Path C lock 1 May 2026): one indent_approvals row per
--      (indent_id, approver_role); when all required tiers sign,
--      the indent transitions pending → approved.
--      v1 mostly uses single-tier (one row per indent); Phase 9 KPMG
--      ABSORPTION expands the same table to 4-tier chains
--      (HOD → Non-Med Head → Finance → FD).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS.
--
-- Rollback:
--   DROP TABLE IF EXISTS indent_approvals;

CREATE TABLE IF NOT EXISTS indent_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  indent_id       UUID NOT NULL REFERENCES indents(id) ON DELETE CASCADE,

  -- KPMG matrix tier required (Phase 9 expands list)
  approver_role   TEXT NOT NULL,
  -- CHECK approver_role IN ('hod','non_med_head','finance_in_charge','facility_director','procurement_head')

  -- Sign-off
  decision        TEXT,
  -- CHECK decision IN ('approved','rejected') OR NULL = pending
  decided_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  decision_reason TEXT,

  -- Sequence within the chain (1 = first tier, 2 = second tier, …)
  -- Phase 2 v1 uses tier_order=1 only; Phase 9 KPMG ABSORPTION uses 1..N
  tier_order      INTEGER NOT NULL DEFAULT 1,

  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT indent_approvals_role_check CHECK (
    approver_role IN ('hod', 'non_med_head', 'finance_in_charge', 'facility_director', 'procurement_head')
  ),
  CONSTRAINT indent_approvals_decision_check CHECK (
    decision IS NULL OR decision IN ('approved', 'rejected')
  )
);

CREATE INDEX IF NOT EXISTS idx_indent_approvals_hospital
  ON indent_approvals (hospital_id);

CREATE INDEX IF NOT EXISTS idx_indent_approvals_indent
  ON indent_approvals (indent_id);

CREATE INDEX IF NOT EXISTS idx_indent_approvals_role
  ON indent_approvals (approver_role);

CREATE INDEX IF NOT EXISTS idx_indent_approvals_pending
  ON indent_approvals (indent_id)
  WHERE decision IS NULL;

-- At most one pending row per (indent, role) — re-approval after rejection
-- creates a NEW row (the rejected row stays for audit).
CREATE UNIQUE INDEX IF NOT EXISTS uq_indent_approvals_active
  ON indent_approvals (indent_id, approver_role, tier_order)
  WHERE decision IS NULL;

COMMENT ON TABLE indent_approvals IS
  'KPMG multi-tier approval chain for indents. v1 (Phase 2) uses single-tier; '
  'Phase 9 KPMG ABSORPTION expands to HOD → Non-Med Head → Finance → FD. '
  'Same table will serve PO approvals (PRD Phase 3+) once tier-vs-amount '
  'enforcement ships.';
