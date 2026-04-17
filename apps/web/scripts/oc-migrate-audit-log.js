#!/usr/bin/env node
/**
 * Create chat_audit_log table for immutable action tracking.
 * Run: export $(grep DATABASE_URL .env.local | tr -d '"') && node scripts/oc-migrate-audit-log.js
 */

const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1); }
const sql = neon(DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS chat_audit_log (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    user_name TEXT NOT NULL,
    hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id),
    channel_id TEXT,
    message_id INTEGER,
    target_user_id UUID,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_audit_hospital_time ON chat_audit_log(hospital_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_audit_action ON chat_audit_log(hospital_id, action)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_audit_user ON chat_audit_log(user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_audit_channel ON chat_audit_log(channel_id, created_at DESC)`,
];

async function run() {
  console.log('🚀 Creating chat_audit_log table...\n');

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 80);
    try {
      await sql(stmt);
      console.log(`  ✅ [${i + 1}/${statements.length}] ${preview}...`);
    } catch (err) {
      console.error(`  ❌ [${i + 1}/${statements.length}] ${preview}...`);
      console.error(`     ${err.message}`);
    }
  }

  // Verify
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chat_audit_log'
  `;
  console.log(`\n  ✅ chat_audit_log exists: ${tables.length > 0 ? 'YES' : 'NO'}`);
  console.log('\n✅ Done!');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
