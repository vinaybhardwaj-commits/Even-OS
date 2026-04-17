/**
 * B.5 QC Enhancement Migration — Westgard Rules + EQAS
 *
 * Creates:
 * 1. qc_lot_master — QC material lots with target mean/SD
 * 2. qc_enhanced_runs — Individual QC measurement runs with Westgard violations
 * 3. westgard_config — Per-hospital Westgard rule configuration
 * 4. eqas_results — External Quality Assessment Scheme results
 *
 * Seeds 6 standard Westgard rules per hospital.
 */

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const HOSPITAL_ID = 'EHRC';
const ADMIN_USER_ID = 'a348b32e-d932-4451-ba8f-ef608f3d40be';

async function migrate() {
  console.log('[B.5 QC Enhancement] Starting migration...\n');

  try {
    // ================================================================
    // CREATE ENUMS (if not exist)
    // ================================================================
    console.log('Creating enums...');

    await sql`DO $$ BEGIN CREATE TYPE qc_level_type AS ENUM ('level_1','level_2','level_3'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
    await sql`DO $$ BEGIN CREATE TYPE qc_result_status AS ENUM ('pass','warning','fail'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
    await sql`DO $$ BEGIN CREATE TYPE westgard_rule_code AS ENUM ('1_2s','1_3s','2_2s','R_4s','4_1s','10x'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
    await sql`DO $$ BEGIN CREATE TYPE eqas_performance_rating AS ENUM ('acceptable','warning','unacceptable'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    console.log('✓ Enums created\n');

    // ================================================================
    // CREATE TABLES
    // ================================================================
    console.log('Creating qc_lot_master table...');

    await sql`
      CREATE TABLE IF NOT EXISTS qc_lot_master (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

        lot_number varchar(50) NOT NULL,
        material_name text NOT NULL,
        manufacturer varchar(100),
        level text NOT NULL,
        component_id uuid REFERENCES lab_panel_components(id) ON DELETE SET NULL,

        target_mean numeric(12,4) NOT NULL,
        target_sd numeric(12,4) NOT NULL,
        unit varchar(50),

        received_date timestamp,
        expiry_date timestamp,
        opened_date timestamp,

        is_expired boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,

        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qlm_hospital ON qc_lot_master(hospital_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qlm_component ON qc_lot_master(component_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qlm_expiry ON qc_lot_master(expiry_date)
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_qlm_lot_unique
      ON qc_lot_master(hospital_id, lot_number, component_id)
    `;

    console.log('✓ qc_lot_master created\n');

    console.log('Creating qc_enhanced_runs table...');

    await sql`
      CREATE TABLE IF NOT EXISTS qc_enhanced_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        lot_id uuid NOT NULL REFERENCES qc_lot_master(id) ON DELETE RESTRICT,
        component_id uuid NOT NULL REFERENCES lab_panel_components(id) ON DELETE RESTRICT,

        run_date timestamp NOT NULL,
        measured_value numeric(12,4) NOT NULL,
        z_score numeric(8,4),
        result_status text,

        westgard_violations jsonb,

        tech_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        tech_sign_off boolean NOT NULL DEFAULT false,
        sign_off_at timestamp,

        instrument varchar(100),
        notes text,

        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qr_hospital ON qc_enhanced_runs(hospital_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qr_lot ON qc_enhanced_runs(lot_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qr_component ON qc_enhanced_runs(component_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qr_run_date ON qc_enhanced_runs(run_date)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qr_tech ON qc_enhanced_runs(tech_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_qr_status ON qc_enhanced_runs(result_status)
    `;

    console.log('✓ qc_enhanced_runs created\n');

    console.log('Creating westgard_config table...');

    await sql`
      CREATE TABLE IF NOT EXISTS westgard_config (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

        rule_code varchar(20) NOT NULL,
        rule_name text NOT NULL,
        description text,

        is_warning boolean NOT NULL DEFAULT false,
        is_reject boolean NOT NULL DEFAULT true,
        block_patient_results boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,

        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_wc_hospital ON westgard_config(hospital_id)
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wc_rule_unique
      ON westgard_config(hospital_id, rule_code)
    `;

    console.log('✓ westgard_config created\n');

    console.log('Creating eqas_results table...');

    await sql`
      CREATE TABLE IF NOT EXISTS eqas_results (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

        scheme_name varchar(100) NOT NULL,
        cycle_name varchar(100),
        component_id uuid REFERENCES lab_panel_components(id) ON DELETE SET NULL,
        sample_id varchar(50),

        reported_value numeric(12,4),
        expected_value numeric(12,4),
        sdi numeric(8,4),
        performance_rating text,

        peer_group_mean numeric(12,4),
        peer_group_sd numeric(12,4),
        peer_group_cv numeric(8,4),

        reported_date timestamp,
        reported_by uuid REFERENCES users(id) ON DELETE SET NULL,

        notes text,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_er_hospital ON eqas_results(hospital_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_er_component ON eqas_results(component_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_er_scheme ON eqas_results(scheme_name)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_er_performance ON eqas_results(performance_rating)
    `;

    console.log('✓ eqas_results created\n');

    // ================================================================
    // SEED WESTGARD RULES
    // ================================================================
    console.log('Seeding standard Westgard rules...\n');

    const westgardRules = [
      {
        rule_code: '1_2s',
        rule_name: 'Warning (1-2s)',
        description: 'One result exceeds ±2 standard deviations. Warning only.',
        is_warning: true,
        is_reject: false,
        block_patient_results: false,
      },
      {
        rule_code: '1_3s',
        rule_name: 'Reject (1-3s)',
        description: 'One result exceeds ±3 standard deviations. Reject run.',
        is_warning: false,
        is_reject: true,
        block_patient_results: true,
      },
      {
        rule_code: '2_2s',
        rule_name: 'Reject (2-2s)',
        description: 'Two consecutive results exceed 2 standard deviations on same side. Reject run.',
        is_warning: false,
        is_reject: true,
        block_patient_results: true,
      },
      {
        rule_code: 'R_4s',
        rule_name: 'Reject (R-4s)',
        description: 'Range between consecutive results exceeds 4 standard deviations. Reject run.',
        is_warning: false,
        is_reject: true,
        block_patient_results: true,
      },
      {
        rule_code: '4_1s',
        rule_name: 'Reject (4-1s)',
        description: 'Four consecutive results exceed 1 standard deviation on same side. Reject run.',
        is_warning: false,
        is_reject: true,
        block_patient_results: true,
      },
      {
        rule_code: '10x',
        rule_name: 'Reject (10x)',
        description: 'Ten consecutive results on same side of mean. Reject run.',
        is_warning: false,
        is_reject: true,
        block_patient_results: true,
      },
    ];

    for (const rule of westgardRules) {
      // Upsert logic: delete if exists, then insert
      await sql`
        DELETE FROM westgard_config
        WHERE hospital_id = ${HOSPITAL_ID} AND rule_code = ${rule.rule_code}
      `;

      await sql`
        INSERT INTO westgard_config
        (id, hospital_id, rule_code, rule_name, description, is_warning, is_reject, block_patient_results, is_active)
        VALUES
        (gen_random_uuid(), ${HOSPITAL_ID}, ${rule.rule_code}, ${rule.rule_name}, ${rule.description},
         ${rule.is_warning}, ${rule.is_reject}, ${rule.block_patient_results}, true)
      `;

      console.log(`  ✓ ${rule.rule_name}`);
    }

    console.log('\n✓ Westgard rules seeded\n');

    // ================================================================
    // VERIFY TABLE COUNTS
    // ================================================================
    console.log('Verifying table creation...\n');

    const lotCount = await sql`
      SELECT COUNT(*) as cnt FROM qc_lot_master WHERE hospital_id = ${HOSPITAL_ID}
    `;
    console.log(`  qc_lot_master: ${lotCount[0].cnt} rows`);

    const runCount = await sql`
      SELECT COUNT(*) as cnt FROM qc_enhanced_runs WHERE hospital_id = ${HOSPITAL_ID}
    `;
    console.log(`  qc_enhanced_runs: ${runCount[0].cnt} rows`);

    const configCount = await sql`
      SELECT COUNT(*) as cnt FROM westgard_config WHERE hospital_id = ${HOSPITAL_ID}
    `;
    console.log(`  westgard_config: ${configCount[0].cnt} rows (seeded)`);

    const eqasCount = await sql`
      SELECT COUNT(*) as cnt FROM eqas_results WHERE hospital_id = ${HOSPITAL_ID}
    `;
    console.log(`  eqas_results: ${eqasCount[0].cnt} rows\n`);

    // ================================================================
    // SUMMARY
    // ================================================================
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✓ B.5 QC Enhancement Migration Complete');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('Summary:');
    console.log('  • 4 tables created (qc_lot_master, qc_enhanced_runs, westgard_config, eqas_results)');
    console.log('  • 4 enums created');
    console.log('  • 6 Westgard rules seeded for EHRC');
    console.log('  • Hospital ID: EHRC');
    console.log('  • Admin User: a348b32e-d932-4451-ba8f-ef608f3d40be\n');
    console.log('Ready for B.5 API development.\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error('\nFull error:', err);
    process.exit(1);
  }
}

migrate();
