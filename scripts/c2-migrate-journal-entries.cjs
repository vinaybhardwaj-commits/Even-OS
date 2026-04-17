/**
 * C.2 Journal Entries & GL Migration
 *
 * Creates:
 * 1. journal_entries — Double-entry header with balanced constraint
 * 2. journal_entry_lines — Individual debit/credit lines
 * 3. deposit_transactions — Individual deposit records with JE FK
 *
 * 4 enums: je_entry_type, je_status, je_reference_type, deposit_txn_type
 */

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log('[C.2 Journal Entries & GL] Starting migration...\n');

  try {
    // ================================================================
    // CREATE ENUMS
    // ================================================================
    console.log('Creating enums...');

    await sql`DO $$ BEGIN CREATE TYPE je_entry_type AS ENUM (
      'auto_billing','auto_collection','auto_deposit','auto_refund','auto_waiver',
      'auto_pharmacy','auto_payroll','auto_vendor','manual','adjustment','opening_balance','closing'
    ); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    await sql`DO $$ BEGIN CREATE TYPE je_status AS ENUM ('draft','posted','reversed','voided'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    await sql`DO $$ BEGIN CREATE TYPE je_reference_type AS ENUM (
      'invoice','payment','deposit','refund','waiver','purchase_order',
      'vendor_invoice','payroll_run','insurance_settlement','claim','other'
    ); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    await sql`DO $$ BEGIN CREATE TYPE deposit_txn_type AS ENUM ('collection','application','refund','adjustment'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    console.log('  4 enums created\n');

    // ================================================================
    // TABLE 1: journal_entries
    // ================================================================
    console.log('Creating journal_entries table...');

    await sql`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

        entry_number varchar(30) NOT NULL,
        entry_date date NOT NULL,
        entry_type text NOT NULL,

        period_id uuid,

        narration text NOT NULL,

        reference_type text,
        reference_id uuid,

        total_debit numeric(15,2) NOT NULL,
        total_credit numeric(15,2) NOT NULL,

        status text NOT NULL DEFAULT 'draft',

        posted_by uuid,
        posted_at timestamp,

        reversed_by uuid,
        reversed_at timestamp,
        reversal_entry_id uuid REFERENCES journal_entries(id),

        data_hash varchar(64),

        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `;

    // Balanced constraint
    await sql`DO $$ BEGIN
      ALTER TABLE journal_entries ADD CONSTRAINT check_je_balanced CHECK (total_debit = total_credit);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    // Indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_je_hospital ON journal_entries(hospital_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_je_date ON journal_entries(entry_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_je_status ON journal_entries(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_je_type ON journal_entries(entry_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_je_reference ON journal_entries(reference_type, reference_id)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_je_number_unique ON journal_entries(hospital_id, entry_number)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_je_period ON journal_entries(period_id)`;

    console.log('  journal_entries created (with balanced constraint)\n');

    // ================================================================
    // TABLE 2: journal_entry_lines
    // ================================================================
    console.log('Creating journal_entry_lines table...');

    await sql`
      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

        journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
        account_id uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,

        debit_amount numeric(15,2) NOT NULL DEFAULT 0,
        credit_amount numeric(15,2) NOT NULL DEFAULT 0,

        narration text,
        cost_center text,

        created_at timestamp NOT NULL DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_je_lines_entry ON journal_entry_lines(journal_entry_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_je_lines_account ON journal_entry_lines(account_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_je_lines_hospital ON journal_entry_lines(hospital_id)`;

    console.log('  journal_entry_lines created\n');

    // ================================================================
    // TABLE 3: deposit_transactions
    // ================================================================
    console.log('Creating deposit_transactions table...');

    await sql`
      CREATE TABLE IF NOT EXISTS deposit_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

        patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        encounter_id uuid REFERENCES encounters(id) ON DELETE RESTRICT,

        txn_type text NOT NULL,
        amount numeric(15,2) NOT NULL,
        payment_method text,
        payment_reference text,

        narration text,

        journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,

        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_dep_txn_patient ON deposit_transactions(patient_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_dep_txn_encounter ON deposit_transactions(encounter_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_dep_txn_hospital ON deposit_transactions(hospital_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_dep_txn_je ON deposit_transactions(journal_entry_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_dep_txn_type ON deposit_transactions(txn_type)`;

    console.log('  deposit_transactions created\n');

    // ================================================================
    // VERIFY
    // ================================================================
    console.log('Verifying...\n');

    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('journal_entries', 'journal_entry_lines', 'deposit_transactions')
      ORDER BY table_name
    `;
    console.log('  Tables created:');
    for (const t of tables) {
      console.log(`    - ${t.table_name}`);
    }

    // Verify balanced constraint
    const constraints = await sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'journal_entries' AND constraint_type = 'CHECK'
    `;
    console.log(`\n  CHECK constraints on journal_entries: ${constraints.length}`);
    for (const c of constraints) {
      console.log(`    - ${c.constraint_name}`);
    }

    // Total table count
    const totalCount = await sql`
      SELECT COUNT(*) as cnt FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    console.log(`\n  Total tables in database: ${totalCount[0].cnt}`);

    // ================================================================
    // SUMMARY
    // ================================================================
    console.log('\n' + '='.repeat(59));
    console.log('  C.2 Journal Entries & GL Migration Complete');
    console.log('='.repeat(59));
    console.log('\nSummary:');
    console.log('  * 3 tables created (journal_entries, journal_entry_lines, deposit_transactions)');
    console.log('  * 4 enums created');
    console.log('  * Balanced constraint: total_debit MUST equal total_credit');
    console.log('  * 15 indexes created');
    console.log('\nReady for C.2 router development.\n');

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    console.error('\nFull error:', err);
    process.exit(1);
  }
}

migrate();
