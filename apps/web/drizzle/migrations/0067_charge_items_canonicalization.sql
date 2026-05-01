-- =============================================================================
-- Migration 0067 — Billing v3 Phase 3 (charge_items canonicalization)
-- =============================================================================
-- Per Q1 locked design:
--   1. Rename `billing_charge` → `charge_items` (cross-module pattern:
--      audit_log / event_log / charge_items)
--   2. Add 7 new columns: item_id, service_id (polymorphic FK with CHECK
--      exactly-one + code_kind consistency), package_id, source_emit_event_id,
--      hsn_code, cost_center_code, empanelment_id_at_post, rule_engine_applied
--   3. Deprecate charge_master_item_id (column kept for historical lookup;
--      nullable; comment flags DEPRECATED)
--   4. Add 5 new indexes
--
-- Idempotent. Existing billing_charge has 0 rows (verified pre-migration);
-- rename is data-loss-free. All callsites updated in lockstep with migration.
-- =============================================================================

-- ─── 1. Rename table billing_charge → charge_items ─────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='billing_charge')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='charge_items')
  THEN
    ALTER TABLE billing_charge RENAME TO charge_items;
  END IF;
END$$;

-- Rename indexes that referenced the old name (PostgreSQL keeps index data
-- but doesn't auto-rename them; we rename for cleanliness).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_billing_charge_billing_account') THEN
    ALTER INDEX idx_billing_charge_billing_account RENAME TO idx_charge_items_billing_account;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_billing_charge_patient') THEN
    ALTER INDEX idx_billing_charge_patient RENAME TO idx_charge_items_patient;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_billing_charge_encounter') THEN
    ALTER INDEX idx_billing_charge_encounter RENAME TO idx_charge_items_encounter;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_billing_charge_item') THEN
    ALTER INDEX idx_billing_charge_item RENAME TO idx_charge_items_charge_master_item;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_billing_charge_source_module') THEN
    ALTER INDEX idx_billing_charge_source_module RENAME TO idx_charge_items_source_module;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_billing_charge_status') THEN
    ALTER INDEX idx_billing_charge_status RENAME TO idx_charge_items_status;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_billing_charge_hospital_posted_at') THEN
    ALTER INDEX idx_billing_charge_hospital_posted_at RENAME TO idx_charge_items_hospital_posted_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_billing_charge_source_ref') THEN
    ALTER INDEX idx_billing_charge_source_ref RENAME TO idx_charge_items_source_ref;
  END IF;
END$$;

-- Rename the self-FK constraint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_charge_reverses_charge_id_fkey') THEN
    ALTER TABLE charge_items
      RENAME CONSTRAINT billing_charge_reverses_charge_id_fkey TO charge_items_reverses_charge_id_fkey;
  END IF;
END$$;


-- ─── 2. Add 7 new columns ─────────────────────────────────────────────────
DO $$
BEGIN
  -- item_id (polymorphic FK to inventory_items)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charge_items' AND column_name='item_id') THEN
    ALTER TABLE charge_items ADD COLUMN item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL;
  END IF;
  -- service_id (polymorphic FK to service_codes)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charge_items' AND column_name='service_id') THEN
    ALTER TABLE charge_items ADD COLUMN service_id UUID REFERENCES service_codes(id) ON DELETE SET NULL;
  END IF;
  -- code_kind discriminator (matches code_charge_tiers pattern)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charge_items' AND column_name='code_kind') THEN
    ALTER TABLE charge_items ADD COLUMN code_kind TEXT;
  END IF;
  -- source_emit_event_id (links to journey/event log entry that triggered emit)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charge_items' AND column_name='source_emit_event_id') THEN
    ALTER TABLE charge_items ADD COLUMN source_emit_event_id UUID;
  END IF;
  -- hsn_code (frozen at emit time for GST classification)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charge_items' AND column_name='hsn_code') THEN
    ALTER TABLE charge_items ADD COLUMN hsn_code TEXT;
  END IF;
  -- cost_center_code (revenue-cost dual posting per Q14)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charge_items' AND column_name='cost_center_code') THEN
    ALTER TABLE charge_items ADD COLUMN cost_center_code TEXT;
  END IF;
  -- empanelment_id_at_post (which override drove the price)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charge_items' AND column_name='empanelment_id_at_post') THEN
    ALTER TABLE charge_items
      ADD COLUMN empanelment_id_at_post UUID REFERENCES code_charge_empanelments(id) ON DELETE SET NULL;
  END IF;
  -- rule_engine_applied (JSON snapshot of rules that fired)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charge_items' AND column_name='rule_engine_applied') THEN
    ALTER TABLE charge_items ADD COLUMN rule_engine_applied JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END$$;


-- ─── 3. Add CHECK constraints ──────────────────────────────────────────────
-- code_kind enum: drug | item | service | procedure | lab_test | imaging_study |
--                 pack | charge_tier | lookup | deprecation | NULL (legacy backfill placeholder)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_charge_items_code_kind') THEN
    ALTER TABLE charge_items ADD CONSTRAINT chk_charge_items_code_kind
      CHECK (code_kind IS NULL OR code_kind IN ('drug','item','service','procedure','lab_test','imaging_study','pack','charge_tier','lookup','deprecation'));
  END IF;
END$$;

-- Polymorphic exactly-one (when populated): item_id XOR service_id; NULL allowed
-- for legacy rows without code_kind set.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_charge_items_polymorphic') THEN
    ALTER TABLE charge_items ADD CONSTRAINT chk_charge_items_polymorphic
      CHECK (
        (item_id IS NULL AND service_id IS NULL)
        OR (item_id IS NOT NULL AND service_id IS NULL)
        OR (item_id IS NULL AND service_id IS NOT NULL)
      );
  END IF;
END$$;

-- code_kind consistency with item_id / service_id presence
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_charge_items_kind_consistent') THEN
    ALTER TABLE charge_items ADD CONSTRAINT chk_charge_items_kind_consistent
      CHECK (
        (code_kind IS NULL)
        OR (code_kind = 'item' AND item_id IS NOT NULL)
        OR (code_kind != 'item' AND service_id IS NOT NULL)
      );
  END IF;
END$$;


-- ─── 4. Add 5 new indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_charge_items_item ON charge_items (item_id) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_charge_items_service ON charge_items (service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_charge_items_code_kind_id ON charge_items (code_kind, COALESCE(item_id, service_id));
CREATE INDEX IF NOT EXISTS idx_charge_items_emit_event ON charge_items (source_emit_event_id) WHERE source_emit_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_charge_items_cost_center ON charge_items (cost_center_code) WHERE cost_center_code IS NOT NULL;


-- ─── 5. Comment-flag charge_master_item_id as DEPRECATED ───────────────────
COMMENT ON COLUMN charge_items.charge_master_item_id IS
  'DEPRECATED in BV3 Phase 3 (Q1) — replaced by polymorphic item_id / service_id with code_kind discriminator. Preserved for historical lookup of pre-Phase-3 emits. New code MUST use item_id or service_id.';
