-- BV3.1 — Billing v3 foundation (10 tables, additive)
--
-- Creates the ground-up Billing v3 schema alongside v2 (09-billing,
-- 39-bill-adjustments, 01-master-data#charge_master). v2 keeps running
-- until the BV3.10 cutover flip.
--
-- Conventions:
--   - Status/role/enum-shaped fields are TEXT + CHECK (matches 0057_tasks.sql).
--     pgEnum avoided so future values can be added without a Drizzle
--     schema migration.
--   - Money is NUMERIC(14, 2). GST % is NUMERIC(5, 2).
--   - All timestamps are TIMESTAMPTZ + DEFAULT NOW().
--   - hospital_id is TEXT → hospitals(hospital_id) per repo convention.
--
-- Idempotent: every CREATE uses IF NOT EXISTS. Safe to re-run.
--
-- Rollback: DROP TABLE billing_account_payer, billing_charge,
--   discount_application, discount_policy, charge_master_hospital_setting,
--   charge_master_tariff_import, charge_master_room,
--   charge_master_package, charge_master_price, charge_master_item CASCADE;


-- ── 1. charge_master_item ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS charge_master_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  charge_code TEXT NOT NULL,
  charge_name TEXT NOT NULL,
  category TEXT NOT NULL,
  dept_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_finance'
    CHECK (status IN ('active','pending_finance','inactive')),
  approver_role TEXT
    CHECK (approver_role IS NULL OR approver_role IN ('cms','gm')),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  triggers_collection_fee BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_master_item_code_hospital
  ON charge_master_item (hospital_id, charge_code);
CREATE INDEX IF NOT EXISTS idx_charge_master_item_category
  ON charge_master_item (category);
CREATE INDEX IF NOT EXISTS idx_charge_master_item_dept_code
  ON charge_master_item (dept_code);
CREATE INDEX IF NOT EXISTS idx_charge_master_item_status
  ON charge_master_item (status);
CREATE INDEX IF NOT EXISTS idx_charge_master_item_hospital_id
  ON charge_master_item (hospital_id);
-- Partial: the LHA01038-style trigger rows only (hot path for lab auto-post).
CREATE INDEX IF NOT EXISTS idx_charge_master_item_collection_fee
  ON charge_master_item (hospital_id)
  WHERE triggers_collection_fee = TRUE;

COMMENT ON TABLE charge_master_item IS
  'BV3.1: atomic billable. Replaces v2 charge_master. status=pending_finance scaffolds codes that exist without a price. triggers_collection_fee=true signals LHA01038-style auto-post.';


-- ── 2. charge_master_price ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS charge_master_price (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES charge_master_item(id) ON DELETE CASCADE,
  class_code TEXT NOT NULL
    CHECK (class_code IN ('OPD','GENERAL','SEMI_PVT','PVT','SUITE','ICU','HDU','_ANY')),
  price NUMERIC(14, 2) NOT NULL,
  is_gst_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  gst_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_master_price_item_class_effective
  ON charge_master_price (item_id, class_code, effective_from);
-- Partial: "current price for (item, class)" — the hot read path.
CREATE INDEX IF NOT EXISTS idx_charge_master_price_current
  ON charge_master_price (item_id, class_code)
  WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_charge_master_price_hospital
  ON charge_master_price (hospital_id);

COMMENT ON TABLE charge_master_price IS
  'BV3.1: row-per-class pricing with temporal validity. One active row per (item, class) enforced by partial index on effective_to IS NULL. class_code=_ANY for package-only or facility-only charges.';


-- ── 3. charge_master_package ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS charge_master_package (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  package_code TEXT NOT NULL,
  package_name TEXT NOT NULL,
  package_price NUMERIC(14, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('active','draft','retired')),
  suite_open_billing BOOLEAN NOT NULL DEFAULT TRUE,
  inclusions JSONB NOT NULL DEFAULT '[]',
  exclusions JSONB NOT NULL DEFAULT '[]',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_master_package_code_hospital
  ON charge_master_package (hospital_id, package_code);
CREATE INDEX IF NOT EXISTS idx_charge_master_package_status
  ON charge_master_package (status);
CREATE INDEX IF NOT EXISTS idx_charge_master_package_hospital
  ON charge_master_package (hospital_id);

COMMENT ON TABLE charge_master_package IS
  'BV3.1: package bundle with fixed price. suite_open_billing=true allows open-item billing for SUITE-class patients regardless of package.';


-- ── 4. charge_master_room ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS charge_master_room (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  room_class TEXT NOT NULL
    CHECK (room_class IN ('DAY_CARE','GENERAL','TWIN_SHARING','PRIVATE','SUITE','ICU','HDU','LABOR_OBS','ER_OBS')),
  room_class_label TEXT NOT NULL,
  billing_unit TEXT NOT NULL DEFAULT 'day'
    CHECK (billing_unit IN ('day','6hr','2hr')),
  tariff NUMERIC(14, 2) NOT NULL DEFAULT 0,
  is_gst_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  gst_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0,
  upgrade_differential_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_master_room_class_hospital
  ON charge_master_room (hospital_id, room_class);
CREATE INDEX IF NOT EXISTS idx_charge_master_room_hospital
  ON charge_master_room (hospital_id);

COMMENT ON TABLE charge_master_room IS
  'BV3.1: per-class room tariff + billing-unit rules. 9 rows per hospital (one per class). ICU/HDU/observation can be sub-day billed.';


-- ── 5. charge_master_tariff_import ───────────────────────────────────
CREATE TABLE IF NOT EXISTS charge_master_tariff_import (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  import_kind TEXT NOT NULL
    CHECK (import_kind IN ('items','prices','packages','rooms','policies')),
  source_filename TEXT NOT NULL,
  source_bytes INTEGER,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  rows_errored INTEGER NOT NULL DEFAULT 0,
  error_summary JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','success','partial','failed')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_charge_master_tariff_import_hospital_created
  ON charge_master_tariff_import (hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_charge_master_tariff_import_status
  ON charge_master_tariff_import (status);

COMMENT ON TABLE charge_master_tariff_import IS
  'BV3.1: audit trail for Charge Master Importer (BV3.2) bulk uploads. error_summary JSONB holds per-row failure reasons.';


-- ── 6. charge_master_hospital_setting ────────────────────────────────
CREATE TABLE IF NOT EXISTS charge_master_hospital_setting (
  hospital_id TEXT PRIMARY KEY REFERENCES hospitals(hospital_id) ON DELETE CASCADE,
  consultation_cap_per_day INTEGER NOT NULL DEFAULT 3,
  on_call_surcharge_percent NUMERIC(5, 2) NOT NULL DEFAULT 25,
  hr_multiplier_percent NUMERIC(5, 2) NOT NULL DEFAULT 100,
  emergency_surcharge_percent NUMERIC(5, 2) NOT NULL DEFAULT 50,
  hr_em_stacking_rule TEXT NOT NULL DEFAULT 'cap_at_higher'
    CHECK (hr_em_stacking_rule IN ('multiply','add','cap_at_higher')),
  multi_surgery_2nd_percent NUMERIC(5, 2) NOT NULL DEFAULT 50,
  multi_surgery_3rd_percent NUMERIC(5, 2) NOT NULL DEFAULT 25,
  multi_surgery_4th_plus_percent NUMERIC(5, 2) NOT NULL DEFAULT 25,
  assistant_surgeon_percent NUMERIC(5, 2) NOT NULL DEFAULT 25,
  ot_percent_of_surgeon NUMERIC(5, 2) NOT NULL DEFAULT 40,
  discharge_day_billing TEXT NOT NULL DEFAULT 'admission_day_only'
    CHECK (discharge_day_billing IN ('admission_day_only','discharge_day_only','both','none')),
  cashier_waiver_self_limit_percent INTEGER NOT NULL DEFAULT 5,
  cashier_waiver_gm_limit_percent INTEGER NOT NULL DEFAULT 20,
  mortuary_auto_accrual_hours INTEGER NOT NULL DEFAULT 12,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE charge_master_hospital_setting IS
  'BV3.1: one row per hospital. 11 business-rule defaults + cashier waiver thresholds + mortuary accrual interval. PRD §4 rows 8-11, 17-22.';


-- ── 7. discount_policy ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discount_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  policy_code TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  counterparty_id UUID,
  payer_types TEXT[] NOT NULL DEFAULT '{}',
  service_types TEXT[] NOT NULL DEFAULT '{}',
  tariff_classes TEXT[] NOT NULL DEFAULT '{}',
  discount_type TEXT NOT NULL DEFAULT 'percent'
    CHECK (discount_type IN ('percent','flat')),
  discount_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  max_cap_amount NUMERIC(14, 2),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_policy_code_hospital
  ON discount_policy (hospital_id, policy_code);
CREATE INDEX IF NOT EXISTS idx_discount_policy_counterparty
  ON discount_policy (counterparty_id);
CREATE INDEX IF NOT EXISTS idx_discount_policy_active
  ON discount_policy (is_active);
CREATE INDEX IF NOT EXISTS idx_discount_policy_hospital
  ON discount_policy (hospital_id);

COMMENT ON TABLE discount_policy IS
  'BV3.1: counterparty-driven discount rules. Empty scope arrays mean "all". is_active starts FALSE; CFO activates each post-launch. Empty at BV3.1; populated in BV3.2+.';


-- ── 8. discount_application ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discount_application (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  billing_account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
  discount_policy_id UUID REFERENCES discount_policy(id) ON DELETE RESTRICT,
  discount_amount NUMERIC(14, 2) NOT NULL,
  discount_type_applied TEXT NOT NULL
    CHECK (discount_type_applied IN ('percent','flat')),
  discount_percent_applied NUMERIC(5, 2),
  is_cashier_waiver BOOLEAN NOT NULL DEFAULT FALSE,
  waiver_reason TEXT,
  waiver_approval_role TEXT
    CHECK (waiver_approval_role IS NULL OR waiver_approval_role IN ('cashier_self','gm','cfo')),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reversal_reason TEXT,

  -- Integrity: waiver_reason required iff is_cashier_waiver=true.
  CONSTRAINT chk_discount_application_waiver_reason CHECK (
    (is_cashier_waiver = FALSE)
    OR (is_cashier_waiver = TRUE AND waiver_reason IS NOT NULL AND length(waiver_reason) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_discount_application_billing_account
  ON discount_application (billing_account_id);
CREATE INDEX IF NOT EXISTS idx_discount_application_patient
  ON discount_application (patient_id);
CREATE INDEX IF NOT EXISTS idx_discount_application_policy
  ON discount_application (discount_policy_id);
CREATE INDEX IF NOT EXISTS idx_discount_application_waiver
  ON discount_application (is_cashier_waiver);
CREATE INDEX IF NOT EXISTS idx_discount_application_hospital_applied_at
  ON discount_application (hospital_id, applied_at DESC);

COMMENT ON TABLE discount_application IS
  'BV3.1: every discount event. Three flavors: policy-driven (discount_policy_id set), cashier waiver (is_cashier_waiver=true + waiver_reason), and future override. Frozen amount at application time.';


-- ── 9. billing_charge ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_charge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  billing_account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  encounter_id UUID REFERENCES encounters(id) ON DELETE SET NULL,
  charge_code TEXT NOT NULL,
  charge_name TEXT NOT NULL,
  charge_master_item_id UUID REFERENCES charge_master_item(id) ON DELETE SET NULL,
  package_id UUID REFERENCES charge_master_package(id) ON DELETE SET NULL,
  source_module TEXT NOT NULL
    CHECK (source_module IN ('manual','lab','pharmacy','ot','room','package','er_obs','mortuary','admission','adjustment')),
  source_ref_id UUID,
  room_class_at_post TEXT,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(14, 2) NOT NULL,
  line_total NUMERIC(14, 2) NOT NULL,
  gst_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  is_gst_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('provisional','posted','reversed','void')),
  reverses_charge_id UUID,
  posted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Self-FK on reverses_charge_id (cannot be inline on CREATE TABLE — table
-- doesn't exist yet). Added idempotently by name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_charge_reverses_charge_id_fkey'
  ) THEN
    ALTER TABLE billing_charge
      ADD CONSTRAINT billing_charge_reverses_charge_id_fkey
      FOREIGN KEY (reverses_charge_id)
      REFERENCES billing_charge(id)
      ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_billing_charge_billing_account
  ON billing_charge (billing_account_id);
CREATE INDEX IF NOT EXISTS idx_billing_charge_patient
  ON billing_charge (patient_id);
CREATE INDEX IF NOT EXISTS idx_billing_charge_encounter
  ON billing_charge (encounter_id);
CREATE INDEX IF NOT EXISTS idx_billing_charge_item
  ON billing_charge (charge_master_item_id);
CREATE INDEX IF NOT EXISTS idx_billing_charge_source_module
  ON billing_charge (source_module);
CREATE INDEX IF NOT EXISTS idx_billing_charge_status
  ON billing_charge (status);
CREATE INDEX IF NOT EXISTS idx_billing_charge_hospital_posted_at
  ON billing_charge (hospital_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_charge_source_ref
  ON billing_charge (source_ref_id)
  WHERE source_ref_id IS NOT NULL;

COMMENT ON TABLE billing_charge IS
  'BV3.1: atomic line item in v3. Replaces v2 invoice_line_items. Every cashier post, auto-post, and reversal lands here. source_module = manual|lab|pharmacy|ot|room|package|er_obs|mortuary|admission|adjustment. Self-FK reverses_charge_id links reversal lines to originals.';


-- ── 10. billing_account_payer ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_account_payer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  billing_account_id UUID NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
  payer_kind TEXT NOT NULL
    CHECK (payer_kind IN ('self','insurance','corporate','government','ngo','counterparty_other')),
  counterparty_id UUID,
  policy_number TEXT,
  member_id TEXT,
  share_percent NUMERIC(5, 2) NOT NULL DEFAULT 100,
  priority INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_account_payer_billing_account
  ON billing_account_payer (billing_account_id);
CREATE INDEX IF NOT EXISTS idx_billing_account_payer_counterparty
  ON billing_account_payer (counterparty_id);
CREATE INDEX IF NOT EXISTS idx_billing_account_payer_kind
  ON billing_account_payer (payer_kind);
CREATE INDEX IF NOT EXISTS idx_billing_account_payer_hospital
  ON billing_account_payer (hospital_id);

COMMENT ON TABLE billing_account_payer IS
  'BV3.1: multi-payer link table. v2 stores payer inline on billing_accounts; v3 normalizes. priority=1 is primary. Dual-read window during BV3.10 cutover.';
