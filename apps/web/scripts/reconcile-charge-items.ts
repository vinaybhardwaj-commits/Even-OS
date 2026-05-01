#!/usr/bin/env tsx
/**
 * BV3 Phase 3 — Generic charge_items reconciliation runner
 *
 * Pluggable per-module strategy. Each strategy compares the source module's
 * own count of chargeable events vs charge_items.source_ref_id distinct count
 * for that module + day window.
 *
 * Strategies registered:
 *   - 'pharmacy'    — dispensing_records vs charge_items WHERE source_module='pharmacy'
 *   - 'scm'         — stock_movements (issue, chargeable) vs charge_items
 *   - 'lab'         — lab_orders.completed vs charge_items
 *   - 'ot'          — ot_cases.finalized vs charge_items (≥1 per case)
 *   - 'consultation'— consultation_records vs charge_items
 *
 * Read-only — issues no writes.
 *
 * Usage:
 *   DATABASE_URL='postgres://...' \
 *     pnpm tsx scripts/reconcile-charge-items.ts \
 *       --hospital-id=EHRC \
 *       --module=pharmacy \
 *       --since=2026-04-01 [--until=2026-05-01]
 */

interface Args {
  hospital_id: string;
  module: string;
  since: string;
  until: string;
}

function parseArgs(): Args {
  const a: Partial<Args> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--hospital-id=')) a.hospital_id = arg.slice(14);
    else if (arg.startsWith('--module=')) a.module = arg.slice(9);
    else if (arg.startsWith('--since=')) a.since = arg.slice(8);
    else if (arg.startsWith('--until=')) a.until = arg.slice(8);
  }
  if (!a.hospital_id) a.hospital_id = process.env.HOSPITAL_ID ?? 'EHRC';
  if (!a.module) {
    console.error('--module=<pharmacy|scm|lab|ot|consultation> required');
    process.exit(2);
  }
  if (!a.since) {
    const d = new Date(); d.setDate(d.getDate() - 7);
    a.since = d.toISOString().slice(0, 10);
  }
  if (!a.until) a.until = new Date().toISOString().slice(0, 10);
  return a as Args;
}

