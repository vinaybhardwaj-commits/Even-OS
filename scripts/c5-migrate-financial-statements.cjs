// C.5 — Financial Statements migration
// 2 tables, 3 enums, 8 indexes
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_qarlg8EbTX7D@ep-flat-violet-a1jl3kpp-pooler.ap-southeast-1.aws.neon.tech/even_os?sslmode=require';

async function migrate() {
  const sql = neon(DATABASE_URL);
  console.log('C.5 — Financial Statements migration starting...');

  // ── Enums ──
  const enums = [
    `DO $$ BEGIN CREATE TYPE fin_statement_type AS ENUM ('income_statement','balance_sheet','cash_flow','trial_balance'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE fin_statement_status AS ENUM ('draft','reviewed','approved','published'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE budget_status AS ENUM ('draft','approved','revised'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ];
  for (const e of enums) await sql(e);
  console.log('  3 enums created');

  // ── Table 1: financial_statements ──
  await sql(`
    CREATE TABLE IF NOT EXISTS financial_statements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,
      statement_type fin_statement_type NOT NULL,
      title TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      comparison_period_start TEXT,
      comparison_period_end TEXT,
      data JSONB NOT NULL,
      is_balanced BOOLEAN NOT NULL DEFAULT true,
      total_debit NUMERIC(16,2),
      total_credit NUMERIC(16,2),
      net_profit NUMERIC(16,2),
      status fin_statement_status NOT NULL DEFAULT 'draft',
      notes TEXT,
      generated_by UUID,
      reviewed_by UUID,
      reviewed_at TIMESTAMPTZ,
      approved_by UUID,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  financial_statements created');

  // ── Table 2: budget_entries ──
  await sql(`
    CREATE TABLE IF NOT EXISTS budget_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,
      account_id UUID NOT NULL,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      budget_amount NUMERIC(14,2) NOT NULL,
      revised_amount NUMERIC(14,2),
      status budget_status NOT NULL DEFAULT 'draft',
      notes TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  budget_entries created');

  // ── Indexes ──
  const indexes = [
    `CREATE INDEX IF NOT EXISTS fin_stmt_hospital_idx ON financial_statements(hospital_id)`,
    `CREATE INDEX IF NOT EXISTS fin_stmt_type_idx ON financial_statements(hospital_id, statement_type)`,
    `CREATE INDEX IF NOT EXISTS fin_stmt_period_idx ON financial_statements(period_start, period_end)`,
    `CREATE INDEX IF NOT EXISTS fin_stmt_status_idx ON financial_statements(status)`,
    `CREATE INDEX IF NOT EXISTS budget_hospital_idx ON budget_entries(hospital_id)`,
    `CREATE INDEX IF NOT EXISTS budget_account_idx ON budget_entries(account_id)`,
    `CREATE INDEX IF NOT EXISTS budget_period_idx ON budget_entries(hospital_id, period_start)`,
    `CREATE INDEX IF NOT EXISTS budget_acct_period_idx ON budget_entries(account_id, period_start)`,
  ];
  for (const idx of indexes) await sql(idx);
  console.log('  8 indexes created');

  const countResult = await sql(`SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  console.log(`\n  Total tables in database: ${countResult[0].cnt}`);
  console.log('C.5 migration complete!');
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
