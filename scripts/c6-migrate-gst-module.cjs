// C.6 — GST Module migration
// 3 tables, 4 enums, 11 indexes
const { neon } = require('@neondatabase/serverless');
const DATABASE_URL = 'postgresql://neondb_owner:npg_qarlg8EbTX7D@ep-flat-violet-a1jl3kpp-pooler.ap-southeast-1.aws.neon.tech/even_os?sslmode=require';

async function migrate() {
  const sql = neon(DATABASE_URL);
  console.log('C.6 — GST Module migration starting...');

  const enums = [
    `DO $$ BEGIN CREATE TYPE gst_return_type AS ENUM ('gstr_1','gstr_3b'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE gst_return_status AS ENUM ('draft','generated','reviewed','filed','revised'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE itc_status AS ENUM ('available','claimed','reversed','ineligible'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE gst_recon_status AS ENUM ('matched','mismatch','pending','resolved'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ];
  for (const e of enums) await sql(e);
  console.log('  4 enums created');

  await sql(`
    CREATE TABLE IF NOT EXISTS gst_returns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,
      return_type gst_return_type NOT NULL,
      period_month INTEGER NOT NULL,
      period_year INTEGER NOT NULL,
      period_label TEXT NOT NULL,
      data JSONB NOT NULL,
      total_taxable_value NUMERIC(16,2),
      total_cgst NUMERIC(14,2),
      total_sgst NUMERIC(14,2),
      total_igst NUMERIC(14,2),
      total_cess NUMERIC(14,2),
      total_tax NUMERIC(14,2),
      status gst_return_status NOT NULL DEFAULT 'draft',
      filed_date TEXT,
      filed_arn TEXT,
      notes TEXT,
      generated_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  gst_returns created');

  await sql(`
    CREATE TABLE IF NOT EXISTS itc_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,
      vendor_invoice_id UUID,
      vendor_name TEXT NOT NULL,
      vendor_gstin TEXT,
      invoice_number TEXT NOT NULL,
      invoice_date TEXT NOT NULL,
      taxable_value NUMERIC(14,2) NOT NULL,
      cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
      sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
      igst NUMERIC(14,2) NOT NULL DEFAULT 0,
      cess NUMERIC(14,2) NOT NULL DEFAULT 0,
      total_itc NUMERIC(14,2) NOT NULL,
      hsn_code TEXT,
      gst_rate NUMERIC(5,2),
      claim_month INTEGER NOT NULL,
      claim_year INTEGER NOT NULL,
      status itc_status NOT NULL DEFAULT 'available',
      reversal_reason TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  itc_ledger created');

  await sql(`
    CREATE TABLE IF NOT EXISTS gst_reconciliation (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,
      period_month INTEGER NOT NULL,
      period_year INTEGER NOT NULL,
      books_taxable NUMERIC(16,2) NOT NULL,
      books_tax NUMERIC(14,2) NOT NULL,
      return_taxable NUMERIC(16,2),
      return_tax NUMERIC(14,2),
      taxable_diff NUMERIC(16,2),
      tax_diff NUMERIC(14,2),
      status gst_recon_status NOT NULL DEFAULT 'pending',
      resolution_notes TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  gst_reconciliation created');

  const indexes = [
    `CREATE INDEX IF NOT EXISTS gst_ret_hospital_idx ON gst_returns(hospital_id)`,
    `CREATE INDEX IF NOT EXISTS gst_ret_type_idx ON gst_returns(hospital_id, return_type)`,
    `CREATE INDEX IF NOT EXISTS gst_ret_period_idx ON gst_returns(period_year, period_month)`,
    `CREATE INDEX IF NOT EXISTS gst_ret_status_idx ON gst_returns(status)`,
    `CREATE INDEX IF NOT EXISTS itc_hospital_idx ON itc_ledger(hospital_id)`,
    `CREATE INDEX IF NOT EXISTS itc_vendor_inv_idx ON itc_ledger(vendor_invoice_id)`,
    `CREATE INDEX IF NOT EXISTS itc_period_idx ON itc_ledger(claim_year, claim_month)`,
    `CREATE INDEX IF NOT EXISTS itc_status_idx ON itc_ledger(hospital_id, status)`,
    `CREATE INDEX IF NOT EXISTS itc_gstin_idx ON itc_ledger(vendor_gstin)`,
    `CREATE INDEX IF NOT EXISTS gst_recon_hospital_idx ON gst_reconciliation(hospital_id)`,
    `CREATE INDEX IF NOT EXISTS gst_recon_period_idx ON gst_reconciliation(period_year, period_month)`,
  ];
  for (const idx of indexes) await sql(idx);
  console.log('  11 indexes created');

  const countResult = await sql(`SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  console.log(`\n  Total tables in database: ${countResult[0].cnt}`);
  console.log('C.6 migration complete!');
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
