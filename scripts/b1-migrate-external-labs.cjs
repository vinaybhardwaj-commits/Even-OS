/**
 * B.1 — External Lab Master Migration + Seed
 * Creates external_labs, external_lab_pricing, external_lab_orders tables.
 * Seeds 6 realistic Indian diagnostic labs with pricing for 10 common tests.
 *
 * Run: NODE_PATH=apps/web/node_modules DATABASE_URL="..." node scripts/b1-migrate-external-labs.cjs
 */

const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log('B.1 — External Lab Master Migration\n');

  // ── Step 1: Create enums ──────────────────────────────────────────
  console.log('Step 1: Creating enums...');
  try {
    await sql`CREATE TYPE contract_type AS ENUM ('monthly', 'per_test', 'annual', 'panel_rate')`;
    console.log('  ✓ contract_type enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ contract_type enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE dispatch_method AS ENUM ('courier', 'pickup', 'digital')`;
    console.log('  ✓ dispatch_method enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ dispatch_method enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE external_lab_order_status AS ENUM ('pending_dispatch', 'dispatched', 'received_by_lab', 'processing', 'results_received', 'results_entered', 'verified', 'cancelled', 'rejected')`;
    console.log('  ✓ external_lab_order_status enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ external_lab_order_status enum already exists');
    else throw e;
  }

  // ── Step 2: Create external_labs table ────────────────────────────
  console.log('\nStep 2: Creating external_labs table...');
  await sql`
    CREATE TABLE IF NOT EXISTS external_labs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      lab_name TEXT NOT NULL,
      lab_code VARCHAR(20),
      address TEXT,
      city VARCHAR(50),
      state VARCHAR(50),
      pincode VARCHAR(10),
      contact_person TEXT,
      contact_phone VARCHAR(20),
      contact_email TEXT,
      nabl_accredited BOOLEAN NOT NULL DEFAULT false,
      nabl_certificate_number VARCHAR(50),
      nabl_valid_until DATE,
      cap_accredited BOOLEAN NOT NULL DEFAULT false,
      contract_type contract_type,
      contract_start DATE,
      contract_end DATE,
      default_tat_hours INTEGER NOT NULL DEFAULT 48,
      payment_terms TEXT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ external_labs table created');

  await sql`CREATE INDEX IF NOT EXISTS idx_el_hospital ON external_labs(hospital_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_el_lab_code ON external_labs(lab_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_el_is_active ON external_labs(is_active)`;
  console.log('  ✓ external_labs indexes created');

  // ── Step 3: Create external_lab_pricing table ────────────────────
  console.log('\nStep 3: Creating external_lab_pricing table...');
  await sql`
    CREATE TABLE IF NOT EXISTS external_lab_pricing (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      external_lab_id UUID NOT NULL REFERENCES external_labs(id) ON DELETE CASCADE,
      panel_id UUID REFERENCES lab_panels(id) ON DELETE RESTRICT,
      test_code VARCHAR(50) NOT NULL,
      test_name TEXT NOT NULL,
      cost_price NUMERIC(12, 2) NOT NULL,
      patient_price NUMERIC(12, 2) NOT NULL,
      is_preferred BOOLEAN NOT NULL DEFAULT false,
      tat_hours INTEGER,
      effective_from DATE,
      effective_to DATE,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ external_lab_pricing table created');

  await sql`CREATE INDEX IF NOT EXISTS idx_elp_hospital ON external_lab_pricing(hospital_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_elp_lab ON external_lab_pricing(external_lab_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_elp_panel ON external_lab_pricing(panel_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_elp_is_active ON external_lab_pricing(is_active)`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_elp_unique_lab_panel
    ON external_lab_pricing(hospital_id, external_lab_id, panel_id)
    WHERE panel_id IS NOT NULL
  `;
  console.log('  ✓ external_lab_pricing indexes created');

  // ── Step 4: Create external_lab_orders table ─────────────────────
  console.log('\nStep 4: Creating external_lab_orders table...');
  await sql`
    CREATE TABLE IF NOT EXISTS external_lab_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      lab_order_id UUID NOT NULL REFERENCES lab_orders(id) ON DELETE RESTRICT,
      external_lab_id UUID NOT NULL REFERENCES external_labs(id) ON DELETE RESTRICT,
      external_lab_pricing_id UUID REFERENCES external_lab_pricing(id) ON DELETE SET NULL,
      patient_id UUID NOT NULL,
      encounter_id UUID,
      status external_lab_order_status NOT NULL DEFAULT 'pending_dispatch',
      dispatch_date TIMESTAMPTZ,
      dispatch_method dispatch_method,
      dispatch_tracking VARCHAR(100),
      dispatched_by UUID REFERENCES users(id) ON DELETE SET NULL,
      received_at TIMESTAMPTZ,
      processing_at TIMESTAMPTZ,
      results_received_at TIMESTAMPTZ,
      results_entered_at TIMESTAMPTZ,
      results_entered_by UUID REFERENCES users(id) ON DELETE SET NULL,
      verified_at TIMESTAMPTZ,
      verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
      tat_promised_hours INTEGER,
      tat_actual_hours NUMERIC(8, 2),
      tat_breach BOOLEAN NOT NULL DEFAULT false,
      cost_amount NUMERIC(12, 2),
      billing_amount NUMERIC(12, 2),
      document_url TEXT,
      rejection_reason TEXT,
      notes TEXT,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ external_lab_orders table created');

  await sql`CREATE INDEX IF NOT EXISTS idx_elo_hospital ON external_lab_orders(hospital_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_elo_lab_order ON external_lab_orders(lab_order_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_elo_lab ON external_lab_orders(external_lab_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_elo_patient ON external_lab_orders(patient_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_elo_status ON external_lab_orders(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_elo_tat_breach ON external_lab_orders(tat_breach)`;
  console.log('  ✓ external_lab_orders indexes created');

  // ── Step 5: Verify ────────────────────────────────────────────────
  console.log('\nStep 5: Verifying tables...');
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('external_labs', 'external_lab_pricing', 'external_lab_orders')
    ORDER BY table_name
  `;
  console.log('  Tables created:', tables.map(t => t.table_name).join(', '));

  const totalTables = await sql`
    SELECT COUNT(*) as count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  console.log('  Total tables in database:', totalTables[0].count);

  console.log('\n✅ Migration complete!');
}

async function seed() {
  console.log('\n\nB.1 — Seeding External Labs & Pricing\n');

  // Get admin user
  const [admin] = await sql`
    SELECT id FROM users WHERE hospital_id = 'EHRC' AND 'super_admin' = ANY(roles) LIMIT 1
  `;
  if (!admin) { console.error('ERROR: No super_admin found'); process.exit(1); }
  console.log('Using admin:', admin.id);

  // Get sample lab_panels for EHRC (common tests)
  const panels = await sql`
    SELECT id, panel_code, panel_name FROM lab_panels
    WHERE hospital_id = 'EHRC'
    LIMIT 20
  `;
  console.log('Found', panels.length, 'lab panels in database');

  // ── External Labs ────────────────────────────────────────────────
  const labsData = [
    {
      code: 'SRL',
      name: 'SRL Diagnostics',
      city: 'Bengaluru',
      state: 'Karnataka',
      address: '123 Residency Road, Bengaluru',
      contact: 'Dr. Ramesh',
      phone: '080-41609999',
      email: 'hospital@srl.in',
      nabl: true,
      contract: 'monthly',
      contractStart: '2024-01-01',
      tat: 48,
    },
    {
      code: 'METRO',
      name: 'Metropolis Healthcare',
      city: 'Bengaluru',
      state: 'Karnataka',
      address: '456 MG Road, Bengaluru',
      contact: 'Ms. Priya',
      phone: '080-41025000',
      email: 'b2b@metropolis.co.in',
      nabl: true,
      cap: true,
      contract: 'annual',
      contractStart: '2024-01-01',
      tat: 36,
    },
    {
      code: 'THC',
      name: 'Thyrocare Technologies',
      city: 'Mumbai',
      state: 'Maharashtra',
      address: '789 Bandra East, Mumbai',
      contact: 'Mr. Arun',
      phone: '022-61693000',
      email: 'corporate@thyrocare.com',
      nabl: false,
      contract: 'per_test',
      contractStart: '2024-02-01',
      tat: 24,
    },
    {
      code: 'LAB',
      name: 'Dr. Lal PathLabs',
      city: 'Bengaluru',
      state: 'Karnataka',
      address: '321 Koramangala, Bengaluru',
      contact: 'Dr. Lal',
      phone: '080-41606060',
      email: 'partner@drlapath.com',
      nabl: true,
      contract: 'monthly',
      contractStart: '2024-01-15',
      tat: 48,
    },
    {
      code: 'MEDALL',
      name: 'Medall Healthcare',
      city: 'Chennai',
      state: 'Tamil Nadu',
      address: '555 Nungambakkam, Chennai',
      contact: 'Mr. Senthil',
      phone: '044-42508888',
      email: 'corporate@medall.in',
      nabl: true,
      contract: 'panel_rate',
      contractStart: '2024-03-01',
      tat: 72,
    },
    {
      code: 'NEUBERG',
      name: 'Neuberg Diagnostics',
      city: 'Bengaluru',
      state: 'Karnataka',
      address: '999 Whitefield, Bengaluru',
      contact: 'Dr. Kumar',
      phone: '080-68821234',
      email: 'business@neuberg.com',
      nabl: true,
      contract: 'monthly',
      contractStart: '2024-02-01',
      tat: 48,
    },
  ];

  // Insert labs
  console.log('\nSeeding External Labs...');
  const labIds = {};
  for (const lab of labsData) {
    const result = await sql`
      INSERT INTO external_labs (
        hospital_id, lab_name, lab_code, city, state, address,
        contact_person, contact_phone, contact_email,
        nabl_accredited, cap_accredited, contract_type, contract_start,
        default_tat_hours, is_active, created_by
      )
      VALUES (
        'EHRC', ${lab.name}, ${lab.code}, ${lab.city}, ${lab.state}, ${lab.address},
        ${lab.contact}, ${lab.phone}, ${lab.email},
        ${lab.nabl || false}, ${lab.cap || false}, ${lab.contract}, ${lab.contractStart},
        ${lab.tat}, true, ${admin.id}::uuid
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) {
      labIds[lab.code] = result[0].id;
      console.log('  ✓', lab.name);
    }
  }

  // ── Common Tests for Pricing ─────────────────────────────────────
  const tests = [
    { code: 'CBC', name: 'Complete Blood Count', costPrice: 150, patientPrice: 400 },
    { code: 'HBA1C', name: 'HbA1c (Glycated Hemoglobin)', costPrice: 200, patientPrice: 600 },
    { code: 'LIPID', name: 'Lipid Profile', costPrice: 250, patientPrice: 700 },
    { code: 'TSH', name: 'Thyroid Profile (T3/T4/TSH)', costPrice: 300, patientPrice: 800 },
    { code: 'LFT', name: 'Liver Function Test', costPrice: 200, patientPrice: 550 },
    { code: 'RFT', name: 'Kidney Function Test', costPrice: 180, patientPrice: 500 },
    { code: 'VITD', name: 'Vitamin D', costPrice: 400, patientPrice: 1200 },
    { code: 'VITB12', name: 'Vitamin B12', costPrice: 350, patientPrice: 1000 },
    { code: 'IRON', name: 'Iron Studies', costPrice: 250, patientPrice: 700 },
    { code: 'URINE', name: 'Urine Routine', costPrice: 50, patientPrice: 150 },
  ];

  // Seed pricing for SRL and Metropolis (the main labs)
  console.log('\nSeeding External Lab Pricing...');
  let pricingCount = 0;
  for (const labCode of ['SRL', 'METRO']) {
    if (!labIds[labCode]) continue;

    for (const test of tests) {
      // Try to find matching panel (optional)
      let panelId = null;
      if (panels.length > 0) {
        // Use first panel as fallback if no exact match
        panelId = panels[0].id;
      }

      await sql`
        INSERT INTO external_lab_pricing (
          hospital_id, external_lab_id, panel_id,
          test_code, test_name,
          cost_price, patient_price,
          is_preferred, is_active, created_by
        )
        VALUES (
          'EHRC', ${labIds[labCode]}::uuid, ${panelId ? `'${panelId}'::uuid` : 'NULL'},
          ${test.code}, ${test.name},
          ${test.costPrice}, ${test.patientPrice},
          true, true, ${admin.id}::uuid
        )
        ON CONFLICT DO NOTHING
      `;
      pricingCount++;
    }
  }
  console.log('  ✓ Seeded', pricingCount, 'pricing records');

  // ── Verify ───────────────────────────────────────────────────────
  console.log('\nStep 5: Verifying seed data...');
  const labsCount = await sql`
    SELECT COUNT(*) as count FROM external_labs WHERE hospital_id = 'EHRC'
  `;
  const pricingCountDB = await sql`
    SELECT COUNT(*) as count FROM external_lab_pricing WHERE hospital_id = 'EHRC'
  `;

  console.log('\n═══════════════════════════════════');
  console.log('Seed complete!');
  console.log(`  External Labs: ${labsCount[0].count}`);
  console.log(`  Pricing records: ${pricingCountDB[0].count}`);
  console.log('═══════════════════════════════════');
}

migrate().then(() => seed()).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
