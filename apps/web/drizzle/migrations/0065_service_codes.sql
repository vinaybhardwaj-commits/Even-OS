-- =============================================================================
-- Migration 0065 — Codes Module Phase 3 (Service Codes)
-- =============================================================================
-- Greenfield catalog of service-type orderables. Mirrors inventory_items
-- (Phase 1) for symmetric items+services architecture.
--
-- 5 new tables:
--   1. service_lookup_types (9 fixed values seeded inline)
--   2. service_lookup_departments (26 unique codes seeded inline; 29 logical
--      departments collapse to 26 unique dept codes with subdept disambiguation)
--   3. service_lookup_subdepartments (6 seeds for GAS-S/M, NEU-S/P, ONS-S/M)
--   4. service_serial_counters (per-bucket atomic monotonic allocation)
--   5. service_codes (~39 columns + audit metadata; CHECK enums for the
--      6-state approval status, patient_type, gender, tax_type, package_type,
--      order_frequency, source)
--
-- Idempotent: every CREATE uses IF NOT EXISTS. Seed inserts use
-- ON CONFLICT DO NOTHING (per-natural-key).
--
-- Backfill from existing charge_master_* runs separately via
-- scripts/backfill-service-codes.ts (Phase 3.5).
-- =============================================================================

-- ─── 1. service_lookup_types ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_lookup_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_service_lookup_types_code CHECK (code ~ '^[A-Z]{2}$')
);

INSERT INTO service_lookup_types (code, label, description, sort_order) VALUES
  ('PR', 'Procedure',    'Operative or interventional procedure',          1),
  ('CN', 'Consultation', 'Doctor consultation visit',                       2),
  ('LB', 'Lab',          'Laboratory test or panel',                        3),
  ('IM', 'Imaging',      'Imaging study (radiology, ultrasound, etc.)',     4),
  ('PK', 'Pack',         'Bundle (CSSD pack, OT pack, surgical kit)',       5),
  ('BD', 'Bed day',      'Per-day bed charge',                              6),
  ('RM', 'Room day',     'Per-day room charge (alias of BD for clarity)',   7),
  ('FE', 'Fee',          'Administrative fee (registration, certificate)',  8),
  ('XX', 'Other',        'Catch-all for codes not yet classified',          9)
ON CONFLICT (code) DO NOTHING;


-- ─── 2. service_lookup_departments (26 unique codes from Billing Manual) ────
CREATE TABLE IF NOT EXISTS service_lookup_departments (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('admin','lab','imaging','surgical','medical','support')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_service_lookup_departments_code CHECK (code ~ '^[A-Z]{3,5}$')
);

INSERT INTO service_lookup_departments (code, label, category, sort_order) VALUES
  -- Admin
  ('ADM',   'Administrative',                      'admin',     1),
  ('AMB',   'Administrative — Ambulance',          'admin',     2),
  -- Emergency
  ('EMR',   'Accident & Emergency',                 'admin',     3),
  ('MLC',   'Medico-Legal Case',                    'admin',     4),
  -- Lab (6 sub-areas)
  ('LHA',   'Lab Haematology',                      'lab',      10),
  ('LBI',   'Lab Biochemistry',                     'lab',      11),
  ('LHI',   'Lab Histopathology',                   'lab',      12),
  ('LCI',   'Lab Cytology',                         'lab',      13),
  ('LBB',   'Lab Blood Bank',                       'lab',      14),
  ('LMI',   'Lab Microbiology',                     'lab',      15),
  -- Diagnostics
  ('CAD',   'Cardiology',                           'imaging',  20),
  ('RAD',   'Radiology',                            'imaging',  21),
  -- Surgical specialties
  ('ENT',   'ENT Surgery',                          'surgical', 30),
  ('ENTSB', 'ENT Skull Base Surgery',               'surgical', 31),
  ('GAS',   'Gastroenterology',                     'surgical', 32),
  ('GEN',   'General Surgery',                      'surgical', 33),
  ('NEU',   'Neuro',                                'surgical', 34),
  ('OBG',   'Obstetrics & Gynaecology',             'surgical', 35),
  ('ONS',   'Oncology',                             'surgical', 36),
  ('OPTO',  'Ophthalmology',                        'surgical', 37),
  ('ORT',   'Orthopaedics',                         'surgical', 38),
  ('PAS',   'Paediatric Surgery',                   'surgical', 39),
  ('PLS',   'Plastic Surgery',                      'surgical', 40),
  ('URO',   'Urology',                              'surgical', 41),
  ('VAS',   'Vascular Surgery',                     'surgical', 42),
  -- Support
  ('PHY',   'Physiotherapy',                        'support',  50),
  ('NEPH',  'Nephro Procedures',                    'medical',  51)
ON CONFLICT (code) DO NOTHING;


-- ─── 3. service_lookup_subdepartments (6 seeds for shared-code splits) ──────
CREATE TABLE IF NOT EXISTS service_lookup_subdepartments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_code TEXT NOT NULL REFERENCES service_lookup_departments(code) ON DELETE CASCADE,
  sub_code TEXT,
  label TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_lookup_subdepartments_dept_sub
  ON service_lookup_subdepartments (department_code, sub_code);

