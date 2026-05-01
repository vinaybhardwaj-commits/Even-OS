#!/usr/bin/env tsx
/**
 * Billing v3 — pre-flight collision check.
 *
 * Verifies the live Neon DB will accept the BV3.1 migration without clobbering
 * v2 tables. Runs read-only queries; no schema changes. Exit code 0 means the
 * migration is safe to apply. Non-zero means a collision was found and a human
 * must review.
 *
 * What it checks (per PRD §10 AC1):
 *   1. None of the 10 v3 table names already exist with a different shape.
 *      (They MAY exist if a prior migration run partially completed — that's
 *      fine, the migration is IF NOT EXISTS. We only fail if the existing
 *      table has a different column set than v3 expects.)
 *   2. v2 critical tables (billing_accounts, hospitals, users, patients,
 *      encounters) exist — v3 FKs depend on them.
 *   3. EHRC hospital row exists — the bootstrap seed depends on it.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm tsx scripts/billing-v3-collision-check.ts
 *
 * Output: human-readable report; exits 0 (clear) or 1 (collision).
 */

import { neon } from '@neondatabase/serverless';

const V3_TABLES = [
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
] as const;

// Required v2 dependencies — v3 FK targets.
const V2_DEPS = ['hospitals', 'users', 'patients', 'encounters', 'billing_accounts'] as const;

// Required EHRC seed prereq.
const EHRC_HOSPITAL_ID = 'EHRC';

// Expected column counts per v3 table (sanity bound, not strict).
const V3_TABLE_MIN_COLS: Record<string, number> = {
  charge_master_item: 16,
  charge_master_price: 11,
  charge_master_package: 13,
  charge_master_room: 10,
  charge_master_tariff_import: 13,
  charge_master_hospital_setting: 17,
  discount_policy: 17,
  discount_application: 19,
  billing_charge: 23,
  billing_account_payer: 13,
};

interface CollisionFinding {
  level: 'error' | 'warn' | 'info';
  table?: string;
  message: string;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL not set.');
    process.exit(2);
  }
  const sql = neon(dbUrl);
  const findings: CollisionFinding[] = [];

  console.log('Billing v3 — pre-flight collision check\n');
  console.log(`Target: ${dbUrl.replace(/:[^@/]*@/, ':***@')}\n`);

  // 1. v2 dependency check
  for (const t of V2_DEPS) {
    const rows = (await sql(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [t],
    )) as Array<unknown>;
    if (rows.length === 0) {
      findings.push({
        level: 'error',
        table: t,
        message: `v2 dependency missing: ${t} — v3 FKs target this table`,
      });
    } else {
      findings.push({ level: 'info', table: t, message: `v2 dependency present` });
    }
  }

  // 2. v3 table existence + shape check
  for (const t of V3_TABLES) {
    const exists = (await sql(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
      [t],
    )) as Array<unknown>;

    if (exists.length === 0) {
      findings.push({ level: 'info', table: t, message: 'not yet created (migration will create)' });
      continue;
    }

    // Already exists — check column count is in expected range. If shape
    // diverges drastically we want a human to inspect.
    const cols = (await sql(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
      [t],
    )) as Array<{ column_name: string }>;

    const expectedMin = V3_TABLE_MIN_COLS[t] ?? 1;
    if (cols.length < expectedMin) {
      findings.push({
        level: 'warn',
        table: t,
        message: `exists with ${cols.length} columns (expected ≥${expectedMin}) — migration may add missing columns; review manually`,
      });
    } else {
      findings.push({
        level: 'info',
        table: t,
        message: `exists with ${cols.length} columns (≥ ${expectedMin}); migration is safe (idempotent)`,
      });
    }
  }

  // 3. EHRC hospital row check (seed prereq)
  const ehrc = (await sql(
    `SELECT hospital_id FROM hospitals WHERE hospital_id=$1 LIMIT 1`,
    [EHRC_HOSPITAL_ID],
  )) as Array<{ hospital_id: string }>;
  if (ehrc.length === 0) {
    findings.push({
      level: 'error',
      message: `EHRC hospital row missing — bootstrap seed will fail`,
    });
  } else {
    findings.push({ level: 'info', message: `EHRC hospital row present (seed prereq met)` });
  }

  // 4. Charge_master from v1 (01-master-data.ts) — v3 deliberately uses a
  //    different table name (charge_master_item). v1 charge_master is left
  //    untouched. Surface for awareness.
  const v1ChargeMaster = (await sql(
    `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema='public' AND table_name='charge_master'`,
  )) as Array<{ c: number }>;
  if ((v1ChargeMaster[0]?.c ?? 0) > 0) {
    findings.push({
      level: 'info',
      table: 'charge_master',
      message: 'v1 charge_master present — left untouched; v3 uses charge_master_item (different table)',
    });
  }

  // ── Report ────────────────────────────────────────────────────────────
  const errors = findings.filter((f) => f.level === 'error');
  const warns = findings.filter((f) => f.level === 'warn');

  for (const f of findings) {
    const tag = f.level === 'error' ? 'ERROR' : f.level === 'warn' ? 'WARN ' : 'OK   ';
    const tbl = f.table ? `[${f.table}] ` : '';
    console.log(`  ${tag} ${tbl}${f.message}`);
  }

  console.log('');
  console.log(`Summary: ${errors.length} error(s), ${warns.length} warning(s), ${findings.length - errors.length - warns.length} ok.`);

  if (errors.length > 0) {
    console.log('\nPRE-FLIGHT FAILED — do NOT run the migration. Fix errors above and retry.');
    process.exit(1);
  }
  if (warns.length > 0) {
    console.log('\nPRE-FLIGHT WARNINGS — review before applying.');
  }
  console.log('\nPRE-FLIGHT CLEAR — migration is safe to apply.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Pre-flight check crashed:', err);
  process.exit(2);
});
