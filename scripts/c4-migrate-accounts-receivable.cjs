// C.4 — Accounts Receivable migration
// 3 tables, 5 enums, 14 indexes
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = 'postgresql://neondb_owner:npg_qarlg8EbTX7D@ep-flat-violet-a1jl3kpp-pooler.ap-southeast-1.aws.neon.tech/even_os?sslmode=require';

async function migrate() {
  const sql = neon(DATABASE_URL);
  console.log('C.4 — Accounts Receivable migration starting...');

  // ── Enums ──
  const enums = [
    `DO $$ BEGIN CREATE TYPE ar_type AS ENUM ('patient','insurance'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE ar_status AS ENUM ('open','partially_paid','paid','written_off','disputed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE ar_aging_bucket AS ENUM ('current','1_30','31_60','61_90','91_plus'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE collection_action_type AS ENUM ('phone_call','sms','email','letter','dunning_notice','legal_notice','write_off_request','escalation','note'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    `DO $$ BEGIN CREATE TYPE payment_match_status AS ENUM ('matched','partial','unidentified','overpayment'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ];

  for (const e of enums) {
    await sql(e);
  }
  console.log('  5 enums created');

  // ── Table 1: ar_ledger ──
  await sql(`
    CREATE TABLE IF NOT EXISTS ar_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,

      ar_type ar_type NOT NULL,
      ar_number TEXT NOT NULL,

      patient_id UUID,
      patient_name TEXT,
      encounter_id UUID,
      billing_account_id UUID,
      invoice_number TEXT,

      insurance_claim_id UUID,
      tpa_name TEXT,
      policy_number TEXT,
      claim_number TEXT,

      original_amount NUMERIC(14,2) NOT NULL,
      paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      adjusted_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      outstanding_amount NUMERIC(14,2) NOT NULL,

      invoice_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      last_payment_date TEXT,

      aging_bucket ar_aging_bucket NOT NULL DEFAULT 'current',
      days_outstanding INTEGER NOT NULL DEFAULT 0,

      status ar_status NOT NULL DEFAULT 'open',

      gl_account_id UUID,
      journal_entry_id UUID,

      last_collection_date TEXT,
      collection_attempts INTEGER NOT NULL DEFAULT 0,
      assigned_collector UUID,

      notes TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ar_ledger created');

  // ── Table 2: ar_collection_actions ──
  await sql(`
    CREATE TABLE IF NOT EXISTS ar_collection_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,
      ar_ledger_id UUID NOT NULL,

      action_type collection_action_type NOT NULL,
      action_date TEXT NOT NULL,
      scheduled_date TEXT,
      completed BOOLEAN NOT NULL DEFAULT false,
      outcome TEXT,
      notes TEXT,

      performed_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ar_collection_actions created');

  // ── Table 3: ar_payment_matches ──
  await sql(`
    CREATE TABLE IF NOT EXISTS ar_payment_matches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hospital_id TEXT NOT NULL,

      ar_ledger_id UUID,
      payment_reference TEXT NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT,
      payer_name TEXT,

      amount NUMERIC(14,2) NOT NULL,
      matched_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      unmatched_amount NUMERIC(14,2) NOT NULL DEFAULT 0,

      match_status payment_match_status NOT NULL DEFAULT 'unidentified',

      journal_entry_id UUID,

      matched_by UUID,
      matched_at TIMESTAMPTZ,
      notes TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('  ar_payment_matches created');

  // ── Indexes ──
  const indexes = [
    `CREATE INDEX IF NOT EXISTS ar_ledger_hospital_idx ON ar_ledger(hospital_id)`,
    `CREATE INDEX IF NOT EXISTS ar_ledger_type_idx ON ar_ledger(hospital_id, ar_type)`,
    `CREATE INDEX IF NOT EXISTS ar_ledger_status_idx ON ar_ledger(hospital_id, status)`,
    `CREATE INDEX IF NOT EXISTS ar_ledger_aging_idx ON ar_ledger(hospital_id, aging_bucket)`,
    `CREATE INDEX IF NOT EXISTS ar_ledger_patient_idx ON ar_ledger(patient_id)`,
    `CREATE INDEX IF NOT EXISTS ar_ledger_claim_idx ON ar_ledger(insurance_claim_id)`,
    `CREATE INDEX IF NOT EXISTS ar_ledger_due_date_idx ON ar_ledger(due_date)`,
    `CREATE INDEX IF NOT EXISTS ar_collection_ar_id_idx ON ar_collection_actions(ar_ledger_id)`,
    `CREATE INDEX IF NOT EXISTS ar_collection_scheduled_idx ON ar_collection_actions(hospital_id, scheduled_date)`,
    `CREATE INDEX IF NOT EXISTS ar_payment_hospital_idx ON ar_payment_matches(hospital_id)`,
    `CREATE INDEX IF NOT EXISTS ar_payment_ar_id_idx ON ar_payment_matches(ar_ledger_id)`,
    `CREATE INDEX IF NOT EXISTS ar_payment_status_idx ON ar_payment_matches(hospital_id, match_status)`,
    `CREATE INDEX IF NOT EXISTS ar_payment_date_idx ON ar_payment_matches(payment_date)`,
  ];

  for (const idx of indexes) {
    await sql(idx);
  }
  console.log('  13 indexes created');

  // ── Verify table count ──
  const countResult = await sql(`SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  console.log(`\n  Total tables in database: ${countResult[0].cnt}`);
  console.log('C.4 migration complete!');
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
