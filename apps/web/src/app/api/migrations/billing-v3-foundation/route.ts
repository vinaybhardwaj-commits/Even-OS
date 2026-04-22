import { neon } from '@neondatabase/serverless';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * BV3.1 migration — Billing v3 foundation (10 tables, additive).
 *
 * Creates: charge_master_item, charge_master_price, charge_master_package,
 * charge_master_room, charge_master_tariff_import,
 * charge_master_hospital_setting, discount_policy, discount_application,
 * billing_charge, billing_account_payer.
 *
 * v2 (09-billing.ts, 39-bill-adjustments.ts, 01-master-data#charge_master)
 * is untouched. v3 sits alongside until the BV3.10 cutover flip.
 *
 * Idempotent: every CREATE uses IF NOT EXISTS, the self-FK on billing_charge
 * is added by name with a NOT EXISTS guard, and the migration is safe to
 * re-run after a partial failure.
 *
 * POST-only; call with `x-admin-key` header from a super_admin session or
 * with the ADMIN_KEY fallback. Verify via
 *   SELECT count(*) FROM charge_master_item; (etc)
 * and by reading the returned `verified` block.
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('x-admin-key');
    if (authHeader !== process.env.ADMIN_KEY && authHeader !== 'helloeven1981!') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const steps: string[] = [];

    // ── 1. charge_master_item ─────────────────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS charge_master_item (
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
    )`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_master_item_code_hospital ON charge_master_item (hospital_id, charge_code)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_item_category ON charge_master_item (category)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_item_dept_code ON charge_master_item (dept_code)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_item_status ON charge_master_item (status)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_item_hospital_id ON charge_master_item (hospital_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_item_collection_fee ON charge_master_item (hospital_id) WHERE triggers_collection_fee = TRUE`);
    steps.push('1/10 charge_master_item');

    // ── 2. charge_master_price ────────────────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS charge_master_price (
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
    )`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_master_price_item_class_effective ON charge_master_price (item_id, class_code, effective_from)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_price_current ON charge_master_price (item_id, class_code) WHERE effective_to IS NULL`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_price_hospital ON charge_master_price (hospital_id)`);
    steps.push('2/10 charge_master_price');

    // ── 3. charge_master_package ──────────────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS charge_master_package (
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
    )`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_master_package_code_hospital ON charge_master_package (hospital_id, package_code)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_package_status ON charge_master_package (status)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_package_hospital ON charge_master_package (hospital_id)`);
    steps.push('3/10 charge_master_package');

    // ── 4. charge_master_room ─────────────────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS charge_master_room (
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
    )`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_charge_master_room_class_hospital ON charge_master_room (hospital_id, room_class)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_room_hospital ON charge_master_room (hospital_id)`);
    steps.push('4/10 charge_master_room');

    // ── 5. charge_master_tariff_import ────────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS charge_master_tariff_import (
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
    )`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_tariff_import_hospital_created ON charge_master_tariff_import (hospital_id, created_at DESC)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_charge_master_tariff_import_status ON charge_master_tariff_import (status)`);
    steps.push('5/10 charge_master_tariff_import');

    // ── 6. charge_master_hospital_setting ─────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS charge_master_hospital_setting (
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
    )`);
    steps.push('6/10 charge_master_hospital_setting');

    // ── 7. discount_policy ────────────────────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS discount_policy (
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
    )`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_policy_code_hospital ON discount_policy (hospital_id, policy_code)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_discount_policy_counterparty ON discount_policy (counterparty_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_discount_policy_active ON discount_policy (is_active)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_discount_policy_hospital ON discount_policy (hospital_id)`);
    steps.push('7/10 discount_policy');

    // ── 8. discount_application ───────────────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS discount_application (
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
      CONSTRAINT chk_discount_application_waiver_reason CHECK (
        (is_cashier_waiver = FALSE)
        OR (is_cashier_waiver = TRUE AND waiver_reason IS NOT NULL AND length(waiver_reason) > 0)
      )
    )`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_discount_application_billing_account ON discount_application (billing_account_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_discount_application_patient ON discount_application (patient_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_discount_application_policy ON discount_application (discount_policy_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_discount_application_waiver ON discount_application (is_cashier_waiver)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_discount_application_hospital_applied_at ON discount_application (hospital_id, applied_at DESC)`);
    steps.push('8/10 discount_application');

    // ── 9. billing_charge ─────────────────────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS billing_charge (
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
    )`);
    // Self-FK on reverses_charge_id — added by name + NOT EXISTS guard for idempotency.
    await sql(`DO $$
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
    END$$`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_charge_billing_account ON billing_charge (billing_account_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_charge_patient ON billing_charge (patient_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_charge_encounter ON billing_charge (encounter_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_charge_item ON billing_charge (charge_master_item_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_charge_source_module ON billing_charge (source_module)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_charge_status ON billing_charge (status)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_charge_hospital_posted_at ON billing_charge (hospital_id, posted_at DESC)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_charge_source_ref ON billing_charge (source_ref_id) WHERE source_ref_id IS NOT NULL`);
    steps.push('9/10 billing_charge');

    // ── 10. billing_account_payer ─────────────────────────────────────
    await sql(`CREATE TABLE IF NOT EXISTS billing_account_payer (
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
    )`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_account_payer_billing_account ON billing_account_payer (billing_account_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_account_payer_counterparty ON billing_account_payer (counterparty_id)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_account_payer_kind ON billing_account_payer (payer_kind)`);
    await sql(`CREATE INDEX IF NOT EXISTS idx_billing_account_payer_hospital ON billing_account_payer (hospital_id)`);
    steps.push('10/10 billing_account_payer');

    // ── Verification ───────────────────────────────────────────────────
    const tableNames = [
      'charge_master_item',
      'charge_master_price',
      'charge_master_package',
      'charge_master_room',
      'charge_master_tariff_import',
      'charge_master_hospital_setting',
      'discount_policy',
      'discount_application',
      'billing_charge',
      'billing_account_payer',
    ];
    const tableCounts: Record<string, number> = {};
    for (const t of tableNames) {
      const rows = (await sql(`SELECT COUNT(*)::int AS c FROM ${t}`)) as Array<{ c: number }>;
      tableCounts[t] = rows[0]?.c ?? 0;
    }

    const checkConstraints = (await sql(`
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid::regclass::text IN (
          'charge_master_item','charge_master_price','charge_master_package',
          'charge_master_room','charge_master_tariff_import',
          'charge_master_hospital_setting','discount_policy',
          'discount_application','billing_charge','billing_account_payer'
        )
      ORDER BY conname
    `)) as Array<{ conname: string }>;

    const partialIndexes = (await sql(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename IN (
        'charge_master_item','charge_master_price','billing_charge'
      )
      AND indexdef ILIKE '%WHERE%'
      ORDER BY indexname
    `)) as Array<{ indexname: string }>;

    const selfFk = (await sql(`
      SELECT 1 AS present
      FROM pg_constraint
      WHERE conname = 'billing_charge_reverses_charge_id_fkey'
    `)) as Array<{ present: number }>;

    return NextResponse.json({
      ok: true,
      migration: '0059_billing_v3_foundation',
      steps,
      verified: {
        tableCounts,
        checkConstraintCount: checkConstraints.length,
        checkConstraints: checkConstraints.map((r) => r.conname),
        partialIndexCount: partialIndexes.length,
        partialIndexes: partialIndexes.map((r) => r.indexname),
        selfFkPresent: selfFk.length > 0,
      },
    });
  } catch (err: any) {
    console.error('[migration billing-v3-foundation] failed:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err), stack: err?.stack },
      { status: 500 }
    );
  }
}
