/**
 * B.2 — Test Catalog v2 Migration + Seed
 * Creates test_catalog_extensions and reference_range_rules tables.
 * Extends lab panels with source type, methodology, equipment metadata.
 * Seeds advanced reference ranges with age/gender/pregnancy stratification for common tests.
 *
 * Run: NODE_PATH=apps/web/node_modules DATABASE_URL="..." node scripts/b2-migrate-test-catalog-v2.cjs
 */

const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log('B.2 — Test Catalog v2 Migration\n');

  // ── Step 1: Create enums ──────────────────────────────────────────
  console.log('Step 1: Creating enums...');

  try {
    await sql`CREATE TYPE test_source_type AS ENUM ('in_house', 'outsourced', 'either')`;
    console.log('  ✓ test_source_type enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ test_source_type enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE reporting_format AS ENUM ('standard', 'narrative', 'cumulative')`;
    console.log('  ✓ reporting_format enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ reporting_format enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE test_approval_status AS ENUM ('draft', 'pending_approval', 'approved', 'archived')`;
    console.log('  ✓ test_approval_status enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ test_approval_status enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE turnaround_priority AS ENUM ('routine_4h', 'urgent_2h', 'stat_1h', 'custom')`;
    console.log('  ✓ turnaround_priority enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ turnaround_priority enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE pregnancy_status AS ENUM ('not_pregnant', 'trimester_1', 'trimester_2', 'trimester_3', 'postpartum')`;
    console.log('  ✓ pregnancy_status enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ pregnancy_status enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE clinical_context AS ENUM ('fasting', 'post_prandial', 'exercise', 'altitude')`;
    console.log('  ✓ clinical_context enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ clinical_context enum already exists');
    else throw e;
  }

  try {
    await sql`CREATE TYPE test_gender AS ENUM ('all', 'male', 'female')`;
    console.log('  ✓ test_gender enum created');
  } catch (e) {
    if (e.code === '42710') console.log('  ~ test_gender enum already exists');
    else throw e;
  }

  // ── Step 2: Create test_catalog_extensions table ──────────────────
  console.log('\nStep 2: Creating test_catalog_extensions table...');
  await sql`
    CREATE TABLE IF NOT EXISTS test_catalog_extensions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      tce_panel_id UUID NOT NULL REFERENCES lab_panels(id) ON DELETE RESTRICT,
      source_type TEXT NOT NULL DEFAULT 'in_house',
      default_external_lab_id UUID REFERENCES external_labs(id) ON DELETE SET NULL,
      methodology VARCHAR(100),
      equipment VARCHAR(100),
      specimen_volume VARCHAR(100),
      special_instructions TEXT,
      reporting_format VARCHAR(30) DEFAULT 'standard',
      turnaround_priority VARCHAR(30) DEFAULT 'routine_4h',
      approval_status VARCHAR(30) DEFAULT 'approved',
      approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ,
      requires_consent BOOLEAN NOT NULL DEFAULT false,
      tce_is_active BOOLEAN NOT NULL DEFAULT true,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      tce_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tce_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ test_catalog_extensions table created');

  await sql`CREATE INDEX IF NOT EXISTS idx_tce_hospital ON test_catalog_extensions(hospital_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_tce_panel_unique ON test_catalog_extensions(hospital_id, tce_panel_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tce_source_type ON test_catalog_extensions(source_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tce_approval_status ON test_catalog_extensions(approval_status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tce_external_lab ON test_catalog_extensions(default_external_lab_id)`;
  console.log('  ✓ test_catalog_extensions indexes created');

  // ── Step 3: Create reference_range_rules table ────────────────────
  console.log('\nStep 3: Creating reference_range_rules table...');
  await sql`
    CREATE TABLE IF NOT EXISTS reference_range_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
      rrr_component_id UUID NOT NULL REFERENCES lab_panel_components(id) ON DELETE CASCADE,
      rule_name VARCHAR(100) NOT NULL,
      age_min_years INTEGER,
      age_max_years INTEGER,
      age_min_days INTEGER,
      age_max_days INTEGER,
      gender test_gender NOT NULL DEFAULT 'all',
      pregnancy_status pregnancy_status,
      clinical_context clinical_context,
      ref_range_low NUMERIC(12, 4),
      ref_range_high NUMERIC(12, 4),
      ref_range_text TEXT,
      unit VARCHAR(50),
      critical_low NUMERIC(12, 4),
      critical_high NUMERIC(12, 4),
      panic_low NUMERIC(12, 4),
      panic_high NUMERIC(12, 4),
      interpretation_guide TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      rrr_is_active BOOLEAN NOT NULL DEFAULT true,
      rrr_created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      rrr_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rrr_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('  ✓ reference_range_rules table created');

  await sql`CREATE INDEX IF NOT EXISTS idx_rrr_hospital ON reference_range_rules(hospital_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rrr_component ON reference_range_rules(rrr_component_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rrr_gender ON reference_range_rules(gender)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rrr_pregnancy ON reference_range_rules(pregnancy_status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rrr_is_active ON reference_range_rules(rrr_is_active)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rrr_priority ON reference_range_rules(rrr_component_id, priority)`;
  console.log('  ✓ reference_range_rules indexes created');

  // ── Step 4: Verify ────────────────────────────────────────────────
  console.log('\nStep 4: Verifying tables...');
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('test_catalog_extensions', 'reference_range_rules')
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
  console.log('\n\nB.2 — Seeding Test Catalog Extensions & Reference Ranges\n');

  // Get admin user
  const [admin] = await sql`
    SELECT id FROM users WHERE hospital_id = 'EHRC' AND 'super_admin' = ANY(roles) LIMIT 1
  `;
  if (!admin) {
    console.error('ERROR: No super_admin found for EHRC');
    process.exit(1);
  }
  console.log('Using admin:', admin.id);

  // Get lab panels for EHRC
  const panels = await sql`
    SELECT id, panel_code, panel_name FROM lab_panels
    WHERE hospital_id = 'EHRC'
    ORDER BY panel_name
  `;
  console.log('Found', panels.length, 'lab panels in EHRC');

  if (panels.length === 0) {
    console.log('⚠ No lab panels found. Skipping seeding test_catalog_extensions.');
  } else {
    // ── Seed test_catalog_extensions ──────────────────────────────
    console.log('\nSeeding test_catalog_extensions...');

    const extensionData = [
      {
        panelCode: 'CBC',
        source: 'in_house',
        methodology: 'Automated hematology analyzer',
        equipment: 'Sysmex XN-1000',
        specimen: '3ml EDTA',
        instructions: 'No fasting required',
        reporting: 'standard',
        turnaround: 'routine_4h',
      },
      {
        panelCode: 'HBA1C',
        source: 'in_house',
        methodology: 'Ion exchange chromatography',
        equipment: 'Bio-Rad D-10',
        specimen: '2ml EDTA',
        instructions: 'Fasting not required',
        reporting: 'standard',
        turnaround: 'routine_4h',
      },
      {
        panelCode: 'LIPID',
        source: 'in_house',
        methodology: 'Enzymatic colorimetric',
        equipment: 'Roche Cobas 6000',
        specimen: '5ml serum',
        instructions: 'Fasting 8-12 hours preferred for accurate triglycerides',
        reporting: 'standard',
        turnaround: 'routine_4h',
      },
      {
        panelCode: 'TSH',
        source: 'in_house',
        methodology: 'Chemiluminescent immunoassay',
        equipment: 'Roche Elecsys',
        specimen: '5ml serum',
        instructions: 'Fasting not required',
        reporting: 'standard',
        turnaround: 'routine_4h',
      },
      {
        panelCode: 'RFT',
        source: 'in_house',
        methodology: 'Enzymatic colorimetric',
        equipment: 'Roche Cobas 6000',
        specimen: '5ml serum',
        instructions: 'Fasting not required',
        reporting: 'standard',
        turnaround: 'routine_4h',
      },
    ];

    for (const ext of extensionData) {
      const panel = panels.find(p => p.panel_code === ext.panelCode);
      if (!panel) {
        console.log(`  ~ Panel ${ext.panelCode} not found, skipping`);
        continue;
      }

      const result = await sql`
        INSERT INTO test_catalog_extensions (
          hospital_id, tce_panel_id, source_type, methodology, equipment,
          specimen_volume, special_instructions, reporting_format, turnaround_priority,
          approval_status, tce_is_active, created_by
        )
        VALUES (
          'EHRC', ${panel.id}::uuid, ${ext.source}, ${ext.methodology}, ${ext.equipment},
          ${ext.specimen}, ${ext.instructions}, ${ext.reporting}, ${ext.turnaround},
          'approved', true, ${admin.id}::uuid
        )
        ON CONFLICT (hospital_id, tce_panel_id) DO NOTHING
        RETURNING id
      `;
      if (result.length > 0) {
        console.log(`  ✓ ${ext.panelCode}`);
      }
    }
  }

  // ── Seed reference_range_rules ───────────────────────────────────
  console.log('\nSeeding reference_range_rules...');

  // Get lab_panel_components for common tests
  const components = await sql`
    SELECT
      id, lpc_panel_id, test_code, test_name, test_unit,
      ref_range_low, ref_range_high, critical_low, critical_high
    FROM lab_panel_components
    WHERE hospital_id = 'EHRC'
    ORDER BY test_name
  `;
  console.log('Found', components.length, 'lab panel components in EHRC');

  const rangeRulesData = [];

  // Hemoglobin ranges
  const hgbComp = components.find(c => c.test_code && c.test_code.includes('HGB'));
  if (hgbComp) {
    rangeRulesData.push(
      // Adult males
      {
        componentId: hgbComp.id,
        ruleName: 'Adult Male',
        ageMin: 18,
        ageMax: 65,
        gender: 'male',
        low: 13.5,
        high: 17.5,
        unit: 'g/dL',
        critLow: 7.0,
        critHigh: 20.0,
        priority: 10,
      },
      // Adult females
      {
        componentId: hgbComp.id,
        ruleName: 'Adult Female',
        ageMin: 18,
        ageMax: 65,
        gender: 'female',
        low: 12.0,
        high: 16.0,
        unit: 'g/dL',
        critLow: 7.0,
        critHigh: 20.0,
        priority: 10,
      },
      // Pediatric (5-12 years)
      {
        componentId: hgbComp.id,
        ruleName: 'Pediatric (5-12y)',
        ageMin: 5,
        ageMax: 12,
        gender: 'all',
        low: 11.0,
        high: 14.0,
        unit: 'g/dL',
        critLow: 7.0,
        critHigh: 20.0,
        priority: 20,
      },
      // Neonatal (0-28 days)
      {
        componentId: hgbComp.id,
        ruleName: 'Neonatal (0-28d)',
        ageMin: 0,
        ageMax: 0,
        ageMinDays: 0,
        ageMaxDays: 28,
        gender: 'all',
        low: 14.0,
        high: 24.0,
        unit: 'g/dL',
        critLow: 9.0,
        critHigh: 30.0,
        priority: 5,
      },
      // Pregnant
      {
        componentId: hgbComp.id,
        ruleName: 'Pregnant (All Trimesters)',
        gender: 'female',
        pregnancy: 'not_pregnant',
        low: 11.0,
        high: 15.0,
        unit: 'g/dL',
        critLow: 7.0,
        critHigh: 20.0,
        priority: 15,
      }
    );
  }

  // Blood Glucose Fasting ranges
  const glucoseComp = components.find(c => c.test_code && (c.test_code.includes('GLUC') || c.test_code.includes('FBS')));
  if (glucoseComp) {
    rangeRulesData.push(
      // Adult fasting
      {
        componentId: glucoseComp.id,
        ruleName: 'Adult Fasting',
        ageMin: 18,
        ageMax: 65,
        gender: 'all',
        context: 'fasting',
        low: 70,
        high: 100,
        unit: 'mg/dL',
        critLow: 40,
        critHigh: 400,
        panicLow: 25,
        panicHigh: 500,
        priority: 10,
      },
      // Pediatric fasting
      {
        componentId: glucoseComp.id,
        ruleName: 'Pediatric Fasting',
        ageMin: 5,
        ageMax: 17,
        gender: 'all',
        context: 'fasting',
        low: 60,
        high: 100,
        unit: 'mg/dL',
        critLow: 40,
        critHigh: 400,
        panicLow: 25,
        panicHigh: 500,
        priority: 20,
      }
    );
  }

  // HbA1c ranges
  const hba1cComp = components.find(c => c.test_code && c.test_code.includes('HBA1C'));
  if (hba1cComp) {
    rangeRulesData.push(
      // Normal adult
      {
        componentId: hba1cComp.id,
        ruleName: 'Normal Adult',
        ageMin: 18,
        ageMax: 65,
        gender: 'all',
        refText: '<5.7%',
        unit: '%',
        priority: 10,
        interpretation: 'Normal glucose control',
      },
      // Pre-diabetic
      {
        componentId: hba1cComp.id,
        ruleName: 'Pre-diabetic',
        ageMin: 18,
        ageMax: 65,
        gender: 'all',
        refText: '5.7-6.4%',
        unit: '%',
        priority: 10,
        interpretation: 'Impaired glucose tolerance',
      },
      // Diabetic
      {
        componentId: hba1cComp.id,
        ruleName: 'Diabetic',
        ageMin: 18,
        ageMax: 65,
        gender: 'all',
        refText: '>6.5%',
        unit: '%',
        priority: 10,
        interpretation: 'Diabetes mellitus diagnosis threshold',
      }
    );
  }

  // TSH ranges
  const tshComp = components.find(c => c.test_code && c.test_code.includes('TSH'));
  if (tshComp) {
    rangeRulesData.push(
      // Adult
      {
        componentId: tshComp.id,
        ruleName: 'Adult',
        ageMin: 18,
        ageMax: 65,
        gender: 'all',
        low: 0.4,
        high: 4.0,
        unit: 'mIU/L',
        critLow: 0.01,
        critHigh: 50.0,
        priority: 10,
      },
      // Pregnant T1
      {
        componentId: tshComp.id,
        ruleName: 'Pregnant T1 (0-13w)',
        gender: 'female',
        pregnancy: 'trimester_1',
        low: 0.1,
        high: 2.5,
        unit: 'mIU/L',
        priority: 5,
      },
      // Pregnant T2
      {
        componentId: tshComp.id,
        ruleName: 'Pregnant T2 (13-28w)',
        gender: 'female',
        pregnancy: 'trimester_2',
        low: 0.2,
        high: 3.0,
        unit: 'mIU/L',
        priority: 5,
      },
      // Pregnant T3
      {
        componentId: tshComp.id,
        ruleName: 'Pregnant T3 (>28w)',
        gender: 'female',
        pregnancy: 'trimester_3',
        low: 0.3,
        high: 3.0,
        unit: 'mIU/L',
        priority: 5,
      }
    );
  }

  // Creatinine ranges
  const creatComp = components.find(c => c.test_code && c.test_code.includes('CREAT'));
  if (creatComp) {
    rangeRulesData.push(
      // Adult male
      {
        componentId: creatComp.id,
        ruleName: 'Adult Male',
        ageMin: 18,
        ageMax: 65,
        gender: 'male',
        low: 0.7,
        high: 1.3,
        unit: 'mg/dL',
        critLow: 0.2,
        critHigh: 10.0,
        priority: 10,
      },
      // Adult female
      {
        componentId: creatComp.id,
        ruleName: 'Adult Female',
        ageMin: 18,
        ageMax: 65,
        gender: 'female',
        low: 0.6,
        high: 1.1,
        unit: 'mg/dL',
        critLow: 0.2,
        critHigh: 10.0,
        priority: 10,
      },
      // Pediatric
      {
        componentId: creatComp.id,
        ruleName: 'Pediatric',
        ageMin: 5,
        ageMax: 17,
        gender: 'all',
        low: 0.3,
        high: 0.7,
        unit: 'mg/dL',
        critLow: 0.2,
        critHigh: 5.0,
        priority: 20,
      }
    );
  }

  // Potassium ranges
  const kComp = components.find(c => c.test_code && c.test_code.includes('K'));
  if (kComp) {
    rangeRulesData.push(
      // Adult
      {
        componentId: kComp.id,
        ruleName: 'Adult',
        ageMin: 18,
        ageMax: 65,
        gender: 'all',
        low: 3.5,
        high: 5.0,
        unit: 'mEq/L',
        critLow: 2.5,
        critHigh: 6.5,
        panicLow: 2.0,
        panicHigh: 7.0,
        priority: 10,
      }
    );
  }

  // Insert all reference range rules
  let insertedCount = 0;
  for (const rule of rangeRulesData) {
    try {
      await sql`
        INSERT INTO reference_range_rules (
          hospital_id, rrr_component_id, rule_name,
          age_min_years, age_max_years, age_min_days, age_max_days,
          gender, pregnancy_status, clinical_context,
          ref_range_low, ref_range_high, ref_range_text, unit,
          critical_low, critical_high, panic_low, panic_high,
          interpretation_guide, priority, rrr_is_active, rrr_created_by
        )
        VALUES (
          'EHRC', ${rule.componentId}::uuid, ${rule.ruleName},
          ${rule.ageMin || null}, ${rule.ageMax || null}, ${rule.ageMinDays || null}, ${rule.ageMaxDays || null},
          ${rule.gender || 'all'}, ${rule.pregnancy || null}, ${rule.context || null},
          ${rule.low || null}, ${rule.high || null}, ${rule.refText || null}, ${rule.unit || null},
          ${rule.critLow || null}, ${rule.critHigh || null}, ${rule.panicLow || null}, ${rule.panicHigh || null},
          ${rule.interpretation || null}, ${rule.priority || 100}, true, ${admin.id}::uuid
        )
        ON CONFLICT DO NOTHING
      `;
      insertedCount++;
    } catch (e) {
      console.error(`Error inserting rule ${rule.ruleName}:`, e.message);
    }
  }
  console.log(`  ✓ Inserted ${insertedCount} reference range rules`);

  // ── Verify ───────────────────────────────────────────────────────
  console.log('\nStep 5: Verifying seed data...');
  const extensionCount = await sql`
    SELECT COUNT(*) as count FROM test_catalog_extensions WHERE hospital_id = 'EHRC'
  `;
  const rangeCount = await sql`
    SELECT COUNT(*) as count FROM reference_range_rules WHERE hospital_id = 'EHRC'
  `;

  console.log('\n═══════════════════════════════════');
  console.log('Seed complete!');
  console.log(`  Test Catalog Extensions: ${extensionCount[0].count}`);
  console.log(`  Reference Range Rules: ${rangeCount[0].count}`);
  console.log('═══════════════════════════════════');
}

migrate()
  .then(() => seed())
  .catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
  });
