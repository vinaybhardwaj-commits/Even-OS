#!/usr/bin/env node
/**
 * PC.1a migration — create chart_edit_locks table (pessimistic chart lock store).
 * Run: DATABASE_URL='...' node scripts/pc1a-migrate-chart-edit-locks.js
 */
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = neon(DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS chart_edit_locks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    encounter_id uuid NULL REFERENCES encounters(id) ON DELETE CASCADE,
    surface text NOT NULL,
    locked_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    locked_by_user_name text NOT NULL,
    locked_by_user_role text NOT NULL,
    reason text NULL,
    locked_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_chart_lock_slot
    ON chart_edit_locks (patient_id, encounter_id, surface)`,
  `CREATE INDEX IF NOT EXISTS idx_chart_locks_patient
    ON chart_edit_locks (patient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chart_locks_holder
    ON chart_edit_locks (locked_by_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chart_locks_expires
    ON chart_edit_locks (expires_at)`,
];

(async () => {
  try {
    for (const stmt of statements) {
      console.log('→', stmt.split('\n')[0].trim().slice(0, 80));
      await sql.query(stmt);
    }
    const count = await sql.query(`SELECT count(*)::int AS n FROM chart_edit_locks`);
    console.log('✓ chart_edit_locks OK, rows =', count[0].n);
  } catch (err) {
    console.error('✗ migration failed:', err);
    process.exit(1);
  }
})();
