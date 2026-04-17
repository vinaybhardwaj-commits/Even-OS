#!/usr/bin/env node
/**
 * A.2 — Insurer Rules Engine Migration
 * Creates: insurer_rules, rule_applications tables + enums
 * Seeds: sample rules for Star Health (room_rent_cap + proportional_deduction)
 */

const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('A.2 — Insurer Rules Engine Migration\n');

  // ─── Step 1: Create enums ─────────────────────────────────
  console.log('Step 1: Creating enums...');
  try {
    await sql`CREATE TYPE rule_type AS ENUM (
      'room_rent_cap', 'proportional_deduction', 'co_pay', 'item_exclusion',
      'sub_limit', 'package_rate', 'waiting_period', 'disease_cap',
      'network_tier_pricing', 'category_cap'
    )`;
    console.log('  ✓ rule_type enum created');
  } catch (e) {
    if (e.message?.includes('already exists')) console.log('  ⊘ rule_type enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE rule_status AS ENUM ('active', 'draft', 'archived')`;
    console.log('  ✓ rule_status enum created');
  } catch (e) {
    if (e.message?.includes('already exists')) console.log('  ⊘ rule_status enum already exists');
    else throw e;
  }

  // ─── Step 2: Create insurer_rules table ───────────────────
  console.log('\nStep 2: Creating insurer_rules table...');
  await sql`
    CREATE TABLE IF NOT EXISTS insurer_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      insurer_id UUID NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,

      rule_name TEXT NOT NULL,
      rule_type rule_type NOT NULL,
      description TEXT,
      priority INTEGER NOT NULL DEFAULT 100,

      conditions JSONB NOT NULL DEFAULT '{}',
      parameters JSONB NOT NULL DEFAULT '{}',

      version INTEGER NOT NULL DEFAULT 1,
      parent_rule_id UUID,

      status rule_status NOT NULL DEFAULT 'active',
      effective_from TIMESTAMP,
      effective_to TIMESTAMP,

      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;
  console.log('  ✓ insurer_rules table created');

  await sql`CREATE INDEX IF NOT EXISTS idx_ir_hospital ON insurer_rules(hospital_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ir_insurer ON insurer_rules(insurer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ir_type ON insurer_rules(rule_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ir_status ON insurer_rules(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ir_priority ON insurer_rules(insurer_id, priority)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ir_parent ON insurer_rules(parent_rule_id)`;
  console.log('  ✓ insurer_rules indexes created');

  // ─── Step 3: Create rule_applications table ───────────────
  console.log('\nStep 3: Creating rule_applications table...');
  await sql`
    CREATE TABLE IF NOT EXISTS rule_applications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

      rule_id UUID NOT NULL REFERENCES insurer_rules(id) ON DELETE RESTRICT,
      insurer_id UUID NOT NULL REFERENCES insurers(id) ON DELETE RESTRICT,
      encounter_id UUID,
      patient_id UUID,
      bill_id UUID,

      original_amount NUMERIC(14,2) NOT NULL,
      adjusted_amount NUMERIC(14,2) NOT NULL,
      deduction_amount NUMERIC(14,2) NOT NULL,

      explanation TEXT NOT NULL,
      evaluation_context JSONB DEFAULT '{}',

      is_simulation BOOLEAN NOT NULL DEFAULT false,

      applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
      applied_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `;
  console.log('  ✓ rule_applications table created');

  await sql`CREATE INDEX IF NOT EXISTS idx_ra_hospital ON rule_applications(hospital_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ra_rule ON rule_applications(rule_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ra_insurer ON rule_applications(insurer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ra_encounter ON rule_applications(encounter_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ra_patient ON rule_applications(patient_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ra_bill ON rule_applications(bill_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ra_simulation ON rule_applications(is_simulation)`;
  console.log('  ✓ rule_applications indexes created');

  // ─── Step 4: Verify ───────────────────────────────────────
  console.log('\nStep 4: Verifying tables...');
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('insurer_rules', 'rule_applications')
    ORDER BY table_name
  `;
  console.log(`  Tables created: ${tables.map(t => t.table_name).join(', ')}`);
  const total = await sql`
    SELECT COUNT(*) as c FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  console.log(`  Total tables in database: ${total[0].c}`);
  console.log('\n✅ Migration complete!\n');

  // ─── Step 5: Seed sample rules ────────────────────────────
  console.log('A.2 — Seeding Sample Rules\n');

  // Get admin user
  const admins = await sql`
    SELECT id FROM users
    WHERE hospital_id = 'EHRC' AND 'super_admin' = ANY(roles)
    LIMIT 1
  `;
  if (admins.length === 0) {
    console.error('No admin user found for EHRC');
    process.exit(1);
  }
  const adminId = admins[0].id;
  console.log(`Using admin: ${adminId}\n`);

  // Get insurer IDs
  const starHealth = await sql`SELECT id FROM insurers WHERE insurer_code = 'STAR_HEALTH' AND hospital_id = 'EHRC' LIMIT 1`;
  const nivaBupa = await sql`SELECT id FROM insurers WHERE insurer_code = 'NIVA_BUPA' AND hospital_id = 'EHRC' LIMIT 1`;
  const hdfc = await sql`SELECT id FROM insurers WHERE insurer_code = 'HDFC_ERGO' AND hospital_id = 'EHRC' LIMIT 1`;
  const icici = await sql`SELECT id FROM insurers WHERE insurer_code = 'ICICI_LOMBARD' AND hospital_id = 'EHRC' LIMIT 1`;
  const newIndia = await sql`SELECT id FROM insurers WHERE insurer_code = 'NEW_INDIA' AND hospital_id = 'EHRC' LIMIT 1`;
  const cghs = await sql`SELECT id FROM insurers WHERE insurer_code = 'CGHS' AND hospital_id = 'EHRC' LIMIT 1`;
  const careHealth = await sql`SELECT id FROM insurers WHERE insurer_code = 'CARE_HEALTH' AND hospital_id = 'EHRC' LIMIT 1`;
  const bajaj = await sql`SELECT id FROM insurers WHERE insurer_code = 'BAJAJ_ALLIANZ' AND hospital_id = 'EHRC' LIMIT 1`;

  const rules = [
    // Star Health — room rent cap + proportional deduction
    {
      insurer_id: starHealth[0]?.id,
      rule_name: 'Star Health — Room Rent Cap (Single AC)',
      rule_type: 'room_rent_cap',
      description: 'Maximum room rent ₹5,000/day for single AC room',
      priority: 10,
      conditions: { room_type: ['single_ac', 'single_non_ac'] },
      parameters: { max_per_day: 5000, cap_type: 'absolute' },
    },
    {
      insurer_id: starHealth[0]?.id,
      rule_name: 'Star Health — Proportional Deduction',
      rule_type: 'proportional_deduction',
      description: 'When room rent exceeds cap, proportionally deduct all charges',
      priority: 20,
      conditions: { triggered_by: 'room_rent_cap' },
      parameters: { eligible_amount: 5000, apply_to: 'all' },
    },
    {
      insurer_id: starHealth[0]?.id,
      rule_name: 'Star Health — 10% Co-Pay',
      rule_type: 'co_pay',
      description: '10% co-payment on all claims',
      priority: 50,
      conditions: {},
      parameters: { percentage: 10, apply_to: 'all' },
    },
    // Niva Bupa — room rent cap + sub-limit
    {
      insurer_id: nivaBupa[0]?.id,
      rule_name: 'Niva Bupa — Room Rent Cap (Deluxe)',
      rule_type: 'room_rent_cap',
      description: 'Maximum room rent ₹8,000/day for deluxe rooms',
      priority: 10,
      conditions: { room_type: ['deluxe', 'suite'] },
      parameters: { max_per_day: 8000, cap_type: 'absolute' },
    },
    {
      insurer_id: nivaBupa[0]?.id,
      rule_name: 'Niva Bupa — Diagnostics Sub-Limit',
      rule_type: 'sub_limit',
      description: 'Max ₹50,000 for diagnostic tests',
      priority: 30,
      conditions: {},
      parameters: { category: 'diagnostics', max_amount: 50000 },
    },
    // HDFC ERGO — co-pay + item exclusion
    {
      insurer_id: hdfc[0]?.id,
      rule_name: 'HDFC ERGO — 20% Co-Pay (Non-Network)',
      rule_type: 'co_pay',
      description: '20% co-payment for non-network hospitals',
      priority: 10,
      conditions: { network_tier: 'non_network' },
      parameters: { percentage: 20, apply_to: 'all' },
    },
    {
      insurer_id: hdfc[0]?.id,
      rule_name: 'HDFC ERGO — Cosmetic Exclusion',
      rule_type: 'item_exclusion',
      description: 'Exclude cosmetic and dental procedures',
      priority: 5,
      conditions: {},
      parameters: { excluded_categories: ['cosmetic', 'dental'], reason: 'Not covered under standard policy' },
    },
    // ICICI Lombard — package rate + disease cap
    {
      insurer_id: icici[0]?.id,
      rule_name: 'ICICI — Knee Replacement Package',
      rule_type: 'package_rate',
      description: 'Fixed ₹2.5L package for knee replacement',
      priority: 10,
      conditions: { procedure_code: 'KNEE_REPL' },
      parameters: { procedure_code: 'KNEE_REPL', package_amount: 250000 },
    },
    {
      insurer_id: icici[0]?.id,
      rule_name: 'ICICI — Cardiac Disease Cap',
      rule_type: 'disease_cap',
      description: 'Max ₹5L coverage for cardiac conditions',
      priority: 20,
      conditions: {},
      parameters: { disease_code: 'CARDIAC', max_amount: 500000 },
    },
    // New India — waiting period + category cap
    {
      insurer_id: newIndia[0]?.id,
      rule_name: 'New India — Diabetes Waiting Period',
      rule_type: 'waiting_period',
      description: 'Pre-existing diabetes has 365-day waiting period',
      priority: 5,
      conditions: {},
      parameters: { disease_code: 'DM2', days: 365 },
    },
    {
      insurer_id: newIndia[0]?.id,
      rule_name: 'New India — Pharmacy Cap',
      rule_type: 'category_cap',
      description: 'Max ₹1L for pharmacy charges',
      priority: 30,
      conditions: {},
      parameters: { category: 'pharmacy', max_amount: 100000 },
    },
    // CGHS — network tier pricing
    {
      insurer_id: cghs[0]?.id,
      rule_name: 'CGHS — Tier-Based Pricing',
      rule_type: 'network_tier_pricing',
      description: 'CGHS rates based on hospital empanelment tier',
      priority: 10,
      conditions: {},
      parameters: { preferred: 1.0, standard: 0.85, non_network: 0.0 },
    },
    // Care Health — room rent cap
    {
      insurer_id: careHealth[0]?.id,
      rule_name: 'Care Health — Room Rent Cap (1% SI)',
      rule_type: 'room_rent_cap',
      description: 'Room rent capped at 1% of sum insured per day',
      priority: 10,
      conditions: {},
      parameters: { percentage_of_si: 1, cap_type: 'percentage_si' },
    },
    // Bajaj — co-pay + sub-limit
    {
      insurer_id: bajaj[0]?.id,
      rule_name: 'Bajaj Allianz — 15% Co-Pay (Senior)',
      rule_type: 'co_pay',
      description: '15% co-pay for age 60+ patients',
      priority: 10,
      conditions: { patient_age_gte: 60 },
      parameters: { percentage: 15, apply_to: 'all' },
    },
    {
      insurer_id: bajaj[0]?.id,
      rule_name: 'Bajaj — ICU Sub-Limit',
      rule_type: 'sub_limit',
      description: 'ICU charges capped at ₹2L',
      priority: 20,
      conditions: {},
      parameters: { category: 'icu', max_amount: 200000 },
    },
  ];

  let seeded = 0;
  for (const rule of rules) {
    if (!rule.insurer_id) {
      console.log(`  ⊘ Skipped: ${rule.rule_name} (insurer not found)`);
      continue;
    }
    try {
      await sql`
        INSERT INTO insurer_rules (
          hospital_id, insurer_id, rule_name, rule_type, description,
          priority, conditions, parameters, status, created_by
        ) VALUES (
          'EHRC', ${rule.insurer_id}, ${rule.rule_name}, ${rule.rule_type},
          ${rule.description}, ${rule.priority},
          ${JSON.stringify(rule.conditions)}::jsonb, ${JSON.stringify(rule.parameters)}::jsonb,
          'active', ${adminId}
        )
      `;
      console.log(`  ✓ Rule: ${rule.rule_name}`);
      seeded++;
    } catch (e) {
      console.log(`  ✗ Failed: ${rule.rule_name} — ${e.message}`);
    }
  }

  console.log(`\n═══════════════════════════════════`);
  console.log(`Seed complete! ${seeded} rules created.`);
  console.log(`═══════════════════════════════════\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
