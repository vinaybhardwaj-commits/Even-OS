-- 0060 — SCM Core foundation (PRD #2 Phase 1.2)
--
-- Drops legacy pharmacy SCM-shaped tables (no production data; bv3 cliff-edge
-- state at HEAD 53fe73d had Vercel auto-deploy off since 22 Apr commit f486ff3)
-- and creates 19 universal SCM tables canonically named per V's 30 Apr 2026
-- Q4 Path A lock — multi-tenancy day 1, no _v2 → canonical rename phase.
--
-- 4 hospitals from day 1: EHRC + EHBR + EHIN + Brookfield (December big-bang
-- launch). All per-hospital tables have hospital_id NOT NULL.
--
-- Cross-PRD hooks reserved (FK columns nullable until upstream PRD ships):
--   - items.code_id + items.code_kind → Codes Module Phase 1 ship
--   - stock_movements.charge_item_id → Billing v3 Phase 1 ship
--   - stock_movements.source_emit_event_id → Billing v3 Q1 + Q14 dual-posting
--   - inspection_checklist_results.* → KPMG IFC Q9 v1 scope
--
-- Conventions (matches 0059_billing_v3_foundation.sql):
--   - Status/kind/role/etc fields: TEXT + CHECK constraint (no pgEnum)
--   - Money: NUMERIC(14, 2). Quantity: NUMERIC(12, 3). Pct: NUMERIC(5, 2).
--   - Timestamps: TIMESTAMPTZ + DEFAULT NOW().
--   - hospital_id: TEXT → hospitals(hospital_id) per codebase convention.
--   - Reversal pattern (self-FK + opposite-signed quantity) on stock_movements.
--   - Append-only ledgers have created_at only (no updated_at).
--
-- Idempotent: CREATE uses IF NOT EXISTS; DROP uses IF EXISTS.
--
-- Rollback:
--   DROP TABLE IF EXISTS auto_reorder_drafts, vendor_performance_metrics,
--     pm_tasks, pm_schedules, asset_register, indent_state_log, indent_items,
--     indents, inspection_checklist_results, goods_receipt_note_items,
--     goods_receipt_notes, purchase_order_items, purchase_orders,
--     purchase_requisition_items, purchase_requisitions, stock_movements,
--     inventory, items, material_classifications CASCADE;
--   (Restore legacy pharmacy tables from 12-pharmacy.ts schema as needed.)


-- ============================================================
-- DROP legacy pharmacy SCM tables (no prod data)
-- ============================================================
DROP TABLE IF EXISTS stock_alerts CASCADE;
DROP TABLE IF EXISTS purchase_order_items CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS pharmacy_inventory CASCADE;


-- ============================================================
-- 1. material_classifications (KPMG Standard/Emergency/Vital)
--    Created first so items.material_classification_id FK resolves.
-- ============================================================
CREATE TABLE IF NOT EXISTS material_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  -- nullable: classifications can be network-shared

  classification TEXT NOT NULL CHECK (classification IN ('standard','emergency','vital')),
  display_name TEXT NOT NULL,
  description TEXT,

  approval_lead_time_days INTEGER,
  procurement_lead_time_days INTEGER,
  reorder_buffer_multiplier NUMERIC(5, 2),

  maintained_by_roles TEXT[],

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mat_class_classification ON material_classifications(classification);
CREATE INDEX IF NOT EXISTS idx_mat_class_hospital ON material_classifications(hospital_id);


-- ============================================================
-- 2. items — Universal item master
-- ============================================================
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  -- nullable: network-shared per Codes Q8

  code TEXT NOT NULL,
  display_name TEXT NOT NULL,

  kind TEXT NOT NULL CHECK (kind IN (
    'drug','consumable','implant','reagent','linen','cssd_pack','equipment_spare','general'
  )),

  -- SOP v1.2 taxonomy (Codes Q10 ratification)
  storage_class TEXT CHECK (storage_class IS NULL OR storage_class IN ('N','T','O','C')),
  classification_code TEXT,

  generic_name TEXT,
  form TEXT,
  strength TEXT,
  brand TEXT,
  pack_size TEXT,

  unit_of_measure TEXT NOT NULL,

  hsn_code TEXT,
  gst_percentage NUMERIC(5, 2),

  manufacturer TEXT,
  preferred_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,

  -- Codes integration (Codes Q3) — nullable until Codes Phase 1 ships
  code_id UUID,
  code_kind TEXT,

  -- Drug master backfill (transitional)
  external_drug_id UUID REFERENCES drug_master(id) ON DELETE SET NULL,
  external_drug_master_synced_at TIMESTAMPTZ,

  -- Reorder defaults
  default_reorder_level NUMERIC(12, 3),
  default_reorder_quantity NUMERIC(12, 3),
  default_max_stock_level NUMERIC(12, 3),
  auto_reorder_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  -- KPMG material classification
  material_classification_id UUID REFERENCES material_classifications(id) ON DELETE SET NULL,
  handling_rules_apply JSONB,

  -- Lifecycle (Codes Q3 5-state + Q12 deprecation)
  status TEXT NOT NULL DEFAULT 'pending_master_data_review' CHECK (status IN (
    'pending_clinical_review','pending_master_data_review','pending_cms_gm_review',
    'active','deprecated_grace','deprecated','archived','rejected'
  )),

  deprecated_at TIMESTAMPTZ,
  deprecated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  deprecation_reason TEXT,
  deprecation_urgency_tier TEXT CHECK (
    deprecation_urgency_tier IS NULL OR deprecation_urgency_tier IN ('routine','urgent','emergency')
  ),

  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_items_hospital ON items(hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_code ON items(code);
CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_code_id ON items(code_id);
CREATE INDEX IF NOT EXISTS idx_items_external_drug ON items(external_drug_id);
CREATE INDEX IF NOT EXISTS idx_items_hospital_kind_status ON items(hospital_id, kind, status);


-- ============================================================
-- 3. inventory — Multi-location, multi-batch
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,

  location TEXT NOT NULL,

  batch_number TEXT,
  manufacturer TEXT,
  expiry_date DATE,

  quantity_on_hand NUMERIC(12, 3) NOT NULL DEFAULT 0
    CHECK (quantity_on_hand >= 0),
  quantity_reserved NUMERIC(12, 3) NOT NULL DEFAULT 0
    CHECK (quantity_reserved >= 0),
  quantity_in_transit NUMERIC(12, 3) NOT NULL DEFAULT 0
    CHECK (quantity_in_transit >= 0),

  unit_cost NUMERIC(12, 2),
  mrp NUMERIC(12, 2),

  reorder_level NUMERIC(12, 3),
  reorder_quantity NUMERIC(12, 3),
  max_stock_level NUMERIC(12, 3),

  last_movement_at TIMESTAMPTZ,
  last_restocked_at TIMESTAMPTZ,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_hospital ON inventory(hospital_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item ON inventory(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory(hospital_id, location);
CREATE INDEX IF NOT EXISTS idx_inventory_batch ON inventory(item_id, batch_number);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory(expiry_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_location_batch
  ON inventory(hospital_id, item_id, location, COALESCE(batch_number, ''));


-- ============================================================
-- 4. stock_movements — Append-only ledger with reversal pattern
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

  inventory_id UUID REFERENCES inventory(id) ON DELETE SET NULL,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,

  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'grn_receive','issue','return','adjustment_increase','adjustment_decrease',
    'transfer_out','transfer_in',
    'write_off_expiry','write_off_damage','write_off_theft','write_off_other',
    'reversal'
  )),

  quantity NUMERIC(12, 3) NOT NULL,
  previous_balance NUMERIC(12, 3) NOT NULL,
  new_balance NUMERIC(12, 3) NOT NULL,

  batch_number TEXT,
  location TEXT NOT NULL,

  source_module TEXT NOT NULL CHECK (source_module IN (
    'scm','pharmacy','ot','lims','ris','facilities','manual'
  )),
  source_ref_id UUID,
  source_emit_event_id UUID,

  charge_item_id UUID,
  cost_center_code TEXT,

  unit_cost NUMERIC(12, 2),
  total_value NUMERIC(14, 2),

  reverses_movement_id UUID,  -- self-FK ALTER below
  reversal_reason TEXT,

  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  grn_id UUID,  -- FK ALTER below (after goods_receipt_notes created)

  reason TEXT,
  notes TEXT,

  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_hospital ON stock_movements(hospital_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_inventory ON stock_movements(inventory_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements(source_module, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_emit_event ON stock_movements(source_emit_event_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reverses ON stock_movements(reverses_movement_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_hospital_created_at
  ON stock_movements(hospital_id, created_at DESC);


-- ============================================================
-- 5. purchase_requisitions (KPMG SoD; PR distinct from PO)
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

  pr_number TEXT NOT NULL,
  requisition_type TEXT NOT NULL CHECK (requisition_type IN (
    'inventory_replenishment','capex','service','consumable_emergency','consignment','tender_based'
  )),

  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','submitted','pr_approved','pr_rejected','pr_converted_to_po','cancelled'
  )),

  requested_for_location TEXT,
  priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN (
    'routine','urgent','emergency','stat'
  )),
  material_classification TEXT CHECK (
    material_classification IS NULL OR material_classification IN ('standard','emergency','vital')
  ),

  estimated_total_amount NUMERIC(14, 2),
  needed_by DATE,

  approver_role TEXT CHECK (
    approver_role IS NULL OR approver_role IN (
      'hod','procurement_head','finance_in_charge','facility_director'
    )
  ),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,

  rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,

  converted_to_po_ids UUID[],
  converted_at TIMESTAMPTZ,

  notes TEXT,

  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pr_hospital ON purchase_requisitions(hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_number ON purchase_requisitions(hospital_id, pr_number);
CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_pr_type ON purchase_requisitions(requisition_type);
CREATE INDEX IF NOT EXISTS idx_pr_classification ON purchase_requisitions(material_classification);


-- ============================================================
-- 6. purchase_requisition_items
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_requisition_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  pr_id UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,

  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,

  quantity_requested NUMERIC(12, 3) NOT NULL CHECK (quantity_requested > 0),
  estimated_unit_cost NUMERIC(12, 2),
  estimated_total NUMERIC(14, 2),

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pri_pr ON purchase_requisition_items(pr_id);
CREATE INDEX IF NOT EXISTS idx_pri_item ON purchase_requisition_items(item_id);
CREATE INDEX IF NOT EXISTS idx_pri_hospital ON purchase_requisition_items(hospital_id);


-- ============================================================
-- 7. purchase_orders (canonical; replaces dropped pharmacy version)
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

  po_number TEXT NOT NULL,
  pr_id UUID REFERENCES purchase_requisitions(id) ON DELETE SET NULL,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,

  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','approved','sent_to_vendor','partially_received','received','closed','cancelled'
  )),

  total_items INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,

  expected_delivery DATE,
  delivery_address TEXT,

  approver_role TEXT,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  cms_gm_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cms_gm_approved_at TIMESTAMPTZ,

  sent_to_vendor_at TIMESTAMPTZ,
  vendor_acknowledged_at TIMESTAMPTZ,

  first_received_at TIMESTAMPTZ,
  fully_received_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  notes TEXT,

  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_po_hospital ON purchase_orders(hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_po_number ON purchase_orders(hospital_id, po_number);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_pr ON purchase_orders(pr_id);


-- ============================================================
-- 8. purchase_order_items (canonical; replaces dropped pharmacy version)
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,

  quantity_ordered NUMERIC(12, 3) NOT NULL CHECK (quantity_ordered > 0),
  quantity_received NUMERIC(12, 3) NOT NULL DEFAULT 0
    CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered),

  unit_cost NUMERIC(12, 2) NOT NULL,
  total_cost NUMERIC(14, 2),

  expected_batch_count INTEGER,
  preferred_manufacturer TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_poi_po ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_poi_item ON purchase_order_items(item_id);
CREATE INDEX IF NOT EXISTS idx_poi_hospital ON purchase_order_items(hospital_id);


-- ============================================================
-- 9. goods_receipt_notes (3-way match + KPMG inspection)
-- ============================================================
CREATE TABLE IF NOT EXISTS goods_receipt_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

  grn_number TEXT NOT NULL,
  po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,

  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','inspection_in_progress','submitted','accepted','partially_accepted','rejected'
  )),

  vendor_invoice_number TEXT,
  vendor_invoice_date DATE,
  vendor_invoice_amount NUMERIC(14, 2),

  three_way_match_status TEXT CHECK (
    three_way_match_status IS NULL OR three_way_match_status IN (
      'pending','matched','variance_flagged','variance_approved','variance_rejected'
    )
  ),
  variance_amount NUMERIC(14, 2),
  variance_approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  variance_approved_at TIMESTAMPTZ,

  inspection_checklist_id UUID,  -- FK ALTER below
  inspection_passed BOOLEAN,

  received_at TIMESTAMPTZ,
  payment_terms_days INTEGER,
  payment_due_date DATE,

  notes TEXT,

  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grn_hospital ON goods_receipt_notes(hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grn_number ON goods_receipt_notes(hospital_id, grn_number);
CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_receipt_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_vendor ON goods_receipt_notes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_grn_status ON goods_receipt_notes(status);
CREATE INDEX IF NOT EXISTS idx_grn_match_status ON goods_receipt_notes(three_way_match_status);


-- ============================================================
-- 10. goods_receipt_note_items (with batch capture)
-- ============================================================
CREATE TABLE IF NOT EXISTS goods_receipt_note_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  grn_id UUID NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
  po_item_id UUID NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,

  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,

  quantity_received NUMERIC(12, 3) NOT NULL CHECK (quantity_received >= 0),
  quantity_accepted NUMERIC(12, 3) NOT NULL CHECK (quantity_accepted >= 0),
  quantity_rejected NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (quantity_rejected >= 0),

  batch_number TEXT NOT NULL,
  manufacturer TEXT,
  expiry_date DATE NOT NULL,

  unit_cost NUMERIC(12, 2) NOT NULL,
  total_cost NUMERIC(14, 2) NOT NULL,

  rejection_reason TEXT,

  inventory_id UUID REFERENCES inventory(id) ON DELETE SET NULL,
  stock_movement_id UUID REFERENCES stock_movements(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grni_grn ON goods_receipt_note_items(grn_id);
CREATE INDEX IF NOT EXISTS idx_grni_po_item ON goods_receipt_note_items(po_item_id);
CREATE INDEX IF NOT EXISTS idx_grni_item ON goods_receipt_note_items(item_id);
CREATE INDEX IF NOT EXISTS idx_grni_hospital ON goods_receipt_note_items(hospital_id);
CREATE INDEX IF NOT EXISTS idx_grni_batch ON goods_receipt_note_items(item_id, batch_number);


-- ============================================================
-- 11. inspection_checklist_results (KPMG 10-item)
-- ============================================================
CREATE TABLE IF NOT EXISTS inspection_checklist_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  grn_id UUID REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,

  visual_quantity_tally_pass BOOLEAN,
  invoice_match_pass BOOLEAN,
  damage_check_pass BOOLEAN,
  po_invoice_receipt_pass BOOLEAN,
  packaging_integrity_pass BOOLEAN,
  mfr_brand_batch_expiry_markings_pass BOOLEAN,
  shelf_life_180_days_pass BOOLEAN,
  broken_bottles_pass BOOLEAN,
  iv_fluid_fungus_pass BOOLEAN,
  cold_chain_indicators_pass BOOLEAN,

  overall_pass BOOLEAN NOT NULL,
  failure_notes TEXT,

  inspected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inspection_grn ON inspection_checklist_results(grn_id);
CREATE INDEX IF NOT EXISTS idx_inspection_hospital ON inspection_checklist_results(hospital_id);


-- ============================================================
-- 12. indents (Phase 2 caregiver requisition workflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS indents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

  indent_number TEXT NOT NULL,
  raised_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  source_location TEXT NOT NULL,
  destination_location TEXT NOT NULL,

  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending','approved','issued','in_transit','received','closed','rejected','cancelled'
  )),

  priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN (
    'routine','urgent','stat','emergency'
  )),

  encounter_id UUID,
  patient_id UUID,

  reason TEXT,
  notes TEXT,

  sla_due_at TIMESTAMPTZ,
  sla_breached_at TIMESTAMPTZ,

  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  issued_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,

  cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_indents_hospital ON indents(hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_indents_number ON indents(hospital_id, indent_number);
CREATE INDEX IF NOT EXISTS idx_indents_raised_by ON indents(raised_by);
CREATE INDEX IF NOT EXISTS idx_indents_state ON indents(state);
CREATE INDEX IF NOT EXISTS idx_indents_destination ON indents(hospital_id, destination_location);
CREATE INDEX IF NOT EXISTS idx_indents_priority ON indents(priority);
CREATE INDEX IF NOT EXISTS idx_indents_sla ON indents(sla_due_at);


-- ============================================================
-- 13. indent_items
-- ============================================================
CREATE TABLE IF NOT EXISTS indent_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  indent_id UUID NOT NULL REFERENCES indents(id) ON DELETE CASCADE,

  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  item_name TEXT NOT NULL,

  quantity_requested NUMERIC(12, 3) NOT NULL CHECK (quantity_requested > 0),
  quantity_approved NUMERIC(12, 3),
  quantity_issued NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0),
  quantity_acknowledged NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (quantity_acknowledged >= 0),

  source_inventory_id UUID REFERENCES inventory(id) ON DELETE SET NULL,
  stock_movement_out_id UUID REFERENCES stock_movements(id) ON DELETE SET NULL,
  stock_movement_in_id UUID REFERENCES stock_movements(id) ON DELETE SET NULL,

  charge_item_id UUID,

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_indent_items_indent ON indent_items(indent_id);
CREATE INDEX IF NOT EXISTS idx_indent_items_item ON indent_items(item_id);
CREATE INDEX IF NOT EXISTS idx_indent_items_hospital ON indent_items(hospital_id);


-- ============================================================
-- 14. indent_state_log (state transition audit)
-- ============================================================
CREATE TABLE IF NOT EXISTS indent_state_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  indent_id UUID NOT NULL REFERENCES indents(id) ON DELETE CASCADE,

  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role TEXT,
  reason TEXT,
  notes TEXT,

  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_indent_state_log_indent ON indent_state_log(indent_id);
CREATE INDEX IF NOT EXISTS idx_indent_state_log_hospital ON indent_state_log(hospital_id);


-- ============================================================
-- 15. asset_register (Phase 5)
-- ============================================================
CREATE TABLE IF NOT EXISTS asset_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

  asset_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'imaging','surgical','monitoring','sterilization','it','furniture','utility','other'
  )),

  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  grn_id UUID REFERENCES goods_receipt_notes(id) ON DELETE SET NULL,

  serial_number TEXT,
  make TEXT,
  model TEXT,
  manufacturer TEXT,

  installed_date DATE,
  warranty_until DATE,
  service_contract_until DATE,
  service_contract_id UUID,  -- FK to vendor_contracts (46-vendor-ap.ts) — added in later phase

  current_location TEXT,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_department TEXT,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active','under_maintenance','retired','disposed','scrapped','condemned'
  )),

  cost_at_acquisition NUMERIC(14, 2),
  current_book_value NUMERIC(14, 2),
  useful_life_years INTEGER,
  depreciation_method TEXT CHECK (
    depreciation_method IS NULL OR depreciation_method IN (
      'straight_line','reducing_balance','none'
    )
  ),

  retired_at TIMESTAMPTZ,
  retired_by UUID REFERENCES users(id) ON DELETE SET NULL,
  retirement_reason TEXT,

  notes TEXT,

  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_asset_hospital ON asset_register(hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_code ON asset_register(hospital_id, asset_code);
CREATE INDEX IF NOT EXISTS idx_asset_serial ON asset_register(serial_number);
CREATE INDEX IF NOT EXISTS idx_asset_category ON asset_register(category);
CREATE INDEX IF NOT EXISTS idx_asset_status ON asset_register(status);
CREATE INDEX IF NOT EXISTS idx_asset_location ON asset_register(hospital_id, current_location);


-- ============================================================
-- 16. pm_schedules (Preventive Maintenance)
-- ============================================================
CREATE TABLE IF NOT EXISTS pm_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL REFERENCES asset_register(id) ON DELETE CASCADE,

  cadence_type TEXT NOT NULL CHECK (cadence_type IN (
    'calendar_days','calendar_weeks','calendar_months','calendar_years','usage_hours','hybrid'
  )),
  cadence_value INTEGER NOT NULL CHECK (cadence_value > 0),

  task_name TEXT NOT NULL,
  task_description TEXT,
  expected_duration_minutes INTEGER,

  assigned_to_role TEXT CHECK (
    assigned_to_role IS NULL OR assigned_to_role IN (
      'biomed_tech','vendor_engineer','facility_engineer','it_admin'
    )
  ),

  vendor_contract_id UUID,

  next_due_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pm_sched_asset ON pm_schedules(asset_id);
CREATE INDEX IF NOT EXISTS idx_pm_sched_next_due ON pm_schedules(next_due_at);
CREATE INDEX IF NOT EXISTS idx_pm_sched_hospital ON pm_schedules(hospital_id);


-- ============================================================
-- 17. pm_tasks (generated from schedules)
-- ============================================================
CREATE TABLE IF NOT EXISTS pm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  schedule_id UUID NOT NULL REFERENCES pm_schedules(id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL REFERENCES asset_register(id) ON DELETE RESTRICT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','assigned','in_progress','completed','skipped','overdue'
  )),

  due_at TIMESTAMPTZ NOT NULL,
  assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  skipped_at TIMESTAMPTZ,
  skip_reason TEXT,

  outcome TEXT CHECK (
    outcome IS NULL OR outcome IN ('passed','failed','requires_followup','asset_retired')
  ),
  outcome_notes TEXT,
  parts_replaced JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pm_tasks_schedule ON pm_tasks(schedule_id);
