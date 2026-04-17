#!/usr/bin/env node
/**
 * N.3 migration — create clinical_note_drafts table.
 * Run: DATABASE_URL='...' node scripts/n3-migrate-note-drafts.js
 */
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = neon(DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS clinical_note_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    note_type note_type NOT NULL,
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id uuid NULL,
    body jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_note_draft_slot
    ON clinical_note_drafts (patient_id, encounter_id, note_type, author_id)`,
  `CREATE INDEX IF NOT EXISTS idx_note_drafts_author
    ON clinical_note_drafts (author_id)`,
  `CREATE INDEX IF NOT EXISTS idx_note_drafts_encounter
    ON clinical_note_drafts (encounter_id)`,
];

(async () => {
  for (const s of statements) {
    const head = s.split('\n')[0].slice(0, 80);
    process.stdout.write(`exec: ${head}...`);
    try { await sql(s); console.log(' OK'); }
    catch (e) { console.log(' FAIL'); console.error(e.message); process.exit(1); }
  }
  const [{ count }] = await sql(
    `SELECT COUNT(*)::int AS count FROM information_schema.tables
     WHERE table_schema='public' AND table_name='clinical_note_drafts'`
  );
  console.log(`verify: clinical_note_drafts present: ${count === 1}`);
})();
