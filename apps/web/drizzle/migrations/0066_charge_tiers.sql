-- =============================================================================
-- Migration 0066 — Codes Module Phase 4 (Charge Tiers Refactor)
-- =============================================================================
-- 4 new tables + ALTER on charge_master_item to add service_code_id FK
-- bridging Phase 3 service_codes to legacy charge_master_item.
--
-- All idempotent (IF NOT EXISTS / DO $$ guards). Seed inserts use ON CONFLICT
-- DO NOTHING. The 21 Billing Manual rule seeds are at the bottom.
-- =============================================================================

-- ─── 1. code_charge_tiers ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS code_charge_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

  -- Polymorphic code reference: exactly one of item_id / service_id is set.
  item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  service_id UUID REFERENCES service_codes(id) ON DELETE CASCADE,

  code_kind TEXT NOT NULL CHECK (code_kind IN ('item','service')),

  class_code TEXT NOT NULL CHECK (class_code IN (
    'GENERAL','SEMI_PVT','PVT','ICU','SUITE','HDU','ER','OPD','_PACKAGE','_ANY'
  )),

  empanelment_id UUID,    -- FK added below, after empanelments table is created

  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,

  price_inr NUMERIC(14, 2) NOT NULL,
  is_open_billing BOOLEAN NOT NULL DEFAULT FALSE,
  package_member_count INTEGER NOT NULL DEFAULT 0 CHECK (package_member_count >= 0),
  gst_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0,

  source TEXT NOT NULL DEFAULT 'manual',
  source_ref JSONB,
  notes TEXT,

  audit_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  audit_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A2 lock: exactly one of item_id / service_id must be set
  CONSTRAINT chk_code_charge_tiers_polymorphic CHECK (
    (item_id IS NOT NULL AND service_id IS NULL)
    OR (item_id IS NULL AND service_id IS NOT NULL)
  ),
  CONSTRAINT chk_code_charge_tiers_kind_consistent CHECK (
    (code_kind = 'item' AND item_id IS NOT NULL)
    OR (code_kind = 'service' AND service_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_code_charge_tiers_item ON code_charge_tiers (item_id);
CREATE INDEX IF NOT EXISTS idx_code_charge_tiers_service ON code_charge_tiers (service_id);
CREATE INDEX IF NOT EXISTS idx_code_charge_tiers_current_item ON code_charge_tiers (item_id, class_code) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_code_charge_tiers_current_service ON code_charge_tiers (service_id, class_code) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_code_charge_tiers_class ON code_charge_tiers (class_code);
CREATE INDEX IF NOT EXISTS idx_code_charge_tiers_empanelment ON code_charge_tiers (empanelment_id);
CREATE INDEX IF NOT EXISTS idx_code_charge_tiers_hospital ON code_charge_tiers (hospital_id);


-- ─── 2. code_charge_rules ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS code_charge_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('surcharge','discount','formula','restriction','audit_trigger')),
  rule_name TEXT NOT NULL,
  description TEXT,
  applies_to_code_kind TEXT NOT NULL DEFAULT 'all',
  formula_json JSONB NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_charge_rules_hospital_name ON code_charge_rules (hospital_id, rule_name);
CREATE INDEX IF NOT EXISTS idx_code_charge_rules_type ON code_charge_rules (rule_type);
CREATE INDEX IF NOT EXISTS idx_code_charge_rules_active ON code_charge_rules (is_active);


-- ─── 3. code_charge_empanelments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS code_charge_empanelments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE CASCADE,
  empanelment_name TEXT NOT NULL,
  empanelment_type TEXT NOT NULL CHECK (empanelment_type IN ('tpa','corporate','insurance','govt_scheme','self')),
  agreement_number TEXT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  contact_person TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_charge_empanelments_name_hospital ON code_charge_empanelments (hospital_id, empanelment_name);
CREATE INDEX IF NOT EXISTS idx_code_charge_empanelments_type ON code_charge_empanelments (empanelment_type);
CREATE INDEX IF NOT EXISTS idx_code_charge_empanelments_active ON code_charge_empanelments (is_active);

-- Now wire empanelment_id FK on code_charge_tiers (created in step 1; tables created in order)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'code_charge_tiers_empanelment_id_fkey'
  ) THEN
    ALTER TABLE code_charge_tiers
      ADD CONSTRAINT code_charge_tiers_empanelment_id_fkey
      FOREIGN KEY (empanelment_id)
      REFERENCES code_charge_empanelments(id)
      ON DELETE SET NULL;
  END IF;