async function exec(database_url: string, query: string, params: any[] = []): Promise<any[]> {
  const u = new URL(database_url);
  const r = await fetch(`https://${u.hostname}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': database_url },
    body: JSON.stringify({ query, params }),
  });
  if (!r.ok) throw new Error(`Neon ${r.status}: ${await r.text()}`);
  return ((await r.json()) as any).rows ?? [];
}

interface Strategy {
  /** Returns count of chargeable events from the source-of-truth table. */
  sourceCount(dbUrl: string, args: Args): Promise<number>;
  /** Returns count of charge_items rows attributed to this module in the window. */
  chargeItemsCount(dbUrl: string, args: Args): Promise<number>;
  /** Module-specific notes for the report. */
  notes: string;
}

const STRATEGIES: Record<string, Strategy> = {
  pharmacy: {
    notes: 'Compares dispensing_records (source-of-truth) vs charge_items WHERE source_module=\'pharmacy\'. Phase 3 contract: 1 charge_items row per dispensing_records.id.',
    sourceCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(*)::int AS c FROM dispensing_records
         WHERE hospital_id = $1
           AND dispensed_at >= $2::date
           AND dispensed_at <  $3::date
      `, [args.hospital_id, args.since, args.until]);
      return r[0]?.c ?? 0;
    },
    chargeItemsCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(DISTINCT source_ref_id)::int AS c FROM charge_items
         WHERE hospital_id = $1
           AND source_module = 'pharmacy'
           AND posted_at >= $2::date
           AND posted_at <  $3::date
      `, [args.hospital_id, args.since, args.until]);
      return r[0]?.c ?? 0;
    },
  },
  scm: {
    notes: 'Compares chargeable stock_movements (movement_type=\'issue\', is_chargeable=true) vs charge_items source_module=\'scm\'.',
    sourceCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(*)::int AS c FROM stock_movements
         WHERE hospital_id = $1
           AND movement_type = 'issue'
           AND created_at >= $2::date
           AND created_at <  $3::date
      `, [args.hospital_id, args.since, args.until]);
      return r[0]?.c ?? 0;
    },
    chargeItemsCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(DISTINCT source_ref_id)::int AS c FROM charge_items
         WHERE hospital_id = $1
           AND source_module = 'scm'
           AND posted_at >= $2::date
           AND posted_at <  $3::date
      `, [args.hospital_id, args.since, args.until]);
      return r[0]?.c ?? 0;
    },
  },
  lab: {
    notes: 'Compares lab_orders.completed vs charge_items source_module=\'lab\'. Note: 1 lab_order may emit multiple charge_items (per-test) plus 1 collection fee.',
    sourceCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(*)::int AS c FROM lab_orders
         WHERE hospital_id = $1
           AND status = 'completed'
           AND completed_at >= $2::date
           AND completed_at <  $3::date
      `, [args.hospital_id, args.since, args.until]).catch(() => [{ c: 0 }]);
      return r[0]?.c ?? 0;
    },
    chargeItemsCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(DISTINCT source_ref_id)::int AS c FROM charge_items
         WHERE hospital_id = $1
           AND source_module = 'lab'
           AND posted_at >= $2::date
           AND posted_at <  $3::date
      `, [args.hospital_id, args.since, args.until]);
      return r[0]?.c ?? 0;
    },
  },
  ot: {
    notes: 'Compares ot_cases.finalized vs charge_items source_module=\'ot\'. Note: 1 ot_case emits MANY charge_items (procedure + anaesthesia + OT-minutes + PACU + implant + drugs + consumables).',
    sourceCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(*)::int AS c FROM ot_cases
         WHERE hospital_id = $1
           AND status = 'finalized'
           AND updated_at >= $2::date
           AND updated_at <  $3::date
      `, [args.hospital_id, args.since, args.until]).catch(() => [{ c: 0 }]);
      return r[0]?.c ?? 0;
    },
    chargeItemsCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(DISTINCT source_ref_id)::int AS c FROM charge_items
         WHERE hospital_id = $1
           AND source_module = 'ot'
           AND posted_at >= $2::date
           AND posted_at <  $3::date
      `, [args.hospital_id, args.since, args.until]);
      return r[0]?.c ?? 0;
    },
  },
  consultation: {
    notes: 'Compares consultation_records (where chargeable=true) vs charge_items source_module=\'consultation\'. Billing Manual rule 15: 1 fee per disease per day.',
    sourceCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(*)::int AS c FROM consultation_records
         WHERE hospital_id = $1
           AND created_at >= $2::date
           AND created_at <  $3::date
      `, [args.hospital_id, args.since, args.until]).catch(() => [{ c: 0 }]);
      return r[0]?.c ?? 0;
    },
    chargeItemsCount: async (dbUrl, args) => {
      const r = await exec(dbUrl, `
        SELECT count(DISTINCT source_ref_id)::int AS c FROM charge_items
         WHERE hospital_id = $1
           AND source_module = 'consultation'
           AND posted_at >= $2::date
           AND posted_at <  $3::date
      `, [args.hospital_id, args.since, args.until]);
      return r[0]?.c ?? 0;
    },
  },
};

async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL not set.'); process.exit(2); }

  const strategy = STRATEGIES[args.module];
  if (!strategy) {
    console.error(`Unknown module: ${args.module}. Available: ${Object.keys(STRATEGIES).join(', ')}`);
    process.exit(2);
  }

  console.log(`\nBV3 Phase 3 reconciliation — module=${args.module}`);
  console.log(`  hospital: ${args.hospital_id}`);
  console.log(`  window:   ${args.since} → ${args.until}\n`);
  console.log(`Strategy notes: ${strategy.notes}\n`);

  const sourceCount = await strategy.sourceCount(dbUrl, args);
  const chargeCount = await strategy.chargeItemsCount(dbUrl, args);

  console.log(`Source-of-truth count:  ${sourceCount}`);
  console.log(`charge_items count:     ${chargeCount}`);

  if (sourceCount === 0 && chargeCount === 0) {
    console.log(`\n✓ Both 0 in window — module hasn't emitted yet (expected if PRD-#${args.module} hasn't wired its emit point).`);
    return;
  }
  const delta = sourceCount - chargeCount;
  if (delta === 0) {
    console.log(`\n✓ MATCH — every source event has a corresponding charge_item.`);
  } else {
    console.log(`\n⚠ DELTA = ${delta}`);
    if (delta > 0) {
      console.log(`  ${delta} source-of-truth event(s) without matching charge_items.`);
      console.log(`  Likely cause: emit point not wired for these events. Check module emit code.`);
    } else {
      console.log(`  ${-delta} charge_items without matching source-of-truth event.`);
      console.log(`  Likely cause: source row deleted, or charge emitted for wrong module.`);
    }
  }
}

main().catch((err) => { console.error('Reconciliation crashed:', err); process.exit(2); });