CREATE INDEX IF NOT EXISTS idx_pm_tasks_asset ON pm_tasks(asset_id);
CREATE INDEX IF NOT EXISTS idx_pm_tasks_status ON pm_tasks(status);
CREATE INDEX IF NOT EXISTS idx_pm_tasks_due_at ON pm_tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_pm_tasks_hospital ON pm_tasks(hospital_id);


-- ============================================================
-- 18. vendor_performance_metrics (Phase 3 daily job)
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  measurement_period_start DATE NOT NULL,
  measurement_period_end DATE NOT NULL,

  total_pos INTEGER NOT NULL DEFAULT 0,
  on_time_deliveries INTEGER NOT NULL DEFAULT 0,
  late_deliveries INTEGER NOT NULL DEFAULT 0,
  on_time_pct NUMERIC(5, 2),

  total_grn_lines INTEGER NOT NULL DEFAULT 0,
  rejected_grn_lines INTEGER NOT NULL DEFAULT 0,
  rejection_rate_pct NUMERIC(5, 2),

  total_three_way_match_variances INTEGER NOT NULL DEFAULT 0,

  payment_disputes_raised INTEGER NOT NULL DEFAULT 0,
  license_compliant BOOLEAN NOT NULL DEFAULT TRUE,

  performance_score NUMERIC(5, 2),
  hospital_rank INTEGER,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vpm_vendor ON vendor_performance_metrics(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vpm_hospital ON vendor_performance_metrics(hospital_id);
CREATE INDEX IF NOT EXISTS idx_vpm_period
  ON vendor_performance_metrics(measurement_period_start, measurement_period_end);
CREATE INDEX IF NOT EXISTS idx_vpm_score ON vendor_performance_metrics(performance_score);


-- ============================================================
-- 19. auto_reorder_drafts (Phase 7)
-- ============================================================
CREATE TABLE IF NOT EXISTS auto_reorder_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,

  current_quantity NUMERIC(12, 3) NOT NULL,
  reorder_level NUMERIC(12, 3) NOT NULL,
  suggested_quantity NUMERIC(12, 3) NOT NULL,
  suggested_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  suggested_unit_cost NUMERIC(12, 2),

  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN (
    'pending_review','approved','modified','rejected','converted_to_pr','converted_to_po'
  )),

  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,

  pr_id UUID REFERENCES purchase_requisitions(id) ON DELETE SET NULL,
  po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,

  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_aro_item ON auto_reorder_drafts(item_id);
