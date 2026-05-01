-- =============================================================================
-- Migration 0068 — BV3 Phase 4a (Bill builder spine)
-- =============================================================================
-- 3 new tables: bills + bill_state_history + bill_lines.
-- All idempotent. Augments invoice_sequences for bill numbering (reuses
-- existing table from 00-foundations.ts).
-- =============================================================================

-- ─── 1. bills ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  bill_number TEXT NOT NULL,
  encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
  billing_account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,

  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','pending_review','finalized','settled','closed','archived')),

  subtotal_inr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  gst_amount_inr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  concession_amount_inr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  concession_reason TEXT,
  concession_approval_level TEXT
    CHECK (concession_approval_level IS NULL OR concession_approval_level IN ('self','gm','cfo')),
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,

  total_amount_inr NUMERIC(14, 2) NOT NULL DEFAULT 0,

  replaces_bill_id UUID,
  amended BOOLEAN NOT NULL DEFAULT FALSE,
  amended_count INTEGER NOT NULL DEFAULT 0 CHECK (amended_count >= 0),

  finalized_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,

  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_bills_concession_le_subtotal CHECK (concession_amount_inr <= subtotal_inr + gst_amount_inr)
);

-- Self-FK for replaces_bill_id (named + idempotency-guarded)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bills_replaces_bill_id_fkey') THEN
    ALTER TABLE bills
      ADD CONSTRAINT bills_replaces_bill_id_fkey
      FOREIGN KEY (replaces_bill_id) REFERENCES bills(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_number_hospital ON bills (hospital_id, bill_number);
CREATE INDEX IF NOT EXISTS idx_bills_encounter ON bills (encounter_id);
CREATE INDEX IF NOT EXISTS idx_bills_billing_account ON bills (billing_account_id);
CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills (patient_id);
CREATE INDEX IF NOT EXISTS idx_bills_state ON bills (state);
CREATE INDEX IF NOT EXISTS idx_bills_hospital_created ON bills (hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_replaces ON bills (replaces_bill_id) WHERE replaces_bill_id IS NOT NULL;


-- ─── 2. bill_state_history ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bill_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('send_for_review','finalize','settle_payment','close','archive','reverse','reissue','create')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  reason TEXT,
  snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_state_history_bill ON bill_state_history (bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_state_history_hospital_created ON bill_state_history (hospital_id, created_at DESC);


-- ─── 3. bill_lines (snapshot frozen at finalized) ──────────────────────────
CREATE TABLE IF NOT EXISTS bill_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  charge_item_id UUID REFERENCES charge_items(id) ON DELETE RESTRICT,
  category TEXT NOT NULL,
  display_name TEXT NOT NULL,
  charge_code TEXT,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price_inr NUMERIC(14, 2) NOT NULL,
  line_total_inr NUMERIC(14, 2) NOT NULL,
  gst_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0,
  gst_amount_inr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bill_lines_bill ON bill_lines (bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_lines_category ON bill_lines (category);
CREATE INDEX IF NOT EXISTS idx_bill_lines_charge_item ON bill_lines (charge_item_id) WHERE charge_item_id IS NOT NULL;


-- ─── 4. bill_sequences (separate from invoice_sequences) ───────────────────
-- invoice_sequences PK is just hospital_id (one prefix per hospital), so
-- bills get their own counter. Format: BILL-{hospital}-{year}-{6-digit}
CREATE TABLE IF NOT EXISTS bill_sequences (
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  year INTEGER NOT NULL,
  next_value INTEGER NOT NULL DEFAULT 1,
  prefix TEXT NOT NULL DEFAULT 'BILL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (hospital_id, year)
);

INSERT INTO bill_sequences (hospital_id, year, prefix)
VALUES ('EHRC', 2026, 'BILL')
ON CONFLICT (hospital_id, year) DO NOTHING;
