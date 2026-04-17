// C.7 Migration — Accounting Periods (period close workflow)
// Run: NODE_PATH=apps/web/node_modules node scripts/c7-migrate-accounting-periods.cjs

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_qarlg8EbTX7D@ep-flat-violet-a1jl3kpp-pooler.ap-southeast-1.aws.neon.tech/even_os?sslmode=require';

async function migrate() {
  const sql = neon(DATABASE_URL);

  console.log('C.7 — Accounting Periods migration starting...');

  // 1. Enum
  await sql`DO $$ BEGIN CREATE TYPE accounting_period_status AS ENUM ('open', 'soft_closed', 'hard_closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
  console.log('  ✓ Enum: accounting_period_status');

  // 2. accounting_periods table
  await sql`
    CREATE TABLE IF NOT EXISTS accounting_periods (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,

      period_name VARCHAR(50) NOT NULL,
      period_code VARCHAR(10) NOT NULL,
      fiscal_year INTEGER NOT NULL,
      period_month INTEGER NOT NULL,
      period_year INTEGER NOT NULL,

      start_date DATE NOT NULL,
      end_date DATE NOT NULL,

      status TEXT NOT NULL DEFAULT 'open',

      soft_closed_by UUID,
      soft_closed_at TIMESTAMPTZ,
      soft_close_notes TEXT,

      hard_closed_by UUID,
      hard_closed_at TIMESTAMPTZ,
      hard_close_notes TEXT,

      reopened_by UUID,
      reopened_at TIMESTAMPTZ,
      reopen_reason TEXT,

      close_summary JSONB,

      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `;
  console.log('  ✓ Table: accounting_periods');

  // 3. Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_acct_period_hospital ON accounting_periods(hospital_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_acct_period_status ON accounting_periods(hospital_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_acct_period_year ON accounting_periods(hospital_id, fiscal_year)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_acct_period_code_unique ON accounting_periods(hospital_id, period_code)`;
  console.log('  ✓ 4 indexes created');

  // Count tables
  const countResult = await sql`SELECT count(*) as cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  console.log(`\n✅ C.7 migration complete. Total tables: ${countResult[0].cnt}`);
}

migrate().catch(console.error);
