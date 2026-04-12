#!/usr/bin/env node
/**
 * Migrate Rounds users → Even OS shared users table
 *
 * What this does:
 * 1. Reads all active users from Rounds DB (profiles table)
 * 2. Maps Rounds roles → Even OS roles array
 * 3. Maps Rounds department_id → department name string
 * 4. Preserves bcrypt password hashes (PIN hashes, compatible with bcrypt.compare)
 * 5. Inserts into Even OS users table with hospital_id = EHRC
 * 6. Flags users with must_change_password = true
 * 7. Skips test users (v.b@even.in)
 */

import { neon } from '@neondatabase/serverless';

// ─── Connection strings ──────────────────────────────────────
const ROUNDS_DB = 'postgresql://neondb_owner:npg_mzGKw9YC8OZI@ep-super-wind-an2rwooh-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require';
const EVEN_OS_DB = 'postgresql://neondb_owner:npg_qarlg8EbTX7D@ep-flat-violet-a1jl3kpp-pooler.ap-southeast-1.aws.neon.tech/even_os?sslmode=require';

const roundsSql = neon(ROUNDS_DB);
const evenOsSql = neon(EVEN_OS_DB);

// ─── Role mapping: Rounds role → Even OS roles array ─────────
const ROLE_MAP = {
  'super_admin':          ['super_admin'],
  'department_head':      ['department_head'],
  'unit_head':            ['department_head'],          // closest equivalent
  'medical_administrator':['medical_director'],         // MD-level admin
  'administrator':        ['hospital_admin'],           // general admin
  'operations_manager':   ['operations_manager'],
  'staff':                ['staff'],                    // generic, will be extended per designation
  'nurse':                ['nurse'],
  'billing_executive':    ['billing_executive'],
  'insurance_coordinator':['insurance_coordinator'],
  'pharmacist':           ['pharmacist'],
  'physiotherapist':      ['staff'],                    // no direct match, keep as staff
  'marketing_executive':  ['staff'],                    // marketing → staff for now
  'clinical_care':        ['senior_resident'],          // clinical staff
  'pac_coordinator':      ['staff'],
  'ip_coordinator':       ['staff'],
  'anesthesiologist':     ['specialist_neurologist'],    // placeholder — will extend roles
  'ot_coordinator':       ['staff'],
  'marketing':            ['staff'],
  'guest':                ['staff'],
};

// ─── Department ID → name mapping (from Rounds) ─────────────
const DEPT_MAP = {
  '1a7b4bb4-07a1-4212-898b-1254ba96318d': 'Administration',
  'dd78c248-47b6-474e-8f49-8bb62c7efea0': 'Billing',
  'e5d6a09b-9ecf-47aa-8063-9c2cdfc330ef': 'Biomedical',
  'c0e86873-d57a-4b3f-ba81-e5d19d175b68': 'Clinical Lab',
  '5e1383d5-2c48-4e0b-9e1c-64049c4b46e7': 'Customer Care',
  'ea2f2092-3e3e-4721-bb49-e4fa39e4f9db': 'Diet',
  '025c8012-0e44-4333-a4e5-4ed8d8aadc8e': 'Emergency',
  'de42868d-87bb-4896-ba77-e4fc5a2d6ed7': 'Facility',
  '497a6246-47ae-4429-8f8b-501e9ada1717': 'Finance',
  'a279d0ce-9f7d-41ab-b8b8-44b90b935610': 'HR & Manpower',
  '74eca835-9787-459a-a336-b1072b24a1db': 'IT',
  '4064e09e-4b67-4cf5-bb3f-ef5c8d0f3e94': 'Marketing',
  'c7b04aab-b36e-43e5-a31d-0b9bc35df139': 'Nursing',
  'fe467e31-11be-453b-ba51-fed4e2c8ebe8': 'OT',
  '17b544d6-2bba-4095-a5f9-250d6261ba4f': 'Patient Safety',
  'c9818bfa-dc5b-40af-a577-b78430fc682a': 'Pharmacy',
  'cd2e0a6b-5391-4ccd-bfaf-1adb47093548': 'Radiology',
  '0adac358-c83c-4c90-807d-b0d7570a5e4e': 'Supply Chain',
  '7b863461-7145-45cc-ac09-ff33c2daedaf': 'Training',
};

// Emails to skip (test accounts)
const SKIP_EMAILS = ['v.b@even.in'];

async function migrate() {
  console.log('🔄 Starting Rounds → Even OS user migration...\n');

  // 1. Get EHRC hospital UUID from Even OS
  const hospitals = await evenOsSql('SELECT id FROM hospitals WHERE hospital_id = $1', ['EVEN-RACE-COURSE']);
  if (hospitals.length === 0) {
    throw new Error('EHRC hospital not found in Even OS. Run seed first.');
  }
  const ehrcId = hospitals[0].id;
  console.log(`✅ EHRC hospital ID: ${ehrcId}`);

  // 2. Get all active Rounds users with password hashes
  const roundsUsers = await roundsSql(`
    SELECT id, email, full_name, display_name, role, department_id,
           designation, phone, password_hash, status, account_type,
           created_at, last_login_at
    FROM profiles
    WHERE status = 'active'
    ORDER BY created_at
  `);
  console.log(`📋 Found ${roundsUsers.length} active Rounds users\n`);

  // 3. Check existing Even OS users to avoid duplicates
  const existingEmails = await evenOsSql('SELECT email FROM users WHERE hospital_id = $1', [ehrcId]);
  const existingSet = new Set(existingEmails.map(e => e.email));
  console.log(`📌 ${existingSet.size} users already exist in Even OS\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of roundsUsers) {
    // Skip test users
    if (SKIP_EMAILS.includes(user.email)) {
      console.log(`⏭️  Skipping test user: ${user.email}`);
      skipped++;
      continue;
    }

    // Skip if already exists
    if (existingSet.has(user.email)) {
      console.log(`⏭️  Already exists: ${user.email}`);
      skipped++;
      continue;
    }

    // Map role
    const roles = ROLE_MAP[user.role] || ['staff'];

    // Map department
    const department = DEPT_MAP[user.department_id] || 'General';

    try {
      await evenOsSql(`
        INSERT INTO users (
          hospital_id, email, password_hash, full_name, department,
          roles, status, must_change_password, login_count,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, 'active', $7, 0,
          $8, NOW()
        )
      `, [
        ehrcId,
        user.email,
        user.password_hash,                        // bcrypt hash passes through directly
        user.full_name,
        department,
        `{${roles.join(',')}}`,                    // PostgreSQL text[] literal
        user.password_hash ? true : true,          // must_change_password = true for all (PIN → password migration)
        user.created_at,
      ]);

      console.log(`✅ Migrated: ${user.email} (${user.role} → [${roles.join(', ')}]) — ${department}`);
      migrated++;
    } catch (err) {
      console.error(`❌ Failed: ${user.email} — ${err.message}`);
      errors++;
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Migration complete!`);
  console.log(`  ✅ Migrated: ${migrated}`);
  console.log(`  ⏭️  Skipped:  ${skipped}`);
  console.log(`  ❌ Errors:   ${errors}`);
  console.log(`${'═'.repeat(60)}`);

  // 4. Verify
  const total = await evenOsSql('SELECT COUNT(*) as cnt FROM users WHERE hospital_id = $1', [ehrcId]);
  console.log(`\n📊 Total Even OS EHRC users now: ${total[0].cnt}`);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