INSERT INTO service_lookup_subdepartments (department_code, sub_code, label, sort_order) VALUES
  ('GAS', 'S', 'Gastroenterology Surgical', 1),
  ('GAS', 'M', 'Gastroenterology Medical',  2),
  ('NEU', 'S', 'Neurosurgery',              1),
  ('NEU', 'P', 'Neuro Procedures',          2),
  ('ONS', 'S', 'Oncology Surgery',          1),
  ('ONS', 'M', 'Oncology Medical',          2)
ON CONFLICT (department_code, sub_code) DO NOTHING;


-- ─── 4. service_serial_counters (atomic per-bucket monotonic allocation) ───
CREATE TABLE IF NOT EXISTS service_serial_counters (
  bucket TEXT PRIMARY KEY,
  last_serial INTEGER NOT NULL DEFAULT 0 CHECK (last_serial >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─── 5. service_codes (the catalog) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

  -- Format identity
  service_code TEXT NOT NULL,
  service_type_code TEXT NOT NULL REFERENCES service_lookup_types(code) ON DELETE RESTRICT,
  department_code TEXT NOT NULL REFERENCES service_lookup_departments(code) ON DELETE RESTRICT,
  subdepartment_id UUID REFERENCES service_lookup_subdepartments(id) ON DELETE SET NULL,
  serial INTEGER NOT NULL CHECK (serial > 0 AND serial < 10000),

  -- Names + classification
  service_name TEXT NOT NULL,
  legacy_code TEXT,
  department_name TEXT,
  subdepartment_name TEXT,

  -- Operational flags
  is_prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_orderable BOOLEAN NOT NULL DEFAULT TRUE,
  is_chargeable BOOLEAN NOT NULL DEFAULT TRUE,
  is_searchable BOOLEAN NOT NULL DEFAULT TRUE,
  is_validity_period_required BOOLEAN NOT NULL DEFAULT FALSE,
  validity_period_days INTEGER,

  -- Approval workflow status (mirrors inventory_items.status)
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_clinical_review','pending_master_data_review','pending_cms_gm_review','active','rejected')),

  -- Patient applicability
  patient_type TEXT NOT NULL DEFAULT 'all'
    CHECK (patient_type IN ('all','ipd','opd','er','daycare')),
  gender TEXT NOT NULL DEFAULT 'all'
    CHECK (gender IN ('all','male','female','other')),

  -- Tax + cost
  is_tax_applicable BOOLEAN NOT NULL DEFAULT FALSE,
  unit_tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax_type TEXT NOT NULL DEFAULT 'NA'
    CHECK (tax_type IN ('GST','CESS','IGST','SGST','CGST','NA')),
  tax_value_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  is_hospital_cost_applicable BOOLEAN NOT NULL DEFAULT FALSE,

  -- UX text
  nurse_remark TEXT,
  patient_billing_remark TEXT,

  -- Ordering routing
  ordering_department TEXT,
  ordering_specialty TEXT,
  is_reason_for_request_mandatory BOOLEAN NOT NULL DEFAULT FALSE,

  -- Package fields
  package_type TEXT NOT NULL DEFAULT 'NA'
    CHECK (package_type IN ('opd','ipd','health_check','NA')),
  package_subtype TEXT,
  show_online BOOLEAN NOT NULL DEFAULT FALSE,
  part_of_package BOOLEAN NOT NULL DEFAULT FALSE,
  is_editable_price BOOLEAN NOT NULL DEFAULT FALSE,

  -- Order quantity defaults
  order_frequency TEXT NOT NULL DEFAULT 'NA'
    CHECK (order_frequency IN ('STAT','BID','TID','QID','DAILY','PRN','NA')),
  order_quantity_default INTEGER NOT NULL DEFAULT 1 CHECK (order_quantity_default >= 1),

  -- Misc flags
  is_cosmetic BOOLEAN NOT NULL DEFAULT FALSE,

  -- Provenance / audit
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','kx_import','charge_master_backfill','csv_import')),
  source_ref JSONB,
  notes TEXT,

  -- Audit fields
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Format integrity at row level (defense-in-depth alongside app-side regex)
  CONSTRAINT chk_service_codes_format CHECK (
    service_code ~ '^S-(PR|CN|LB|IM|PK|BD|RM|FE|XX)-[A-Z]{3,5}-\d{4}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_codes_code_hospital ON service_codes (hospital_id, service_code);
CREATE INDEX IF NOT EXISTS idx_service_codes_bucket ON service_codes (service_type_code, department_code);
CREATE INDEX IF NOT EXISTS idx_service_codes_status ON service_codes (status);
CREATE INDEX IF NOT EXISTS idx_service_codes_hospital ON service_codes (hospital_id);
CREATE INDEX IF NOT EXISTS idx_service_codes_service_type ON service_codes (service_type_code);
CREATE INDEX IF NOT EXISTS idx_service_codes_department ON service_codes (department_code);
CREATE INDEX IF NOT EXISTS idx_service_codes_name ON service_codes (service_name);
