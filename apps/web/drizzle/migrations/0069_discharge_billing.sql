-- =============================================================================
-- Migration 0069 — BV3 Phase 4b (Discharge billing closure)
-- =============================================================================
-- 2 new tables: discharge_billing_steps + discharge_billing_audit.
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS discharge_billing_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  bill_id UUID REFERENCES bills(id) ON DELETE SET NULL,
  step TEXT NOT NULL
    CHECK (step IN ('charge_reconciliation','bill_build','settlement_presentation','payment_collection','document_pack','bill_close')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','complete','error','skipped')),
  result JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discharge_billing_steps_encounter_step
  ON discharge_billing_steps (encounter_id, step);
CREATE INDEX IF NOT EXISTS idx_discharge_billing_steps_encounter
  ON discharge_billing_steps (encounter_id);
CREATE INDEX IF NOT EXISTS idx_discharge_billing_steps_status
  ON discharge_billing_steps (status);
CREATE INDEX IF NOT EXISTS idx_discharge_billing_steps_bill
  ON discharge_billing_steps (bill_id) WHERE bill_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS discharge_billing_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('start','advance','complete','error','reset','skip')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  notes TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discharge_billing_audit_encounter
  ON discharge_billing_audit (encounter_id);
CREATE INDEX IF NOT EXISTS idx_discharge_billing_audit_hospital_created
  ON discharge_billing_audit (hospital_id, created_at DESC);