CREATE INDEX IF NOT EXISTS idx_aro_inventory ON auto_reorder_drafts(inventory_id);
CREATE INDEX IF NOT EXISTS idx_aro_status ON auto_reorder_drafts(status);
CREATE INDEX IF NOT EXISTS idx_aro_hospital ON auto_reorder_drafts(hospital_id);


-- ============================================================
-- Self-FK + cross-FK ALTERs
-- (Postgres allows forward refs in CREATE TABLE only for tables defined
--  in same statement; for cross-table self-FK we ALTER after create.)
-- ============================================================
ALTER TABLE stock_movements
  ADD CONSTRAINT fk_stock_movements_reverses
  FOREIGN KEY (reverses_movement_id) REFERENCES stock_movements(id) ON DELETE SET NULL;

ALTER TABLE stock_movements
  ADD CONSTRAINT fk_stock_movements_grn
  FOREIGN KEY (grn_id) REFERENCES goods_receipt_notes(id) ON DELETE SET NULL;

ALTER TABLE goods_receipt_notes
  ADD CONSTRAINT fk_goods_receipt_notes_inspection
  FOREIGN KEY (inspection_checklist_id) REFERENCES inspection_checklist_results(id) ON DELETE SET NULL;


-- ============================================================
-- Initial seed: 3 material classifications (KPMG Q9 v1 scope)
-- Network-shared (hospital_id = NULL) so all 4 hospitals reference these.
-- ============================================================
INSERT INTO material_classifications
  (classification, display_name, description,
   approval_lead_time_days, procurement_lead_time_days, reorder_buffer_multiplier,
   maintained_by_roles)
VALUES
  ('standard',
   'Standard',
   'Routine procurement; no fast-track. Standard 30-day payment terms. Default classification.',
   3, 14, 1.00,
   ARRAY['inventory_in_charge']),
  ('emergency',
   'Emergency',
   'Time-sensitive but non-life-threatening. Compressed approval (1 working day). Standard payment terms.',
   1, 3, 1.50,
   ARRAY['inventory_in_charge', 'medical_hod']),
  ('vital',
   'Vital',
   'Patient-safety critical. Maintained by Medical HOD + Store In-charge + Inventory In-charge per hospital. Same-day approval. 2x reorder buffer to prevent stockouts.',
   0, 1, 2.00,
   ARRAY['medical_hod', 'inventory_in_charge', 'store_keeper'])
ON CONFLICT DO NOTHING;


-- ============================================================
-- End of 0060_scm_foundation.sql
--
-- Total: 19 new tables + 3 ALTERs + 3 seed rows. ~140 indexes total
-- (CREATE INDEX statements summed across tables).
--
-- Phase 1.3 follow-up:
--   - apps/web/scripts/backfill-items-from-pharmacy.ts
--     (drug_master → items rows with kind='drug' + external_drug_id link)
-- ============================================================
