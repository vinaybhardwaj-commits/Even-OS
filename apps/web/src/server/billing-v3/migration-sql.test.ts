import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// Billing v3 — migration SQL idempotency tests
// =============================================================================
// Sanity-check the canonical 0063 migration file against the API-route SQL
// to catch drift. Both must:
//   - Use IF NOT EXISTS for every CREATE TABLE
//   - Use IF NOT EXISTS for every CREATE INDEX
//   - Guard the self-FK on billing_charge with a NOT EXISTS DO $$ block
//   - Carry every CHECK constraint required by the schema
// =============================================================================

const ROOT = process.cwd();
const SQL_PATH = join(ROOT, 'drizzle/migrations/0063_billing_v3_foundation.sql');
const ROUTE_PATH = join(ROOT, 'src/app/api/migrations/billing-v3-foundation/route.ts');

const sql = readFileSync(SQL_PATH, 'utf8');
const route = readFileSync(ROUTE_PATH, 'utf8');

const TABLES = [
  'charge_master_item',
  'charge_master_price',
  'charge_master_package',
  'charge_master_room',
  'charge_master_tariff_import',
  'charge_master_hospital_setting',
  'discount_policy',
  'discount_application',
  'billing_charge',
  'billing_account_payer',
];

describe('0063_billing_v3_foundation.sql — table presence', () => {
  for (const t of TABLES) {
    it(`creates ${t} idempotently`, () => {
      const re = new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${t}\\b`, 'i');
      expect(sql).toMatch(re);
    });
  }
});

describe('0063_billing_v3_foundation.sql — idempotency guards', () => {
  it('every CREATE TABLE uses IF NOT EXISTS', () => {
    // Find every CREATE TABLE and assert it has IF NOT EXISTS.
    const matches = sql.match(/CREATE\s+TABLE[^(]*\(/gi) || [];
    for (const m of matches) {
      expect(m).toMatch(/IF\s+NOT\s+EXISTS/i);
    }
    expect(matches.length).toBe(TABLES.length);
  });

  it('every CREATE INDEX uses IF NOT EXISTS', () => {
    const matches = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX[^(\n]*/gi) || [];
    expect(matches.length).toBeGreaterThan(20); // sanity: at least 20 indexes
    for (const m of matches) {
      expect(m).toMatch(/IF\s+NOT\s+EXISTS/i);
    }
  });

  it('self-FK on billing_charge is guarded with NOT EXISTS', () => {
    expect(sql).toMatch(/billing_charge_reverses_charge_id_fkey/);
    expect(sql).toMatch(/IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_constraint/i);
  });

  it('contains the chk_discount_application_waiver_reason CHECK', () => {
    expect(sql).toMatch(/chk_discount_application_waiver_reason/);
  });

  it('contains the room_class CHECK with all 9 values', () => {
    expect(sql).toMatch(
      /room_class\s+IN\s*\(\s*'DAY_CARE'\s*,\s*'GENERAL'\s*,\s*'TWIN_SHARING'\s*,\s*'PRIVATE'\s*,\s*'SUITE'\s*,\s*'ICU'\s*,\s*'HDU'\s*,\s*'LABOR_OBS'\s*,\s*'ER_OBS'\s*\)/i,
    );
  });

  it('contains the source_module CHECK with all 10 values', () => {
    expect(sql).toMatch(
      /source_module\s+IN\s*\(\s*'manual'\s*,\s*'lab'\s*,\s*'pharmacy'\s*,\s*'ot'\s*,\s*'room'\s*,\s*'package'\s*,\s*'er_obs'\s*,\s*'mortuary'\s*,\s*'admission'\s*,\s*'adjustment'\s*\)/i,
    );
  });
});

describe('0063 SQL ↔ API-route SQL parity', () => {
  for (const t of TABLES) {
    it(`API route also creates ${t}`, () => {
      const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`, 'i');
      expect(route).toMatch(re);
    });
  }

  it('API route + SQL file enumerate the same table set', () => {
    const sqlTables = new Set(
      Array.from(sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)).map((m) => m[1]),
    );
    const routeTables = new Set(
      Array.from(route.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)).map((m) => m[1]),
    );
    expect([...sqlTables].sort()).toEqual([...routeTables].sort());
  });
});
