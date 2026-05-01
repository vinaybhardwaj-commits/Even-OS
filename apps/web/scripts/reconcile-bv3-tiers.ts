#!/usr/bin/env tsx
/**
 * BV3 Phase 2 — Reconciliation report
 *
 * Samples N billing_charge rows that have charge_master_item_id set, follows
 * the FK bridge through charge_master_item.service_code_id → code_charge_tiers,
 * and reports the match-rate between historical line_total and the current
 * tier's price_inr.
 *
 * Read-only — issues no writes.
 *
 * Usage:
 *   DATABASE_URL='postgres://...' \
 *     pnpm tsx scripts/reconcile-bv3-tiers.ts \
 *       --hospital-id=EHRC \
 *       --sample=100
 */

interface Args { sample: number; hospital_id: string; }

function parseArgs(): Args {
  let sample = 100;
  let hospital_id = process.env.HOSPITAL_ID ?? 'EHRC';
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--sample=')) sample = parseInt(a.slice('--sample='.length), 10);
    else if (a.startsWith('--hospital-id=')) hospital_id = a.slice('--hospital-id='.length);
  }
  return { sample, hospital_id };
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

async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL not set.'); process.exit(2); }

  console.log(`\nBV3 Phase 2 reconciliation — ${args.hospital_id}`);
  console.log(`  sample size: ${args.sample}\n`);

  // 1. Total billing_charges + how many have the bridge populated
  const totals = await exec(dbUrl, `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE charge_master_item_id IS NOT NULL)::int AS with_item,
      count(DISTINCT cmi.id) FILTER (WHERE cmi.service_code_id IS NOT NULL)::int AS with_bridge
    FROM billing_charge bc
    LEFT JOIN charge_master_item cmi ON cmi.id = bc.charge_master_item_id
    WHERE bc.hospital_id = $1
  `, [args.hospital_id]);
  const t = totals[0];
  console.log(`Population:`);
  console.log(`  billing_charge total:                  ${t.total}`);
  console.log(`  with charge_master_item_id:            ${t.with_item}`);
  console.log(`  with service_code_id bridge populated: ${t.with_bridge}\n`);

  if (t.total === 0) {
    console.log('No billing_charge rows yet — bill builder hasn\'t fired. Reconciliation report empty.');
    console.log('Phase 4 (Bill builder) will be the first writer.');
    return;
  }

  // 2. Sample charges + resolve via FK chain
  const sample = await exec(dbUrl, `
    SELECT bc.id, bc.charge_code, bc.unit_price, bc.line_total,
           bc.posted_at, bc.room_class_at_post, bc.charge_master_item_id,
           cmi.service_code_id
      FROM billing_charge bc
      LEFT JOIN charge_master_item cmi ON cmi.id = bc.charge_master_item_id
     WHERE bc.hospital_id = $1
       AND bc.charge_master_item_id IS NOT NULL
     ORDER BY random()
     LIMIT $2
  `, [args.hospital_id, args.sample]);

  let matches = 0, mismatches = 0, noBridge = 0, noTier = 0;
  const mismatchSamples: Array<{ charge_id: string; expected: string; actual: string }> = [];

  for (const ch of sample) {
    if (!ch.service_code_id) { noBridge++; continue; }

    const tiers = await exec(dbUrl, `
      SELECT id, price_inr, class_code, effective_from, effective_to, empanelment_id
        FROM code_charge_tiers
       WHERE service_id = $1 AND hospital_id = $2 AND empanelment_id IS NULL
    `, [ch.service_code_id, args.hospital_id]);

    const classCode = ch.room_class_at_post ?? 'GENERAL';
    const postedAt = new Date(ch.posted_at).getTime();
    const matching = tiers.filter((t: any) =>
      t.class_code === classCode &&
      new Date(t.effective_from).getTime() <= postedAt &&
      (t.effective_to == null || new Date(t.effective_to).getTime() >= postedAt),
    );

    if (matching.length === 0) { noTier++; continue; }
    matching.sort((a: any, b: any) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime());
    const expected = parseFloat(matching[0].price_inr).toFixed(2);
    const actual = parseFloat(ch.unit_price).toFixed(2);
    if (expected === actual) {
      matches++;
    } else {
      mismatches++;
      if (mismatchSamples.length < 10) {
        mismatchSamples.push({ charge_id: ch.id, expected, actual });
      }
    }
  }

  console.log(`Reconciliation results (sample ${sample.length}):`);
  console.log(`  matches:            ${matches}  (${sample.length > 0 ? ((matches / sample.length) * 100).toFixed(1) : 0}%)`);
  console.log(`  mismatches:         ${mismatches}`);
  console.log(`  no service_code:    ${noBridge}`);
  console.log(`  no tier in window:  ${noTier}`);

  if (mismatchSamples.length > 0) {
    console.log(`\nFirst ${mismatchSamples.length} mismatches:`);
    for (const m of mismatchSamples) {
      console.log(`  ${m.charge_id}  expected=${m.expected}  actual=${m.actual}`);
    }
  }
}

main().catch((err) => { console.error('Reconciliation crashed:', err); process.exit(2); });
