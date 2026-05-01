-- 0061 — SCM RBAC role assignments (PRD #2 Phase 1.6)
--
-- Captures which Even OS users hold which SCM-specific roles per hospital.
-- The 7 SCM roles (from /admin/scm/roles spec, Phase 1.5):
--   pr_creator | po_approver | po_creator | grn_creator
--   inventory_manager | item_master_steward | scm_admin
--
-- Path B (V's 30 Apr 2026 lock): per-hospital admin self-service via the
-- /admin/scm/roles UI. GMs assign by mid-November; V is sole final approver.
--
-- Override pattern: super_admin and hospital_admin bypass every SCM SoD
-- check WITHOUT needing an explicit assignment. Encoded in
-- src/server/scm/sod-permissions.ts.
--
-- Soft-revoke pattern: a row is "active" when revoked_at IS NULL.
-- Partial unique index enforces at most one active assignment per
-- (user, hospital, scm_role).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS.
--
-- Rollback:
--   DROP TABLE IF EXISTS scm_role_assignments;

CREATE TABLE IF NOT EXISTS scm_role_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  scm_role        TEXT NOT NULL,

  granted_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grant_reason    TEXT,

  revoked_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at      TIMESTAMPTZ,
  revoke_reason   TEXT,

  notes           TEXT,

  CONSTRAINT scm_role_assignments_role_check
    CHECK (scm_role IN (
      'pr_creator',
      'po_approver',
      'po_creator',
      'grn_creator',
      'inventory_manager',
      'item_master_steward',
      'scm_admin'
    ))
);

-- Hospital-scoped indexes
CREATE INDEX IF NOT EXISTS idx_scm_role_assignments_hospital
  ON scm_role_assignments (hospital_id);

CREATE INDEX IF NOT EXISTS idx_scm_role_assignments_user
  ON scm_role_assignments (user_id);

CREATE INDEX IF NOT EXISTS idx_scm_role_assignments_role
  ON scm_role_assignments (scm_role);

CREATE INDEX IF NOT EXISTS idx_scm_role_assignments_hospital_user
  ON scm_role_assignments (hospital_id, user_id);

-- Partial unique index: at most one ACTIVE (non-revoked) assignment
-- per (user, hospital, scm_role). Soft revocation preserves audit trail
-- but can re-grant the same role later.
CREATE UNIQUE INDEX IF NOT EXISTS uq_scm_role_assignments_active
  ON scm_role_assignments (hospital_id, user_id, scm_role)
  WHERE revoked_at IS NULL;

-- Audit hook: scm.roles.* writes to audit_logs (plural, matching existing
-- convention). No application-layer trigger here; the routers handle it.

COMMENT ON TABLE scm_role_assignments IS
  'SCM-specific role assignments per hospital. 7 roles enforced via CHECK. '
  'super_admin / hospital_admin bypass SoD checks without explicit rows. '
  'Phase 1.6 of SCM Core build. KPMG IFC v1 segregation-of-duties source.';