END$$;


-- ─── 4. charge_tier_imports — staging table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS charge_tier_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  import_kind TEXT NOT NULL CHECK (import_kind IN ('rooms','packages','investigations','mixed')),
  source_filename TEXT NOT NULL,
  source_bytes INTEGER,
  staged_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_applied INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','partial','rejected','applied')),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_charge_tier_imports_hospital_created ON charge_tier_imports (hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_charge_tier_imports_status ON charge_tier_imports (status);


-- ─── 5. charge_master_item.service_code_id bridge column ────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='charge_master_item' AND column_name='service_code_id'
  ) THEN
    ALTER TABLE charge_master_item
      ADD COLUMN service_code_id UUID REFERENCES service_codes(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_charge_master_item_service_code ON charge_master_item (service_code_id);


-- ─── 6. Seed 21 Billing Manual rules for EHRC ──────────────────────────────
-- Per Q6: declarative formula_json interpreted by BV3 Phase 4 bill builder.
INSERT INTO code_charge_rules (hospital_id, rule_type, rule_name, description, applies_to_code_kind, formula_json, priority, notes) VALUES
  -- 1-4: Multi-surgery + risk surcharges
  ('EHRC', 'formula',   'multi_surgery_progressive',     'Multi-surgery progressive: 1st 100% / 2nd 60% / 3rd+ 60%',                 'procedure',     '{"type":"progressive_pct","tiers":[100,60,60]}',                                            10, 'Billing Manual §4.1'),
  ('EHRC', 'surcharge', 'high_risk_surcharge',            'High Risk: +15% on professional charges',                                  'procedure',     '{"type":"flat_pct","value":15,"applies_to":"professional_charges"}',                       20, 'Billing Manual §4.2'),
  ('EHRC', 'surcharge', 'emergency_surcharge_professional','Emergency: +20% professional charges',                                    'procedure',     '{"type":"flat_pct","value":20,"applies_to":"professional_charges"}',                       21, 'Billing Manual §4.3'),
  ('EHRC', 'surcharge', 'emergency_surcharge_ot',         'Emergency: +50% OT charges',                                               'procedure',     '{"type":"flat_pct","value":50,"applies_to":"ot_charges"}',                                 22, 'Billing Manual §4.3'),

  -- 5-7: Surgeon team formulas
  ('EHRC', 'formula',   'high_risk_emergency_combined',  'High Risk + Emergency combined: +30%',                                      'procedure',     '{"type":"combined_pct","value":30,"applies_to":"professional_charges"}',                   30, 'Billing Manual §4.4'),
  ('EHRC', 'formula',   'assistant_surgeon_fee',          'Assistant Surgeon Fee: 30% of primary surgeon fee',                        'procedure',     '{"type":"pct_of_primary","value":30,"of":"primary_surgeon_fee"}',                          40, 'Billing Manual §4.5'),
  ('EHRC', 'formula',   'anesthetist_fee',                'Anesthetist Fee: 30% of primary surgeon fee',                              'procedure',     '{"type":"pct_of_primary","value":30,"of":"primary_surgeon_fee"}',                          41, 'Billing Manual §4.6'),
  ('EHRC', 'formula',   'ot_charges_pct_of_surgeon',     'OT Charges: configurable % of surgeon fee (default 100% per BM §4.7)',     'procedure',     '{"type":"pct_of_primary","value":100,"of":"primary_surgeon_fee"}',                         42, 'Billing Manual §4.7 (configurable in charge_master_hospital_setting.ot_percent_of_surgeon)'),

  -- 8-12: Time-based surcharges + discounts
  ('EHRC', 'surcharge', 'on_call_consultation',           'On-call Consultation: +50% during 21:00-08:00 + holidays',                'consultation',  '{"type":"time_window","from_hour":21,"to_hour":8,"multiplier":1.5,"includes_holidays":true}', 50, 'Billing Manual §5.1'),
  ('EHRC', 'discount',  'same_day_discharge_under_6h',    'Same-day discharge: 50% discount if stay < 6 hours',                       'bed',           '{"type":"flat_pct_discount","value":50,"max_stay_hours":6}',                              60, 'Billing Manual §5.2'),
  ('EHRC', 'discount',  'same_day_discharge_6h_plus',     'Same-day discharge: 100% discount if stay >= 6 hours',                     'bed',           '{"type":"flat_pct_discount","value":100,"min_stay_hours":6}',                             61, 'Billing Manual §5.2'),
  ('EHRC', 'surcharge', 'late_discharge_2pm_6pm',         'Late discharge: +100% if discharged 2pm-6pm',                              'bed',           '{"type":"time_window_surcharge","from_hour":14,"to_hour":18,"multiplier":1.0}',           70, 'Billing Manual §5.3'),
  ('EHRC', 'surcharge', 'late_discharge_after_6pm',       'Late discharge: +full day if after 6pm',                                  'bed',           '{"type":"after_hour_full_day","threshold_hour":18}',                                       71, 'Billing Manual §5.3'),

  -- 13-14: Bed slot rules
  ('EHRC', 'formula',   'hourly_bed_slots',               'Hourly bed slots — Labor 6h / Day Care 6h / ER Observation 2h',          'bed',           '{"type":"hourly_slots","slots":{"LABOR":6,"DAYCARE":6,"ER_OBS":2}}',                      80, 'Billing Manual §5.4'),
  ('EHRC', 'formula',   'midnight_auto_charge',           'Auto-charge at midnight for inpatient bed tariffs',                       'bed',           '{"type":"daily_anchor","anchor_hour":0,"applies_to":"inpatient_classes"}',                81, 'Billing Manual §5.5'),

  -- 15-18: Multi-consult + free OPD + audit
  ('EHRC', 'formula',   'multi_consultant_single_disease','Multi-consultant single-disease — 1 consult fee total',                   'consultation',  '{"type":"deduplicate_per_disease","keep":"first_consult"}',                                90, 'Billing Manual §5.6'),
  ('EHRC', 'formula',   'free_opd_followup_7d',           'Free OPD follow-up within 7 days of original consult',                    'consultation',  '{"type":"free_followup_window","days":7}',                                                 91, 'Billing Manual §5.7'),
  ('EHRC', 'audit_trigger', 'over_consult_threshold',     'Audit alert when >4 consults/day in ward or >4 in ICU',                   'consultation',  '{"type":"per_day_threshold","ward_max":4,"icu_max":4}',                                  100, 'Billing Manual §5.8'),
  ('EHRC', 'restriction', 'no_charge_emergency_lifesaving','No-charge policy: CPR / Code Blue / Defibrillator',                       'procedure',     '{"type":"no_charge_codes","codes":["CPR","CODE_BLUE","DEFIBRILLATOR"]}',                  110, 'Billing Manual §6.1'),

  -- 19-21: Surgery levels + empanelment
  ('EHRC', 'formula',   'single_incision_modifier',       'Single incision multi-surgery modifier — apply 1st-procedure rate only',  'procedure',     '{"type":"modifier","collapse_to":"primary_only"}',                                       120, 'Billing Manual §6.2'),
  ('EHRC', 'formula',   'surgery_level_progressive',      'Surgery Levels L1-L5+ progressive (drives Assistant Surgeon Fee)',         'procedure',     '{"type":"surgery_level_table","levels":["L1","L2","L3","L4","L5+"]}',                    121, 'Billing Manual §6.3'),
  ('EHRC', 'formula',   'empanelment_override_resolution','Empanelment override resolution — applied AFTER tariff lookup',           'all',           '{"type":"empanelment_resolver","priority":"empanelment > standard_tier"}',               200, 'Billing Manual §7.4 / Q6 layer 3c')
ON CONFLICT (hospital_id, rule_name) DO NOTHING;
