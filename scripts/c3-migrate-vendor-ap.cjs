/**
 * C.3 Accounts Payable Migration
 *
 * Creates:
 * 1. vendor_contracts — Vendor/supplier contract management
 * 2. vendor_invoices — Invoice lifecycle with approval workflow
 *
 * 5 enums for contract types, statuses, payment terms, frequency, invoice status
 */

const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function migrate() {
  console.log('[C.3 Accounts Payable] Starting migration...\n');

  try {
    // ================================================================
    // CREATE ENUMS
    // ================================================================
    console.log('Creating enums...');

    await sql`DO $$ BEGIN CREATE TYPE vendor_contract_type AS ENUM (
      'supply','service','lease','amc','consulting','outsourced_lab','catering','housekeeping','laundry','other'
    ); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    await sql`DO $$ BEGIN CREATE TYPE vendor_contract_status AS ENUM (
      'draft','active','expiring_soon','expired','terminated'
    ); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    await sql`DO $$ BEGIN CREATE TYPE vendor_payment_terms AS ENUM (
      'net_15','net_30','net_45','net_60','advance','milestone'
    ); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    await sql`DO $$ BEGIN CREATE TYPE vendor_payment_frequency AS ENUM (
      'one_time','monthly','quarterly','annual','per_invoice'
    ); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    await sql`DO $$ BEGIN CREATE TYPE vendor_invoice_status AS ENUM (
      'received','verified','approved','scheduled','paid','disputed','cancelled'
    ); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

    console.log('  5 enums created\n');

    // ================================================================
    // TABLE 1: vendor_contracts
    // ================================================================
    console.log('Creating vendor_contracts table...');

    await sql`
      CREATE TABLE IF NOT EXISTS vendor_contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

        vendor_name text NOT NULL,
        vendor_code varchar(30),
        vendor_gstin varchar(20),
        vendor_pan varchar(15),
        vendor_contact text,
        vendor_email text,
        vendor_phone text,
        vendor_address text,

        contract_number varchar(40) NOT NULL,
        contract_type text NOT NULL,
        description text,

        start_date date NOT NULL,
        end_date date,
        auto_renewal boolean DEFAULT false,
        renewal_notice_days integer DEFAULT 30,

        payment_terms text NOT NULL,
        payment_frequency text,

        contract_value numeric(15,2),
        monthly_value numeric(15,2),

        gst_percent numeric(5,2),

        tds_applicable boolean DEFAULT false,
        tds_percent numeric(5,2),
        tds_section varchar(10),

        default_expense_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,

        status text NOT NULL DEFAULT 'active',
        document_url text,

        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_vc_hospital ON vendor_contracts(hospital_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vc_status ON vendor_contracts(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vc_type ON vendor_contracts(contract_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vc_end_date ON vendor_contracts(end_date)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_vc_number_unique ON vendor_contracts(hospital_id, contract_number)`;

    console.log('  vendor_contracts created\n');

    // ================================================================
    // TABLE 2: vendor_invoices
    // ================================================================
    console.log('Creating vendor_invoices table...');

    await sql`
      CREATE TABLE IF NOT EXISTS vendor_invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

        contract_id uuid REFERENCES vendor_contracts(id) ON DELETE RESTRICT,
        vendor_name text NOT NULL,

        invoice_number varchar(50) NOT NULL,
        our_reference varchar(50),

        invoice_date date NOT NULL,
        due_date date NOT NULL,

        amount numeric(15,2) NOT NULL,
        gst_amount numeric(12,2) DEFAULT 0,
        tds_amount numeric(12,2) DEFAULT 0,
        net_payable numeric(15,2) NOT NULL,

        status text NOT NULL DEFAULT 'received',

        payment_scheduled_date date,
        paid_at timestamp,
        payment_method text,
        payment_reference text,

        verified_by uuid,
        verified_at timestamp,
        approved_by uuid,
        approved_at timestamp,

        expense_account_id uuid REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
        journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,

        document_url text,
        notes text,

        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS idx_vi_status ON vendor_invoices(hospital_id, status, due_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vi_contract ON vendor_invoices(contract_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vi_due_date ON vendor_invoices(due_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vi_invoice_date ON vendor_invoices(invoice_date)`;

    console.log('  vendor_invoices created\n');

    // ================================================================
    // VERIFY
    // ================================================================
    console.log('Verifying...\n');

    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('vendor_contracts', 'vendor_invoices')
      ORDER BY table_name
    `;
    console.log('  Tables created:');
    for (const t of tables) console.log(`    - ${t.table_name}`);

    const totalCount = await sql`
      SELECT COUNT(*) as cnt FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    console.log(`\n  Total tables in database: ${totalCount[0].cnt}`);

    console.log('\n' + '='.repeat(59));
    console.log('  C.3 Accounts Payable Migration Complete');
    console.log('='.repeat(59));
    console.log('\nSummary:');
    console.log('  * 2 tables created (vendor_contracts, vendor_invoices)');
    console.log('  * 5 enums created');
    console.log('  * 9 indexes created');
    console.log('\n');

    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    console.error('\nFull error:', err);
    process.exit(1);
  }
}

migrate();
