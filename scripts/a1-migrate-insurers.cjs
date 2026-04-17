/**
 * A.1 — Insurer Master Migration + Seed
 * Creates insurers + insurer_tpa_mappings tables, adds insurer_id FK to insurance_claims,
 * and seeds 20+ known insurers/TPAs for EHRC.
 *
 * Run: NODE_PATH=apps/web/node_modules DATABASE_URL="..." node scripts/a1-migrate-insurers.cjs
 */

const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log('A.1 — Insurer Master Migration\n');

  // ── Step 1: Create enums ──────────────────────────────────────────
  console.log('Step 1: Creating enums...');
  try {
    await sql`CREATE TYPE insurer_type AS ENUM ('insurance_company', 'tpa', 'government', 'corporate', 'trust')`;
    console.log('  ✓ insurer_type enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ insurer_type enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE network_tier AS ENUM ('preferred', 'standard', 'non_network')`;
    console.log('  ✓ network_tier enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ network_tier enum already exists');
    else throw e;
  }

  // ── Step 2: Create insurers table ─────────────────────────────────
  console.log('\nStep 2: Creating insurers table...');
  await sql`
    CREATE TABLE IF NOT EXISTS insurers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      insurer_code TEXT NOT NULL,
      insurer_name TEXT NOT NULL,
      insurer_type insurer_type NOT NULL,
      contact_person TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      address TEXT,
      gst_number TEXT,
      network_tier network_tier DEFAULT 'standard',
      is_active BOOLEAN NOT NULL DEFAULT true,
      notes TEXT,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ insurers table created');

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_insurers_hospital ON insurers(hospital_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_insurers_code ON insurers(hospital_id, insurer_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_insurers_type ON insurers(insurer_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_insurers_active ON insurers(hospital_id, is_active)`;
  console.log('  ✓ insurers indexes created');

  // ── Step 3: Create insurer_tpa_mappings table ─────────────────────
  console.log('\nStep 3: Creating insurer_tpa_mappings table...');
  await sql`
    CREATE TABLE IF NOT EXISTS insurer_tpa_mappings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      insurer_id UUID NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
      tpa_id UUID NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
      effective_from DATE NOT NULL,
      effective_to DATE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ insurer_tpa_mappings table created');

  await sql`CREATE INDEX IF NOT EXISTS idx_itm_insurer ON insurer_tpa_mappings(insurer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_itm_tpa ON insurer_tpa_mappings(tpa_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_itm_hospital ON insurer_tpa_mappings(hospital_id)`;
  console.log('  ✓ insurer_tpa_mappings indexes created');

  // ── Step 4: Add insurer_id FK to insurance_claims ─────────────────
  console.log('\nStep 4: Adding insurer_id to insurance_claims...');
  try {
    await sql`ALTER TABLE insurance_claims ADD COLUMN insurer_id UUID REFERENCES insurers(id) ON DELETE SET NULL`;
    console.log('  ✓ insurer_id column added to insurance_claims');
  } catch (e) {
    if (e.code === '42701') console.log('  ~ insurer_id column already exists');
    else throw e;
  }
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_ic_insurer_id ON insurance_claims(insurer_id)`;
    console.log('  ✓ insurer_id index created');
  } catch (e) {
    console.log('  ~ index already exists');
  }

  // ── Step 5: Verify ────────────────────────────────────────────────
  console.log('\nStep 5: Verifying tables...');
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('insurers', 'insurer_tpa_mappings')
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
  console.log('\n\nA.1 — Seeding Insurers & TPAs\n');

  // Get admin user
  const [admin] = await sql`
    SELECT id FROM users WHERE hospital_id = 'EHRC' AND 'super_admin' = ANY(roles) LIMIT 1
  `;
  if (!admin) { console.error('ERROR: No super_admin found'); process.exit(1); }
  console.log('Using admin:', admin.id);

  // ── TPAs (type = 'tpa') ───────────────────────────────────────────
  const tpas = [
    { code: 'MEDI_ASSIST',  name: 'Medi Assist TPA',          phone: '080-46556555' },
    { code: 'PARAMOUNT',    name: 'Paramount Health Services', phone: '022-67512345' },
    { code: 'VIDAL',        name: 'Vidal Health TPA',          phone: '080-42454545' },
    { code: 'HERITAGE',     name: 'Heritage Health TPA',       phone: '1800-121-1100' },
    { code: 'RAKSHA',       name: 'Raksha Health Insurance TPA', phone: '080-45554777' },
    { code: 'MD_INDIA',     name: 'MD India Healthcare TPA',   phone: '1800-233-0707' },
    { code: 'GOOD_HEALTH',  name: 'Good Health TPA',           phone: '040-44559000' },
    { code: 'ERICSON',      name: 'Ericson Insurance TPA',     phone: '022-42199999' },
    { code: 'SAFEWAY',      name: 'Safeway Insurance TPA',     phone: '044-43522200' },
    { code: 'HEALTH_INDIA', name: 'Health India TPA',          phone: '1800-572-3737' },
    { code: 'FAMILY_HEALTH', name: 'Family Health Plan TPA',   phone: '040-39999999' },
    { code: 'ANMOL',        name: 'Anmol Medicare TPA',        phone: '1800-123-6464' },
  ];

  // ── Insurance Companies (type = 'insurance_company') ──────────────
  const insuranceCompanies = [
    { code: 'STAR_HEALTH',  name: 'Star Health & Allied Insurance', phone: '044-28302200', tier: 'preferred', tpa: 'MEDI_ASSIST' },
    { code: 'NIVA_BUPA',    name: 'Niva Bupa Health Insurance',     phone: '1800-200-4488', tier: 'preferred', tpa: 'PARAMOUNT' },
    { code: 'HDFC_ERGO',    name: 'HDFC ERGO Health Insurance',     phone: '1800-266-0700', tier: 'preferred', tpa: 'MEDI_ASSIST' },
    { code: 'ICICI_LOMBARD', name: 'ICICI Lombard Health Insurance', phone: '1800-266-9999', tier: 'standard', tpa: 'MEDI_ASSIST' },
    { code: 'NEW_INDIA',    name: 'New India Assurance',             phone: '022-22708888', tier: 'standard', tpa: 'PARAMOUNT' },
    { code: 'ORIENTAL',     name: 'Oriental Insurance',              phone: '011-23324000', tier: 'standard', tpa: 'VIDAL' },
    { code: 'NATIONAL',     name: 'National Insurance',              phone: '033-22481781', tier: 'standard', tpa: 'HERITAGE' },
    { code: 'UNITED_INDIA', name: 'United India Insurance',          phone: '044-28607605', tier: 'standard', tpa: 'MD_INDIA' },
    { code: 'CARE_HEALTH',  name: 'Care Health Insurance',           phone: '1800-102-4488', tier: 'preferred', tpa: 'RAKSHA' },
    { code: 'BAJAJ',        name: 'Bajaj Allianz General Insurance', phone: '1800-209-5858', tier: 'standard', tpa: 'GOOD_HEALTH' },
    { code: 'MAX_BUPA',     name: 'Max Bupa (now Niva Bupa)',        phone: '1800-200-4488', tier: 'standard', tpa: 'PARAMOUNT' },
    { code: 'MANIPAL_CIGNA', name: 'ManipalCigna Health Insurance', phone: '1800-266-9090', tier: 'standard', tpa: 'MEDI_ASSIST' },
    { code: 'SBI_GENERAL',  name: 'SBI General Insurance',           phone: '1800-102-1111', tier: 'standard', tpa: 'ERICSON' },
    { code: 'TATA_AIG',     name: 'Tata AIG General Insurance',      phone: '1800-266-7780', tier: 'standard', tpa: 'SAFEWAY' },
  ];

  // ── Government Schemes ────────────────────────────────────────────
  const govSchemes = [
    { code: 'CGHS',         name: 'CGHS (Central Govt Health Scheme)', phone: '011-23063452', tier: 'standard' },
    { code: 'ECHS',         name: 'ECHS (Ex-Servicemen)',              phone: '011-23011615', tier: 'standard' },
    { code: 'ESIS',         name: 'ESIC (Employees State Insurance)',   phone: '011-23234092', tier: 'standard' },
    { code: 'AROGYA_KARNATAKA', name: 'Arogya Karnataka',              phone: '080-22352835', tier: 'standard' },
    { code: 'AYUSHMAN',     name: 'Ayushman Bharat PM-JAY',            phone: '14555',         tier: 'standard' },
  ];

  // Insert TPAs
  console.log('\nSeeding TPAs...');
  const tpaIds = {};
  for (const tpa of tpas) {
    const result = await sql`
      INSERT INTO insurers (hospital_id, insurer_code, insurer_name, insurer_type, contact_phone, network_tier, created_by)
      VALUES ('EHRC', ${tpa.code}, ${tpa.name}, 'tpa', ${tpa.phone}, 'standard', ${admin.id}::uuid)
      ON CONFLICT (hospital_id, insurer_code) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `;
    tpaIds[tpa.code] = result[0].id;
    console.log('  ✓ TPA:', tpa.name);
  }

  // Insert Insurance Companies
  console.log('\nSeeding Insurance Companies...');
  const insurerIds = {};
  for (const ic of insuranceCompanies) {
    const result = await sql`
      INSERT INTO insurers (hospital_id, insurer_code, insurer_name, insurer_type, contact_phone, network_tier, created_by)
      VALUES ('EHRC', ${ic.code}, ${ic.name}, 'insurance_company', ${ic.phone}, ${ic.tier}, ${admin.id}::uuid)
      ON CONFLICT (hospital_id, insurer_code) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `;
    insurerIds[ic.code] = result[0].id;
    console.log('  ✓ Insurer:', ic.name);

    // Create TPA mapping
    if (ic.tpa && tpaIds[ic.tpa]) {
      await sql`
        INSERT INTO insurer_tpa_mappings (hospital_id, insurer_id, tpa_id, effective_from, is_active)
        VALUES ('EHRC', ${insurerIds[ic.code]}, ${tpaIds[ic.tpa]}, '2024-01-01', true)
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // Insert Government Schemes
  console.log('\nSeeding Government Schemes...');
  for (const gov of govSchemes) {
    await sql`
      INSERT INTO insurers (hospital_id, insurer_code, insurer_name, insurer_type, contact_phone, network_tier, created_by)
      VALUES ('EHRC', ${gov.code}, ${gov.name}, 'government', ${gov.phone}, ${gov.tier}, ${admin.id}::uuid)
      ON CONFLICT (hospital_id, insurer_code) DO UPDATE SET updated_at = NOW()
    `;
    console.log('  ✓ Govt:', gov.name);
  }

  // Verify
  const counts = await sql`
    SELECT insurer_type, COUNT(*) as count
    FROM insurers WHERE hospital_id = 'EHRC'
    GROUP BY insurer_type
  `;
  const total = await sql`SELECT COUNT(*) as count FROM insurers WHERE hospital_id = 'EHRC'`;
  const mappings = await sql`SELECT COUNT(*) as count FROM insurer_tpa_mappings WHERE hospital_id = 'EHRC'`;

  console.log('\n═══════════════════════════════════');
  console.log('Seed complete!');
  counts.forEach(c => console.log(`  ${c.insurer_type}: ${c.count}`));
  console.log(`  Total insurers: ${total[0].count}`);
  console.log(`  TPA mappings: ${mappings[0].count}`);
  console.log('═══════════════════════════════════');
}

migrate().then(() => seed()).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
