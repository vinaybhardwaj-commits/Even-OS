#!/usr/bin/env node
/**
 * PC.2c1 migration — add formula_ref column to calculators table.
 * Run: DATABASE_URL='...' node scripts/pc2c1-migrate-calculator-formula-ref.js
 */
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = neon(DATABASE_URL);

const statements = [
  `ALTER TABLE calculators ADD COLUMN IF NOT EXISTS formula_ref text NULL`,
  `COMMENT ON COLUMN calculators.formula_ref IS
    'Optional named-formula key. When set, scoring engine dispatches to lib/calculators/formulas[formula_ref] instead of running rule-based scoring. Used for non-linear calculators like MELD 3.0.'`,
];

(async () => {
  try {
    for (const stmt of statements) {
      console.log('→', stmt.split('\n')[0].trim().slice(0, 80));
      await sql.query(stmt);
    }
    const check = await sql.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'calculators' AND column_name = 'formula_ref'`
    );
    console.log('✓ formula_ref column present:', check);
  } catch (err) {
    console.error('✗ migration failed:', err);
    process.exit(1);
  }
})();
