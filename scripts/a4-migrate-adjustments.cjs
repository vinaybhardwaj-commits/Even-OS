#!/usr/bin/env node
/**
 * A.4 — Bill Adjustments / Waiver Governance Migration
 * Creates: bill_adjustments, adjustment_config tables + enums
 * Seeds: default tier configuration
 */

const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('A.4 — Bill Adjustments Migration\n');

  // ─── Step 1: Create enums ─────────────────────────────────
  console.log('Step 1: Creating enums...');
  try {
    await sql`CREATE TYPE adjustment_type AS ENUM (
      'waiver', 'discount', 'write_off', 'hardship', 'goodwill', 'rounding'
    )`;
    console.log('  ✓ adjustment_type enum created');
  } catch (e) {
    if (e.message?.includes('already exists')) console.log('  ⊘ adjustment_type enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE adjustment_status AS ENUM (
      'pending', 'approved_tier1', 'approved_tier2', 'approved_tier3',
      'approved_tier4', 'approved_gm', 'rejected', 'revised', 'cancelled'
    )`;
    console.log('  ✓ adjustment_status enum created');
  } catch (e) {
    if (e.message?.includes('already exists')) console.log('  ⊘ adjustment_status enum already exists');
    else throw e;
  }

  // ─── Step 2: Create bill_adjustments table ─────────────────
  console.log('\nStep 2: Creating bill_adjustments table...');
  await sql`
    CREATE TABLE IF NOT EXISTS bill_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

      encounter_id UUID,
      patient_id UUID,
      bill_id UUID,
      billing_account_id UUID,

      adjustment_type adjustment_type NOT NULL,
      adjustment_amount NUMERIC(14,2) NOT NULL,
      original_amount NUMERIC(14,2) NOT NULL,
      adjusted_amount NUMERIC(14,2) NOT NULL,
      discount_percentage NUMERIC(5,2),

      reason TEXT NOT NULL,
      category TEXT,
      justification TEXT,
      supporting_docs JSONB DEFAULT '[]',

      status adjustment_status NOT NULL DEFAULT 'pending',
      current_approver_role TEXT,
      tier_required INTEGER NOT NULL DEFAULT 1,
      approval_chain JSONB NOT NULL DEFAULT '[]',

      rejection_reason TEXT,
      rejected_by UUID REFERENCES users(id) ON DELETE SET NULL,

      version INTEGER NOT NULL DEFAULT 1,
      parent_adjustment_id UUID,

      requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
      resolved_at TIMESTAMP
    )
  `;
  console.log('  ✓ bill_adjustments table created');

  await sql`CREATE INDEX IF NOT EXISTS idx_ba_hospital ON bill_adjustments(hospital_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ba_encounter ON bill_adjustments(encounter_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ba_patient ON bill_adjustments(patient_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ba_bill ON bill_adjustments(bill_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ba_status ON bill_adjustments(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ba_type ON bill_adjustments(adjustment_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ba_approver ON bill_adjustments(current_approver_role)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ba_parent ON bill_adjustments(parent_adjustment_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ba_requested_by ON bill_adjustments(requested_by)`;
  console.log('  ✓ bill_adjustments indexes created');

  // ─── Step 3: Create adjustment_config table ───────────────────
  console.log('\nStep 3: Creating adjustment_config table...');
  await sql`
    CREATE TABLE IF NOT EXISTS adjustment_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      config_key TEXT NOT NULL,
      config_value JSONB NOT NULL,
      description TEXT,
      updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ac_hospital_key ON adjustment_config(hospital_id, config_key)`;
  console.log('  ✓ adjustment_config table created');

  // ─── Step 4: Verify ───────────────────────────────────────
  console.log('\nStep 4: Verifying tables...');
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('bill_adjustments', 'adjustment_config')
    ORDER BY table_name
  `;
  console.log(`  Tables created: ${tables.map(t => t.table_name).join(', ')}`);
  const total = await sql`
    SELECT COUNT(*) as c FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  console.log(`  Total tables in database: ${total[0].c}`);
  console.log('\n✅ Migration complete!\n');

  // ─── Step 5: Seed billing config ──────────────────────────
  console.log('A.4 — Seeding Billing Config\n');

  const admins = await sql`
    SELECT id FROM users WHERE hospital_id = 'EHRC' AND 'super_admin' = ANY(roles) LIMIT 1
  `;
  const adminId = admins[0].id;

  // Tier thresholds
  await sql`
    INSERT INTO adjustment_config (hospital_id, config_key, config_value, description, updated_by)
    VALUES (
      'EHRC',
      'waiver_tier_thresholds',
      ${JSON.stringify({
        tier1: { max_amount: 5000, approver_role: 'billing_exec', auto_approve: true, label: 'Auto-approved (≤₹5K)' },
        tier2: { max_amount: 50000, approver_role: 'billing_manager', auto_approve: false, label: 'Billing Manager (₹5K–₹50K)' },
        tier3: { max_amount: 200000, approver_role: 'accounts_manager', auto_approve: false, label: 'Accounts Manager (₹50K–₹2L)' },
        tier4: { max_amount: null, approver_role: 'gm', auto_approve: false, label: 'GM (>₹2L)' },
      })}::jsonb,
      'Waiver/discount approval tier thresholds. Tier 1 is auto-approved. Amounts in INR.',
      ${adminId}
    )
    ON CONFLICT (hospital_id, config_key) DO UPDATE SET
      config_value = EXCLUDED.config_value,
      updated_at = NOW()
  `;
  console.log('  ✓ waiver_tier_thresholds seeded');

  // Category escalation overrides
  await sql`
    INSERT INTO adjustment_config (hospital_id, config_key, config_value, description, updated_by)
    VALUES (
      'EHRC',
      'waiver_category_overrides',
      ${JSON.stringify({
        hardship: { min_tier: 4, approver_role: 'gm', reason: 'Financial hardship always requires GM approval' },
        write_off: { min_tier: 3, approver_role: 'accounts_manager', reason: 'Write-offs require accounts manager or above' },
      })}::jsonb,
      'Category-based escalation overrides. These override the amount-based tier.',
      ${adminId}
    )
    ON CONFLICT (hospital_id, config_key) DO UPDATE SET
      config_value = EXCLUDED.config_value,
      updated_at = NOW()
  `;
  console.log('  ✓ waiver_category_overrides seeded');

  // Discount limits
  await sql`
    INSERT INTO adjustment_config (hospital_id, config_key, config_value, description, updated_by)
    VALUES (
      'EHRC',
      'discount_limits',
      ${JSON.stringify({
        max_percentage: 25,
        max_flat_amount: 500000,
        require_justification_above: 10000,
      })}::jsonb,
      'Maximum discount limits. Discounts above max_percentage require special approval.',
      ${adminId}
    )
    ON CONFLICT (hospital_id, config_key) DO UPDATE SET
      config_value = EXCLUDED.config_value,
      updated_at = NOW()
  `;
  console.log('  ✓ discount_limits seeded');

  console.log('\n═══════════════════════════════════');
  console.log('Config seed complete! 3 config entries.');
  console.log('═══════════════════════════════════\n');
}

main().catch(err => { console.error(err); process.exit(1); });
