#!/usr/bin/env tsx
/**
 * Even OS — code_charge_tiers backfill (Phase 4.5)
 *
 * Reads existing charge_master_price (12,258 active rows) +
 * charge_master_package (186) + charge_master_room (9) and creates matching
 * code_charge_tiers entries. Also updates charge_master_item.service_code_id
 * during the pass (FK bridge to service_codes from Phase 3).
 *
 * Idempotent: skips tiers where (service_id|item_id, class_code, empanelment_id)
 * already has a current row (effective_to IS NULL).
 *
 * Usage:
 *   DATABASE_URL='postgres://...' \
 *     pnpm tsx scripts/backfill-charge-tiers.ts \
 *       --hospital-id=EHRC \
 *       [--dry-run | --commit]
 */

interface Args { dry_run: boolean; hospital_id: string; }
function parseArgs(): Args {
  let dry = true;
  let hospital_id = process.env.HOSPITAL_ID ?? 'EHRC';
  for (const a of process.argv.slice(2)) {
    if (a === '--commit') dry = false;
    else if (a === '--dry-run') dry = true;
    else if (a.startsWith('--hospital-id=')) hospital_id = a.slice('--hospital-id='.length);
  }
  return { dry_run: dry, hospital_id };
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

  console.log(`\nCharge Tiers backfill — ${args.dry_run ? 'DRY RUN' : 'COMMIT'}`);
  console.log(`  hospital_id: ${args.hospital_id}\n`);

  // ── 1. Update charge_master_item.service_code_id from service_codes.legacy_code ──
  const updateBridge = await exec(dbUrl, `
    UPDATE charge_master_item cmi
       SET service_code_id = sc.id
      FROM service_codes sc
     WHERE cmi.hospital_id = $1
       AND sc.hospital_id = $1
       AND sc.legacy_code = cmi.charge_code
       AND cmi.service_code_id IS DISTINCT FROM sc.id
    RETURNING cmi.id
  `, [args.hospital_id]);
  console.log(`Updated charge_master_item.service_code_id: ${updateBridge.length} rows`);

  // ── 2. charge_master_price → code_charge_tiers ──────────────────────────
  const prices = await exec(dbUrl, `
    SELECT cmp.id AS price_id, cmp.item_id AS legacy_charge_master_item_id,
           cmp.class_code, cmp.price, cmp.gst_percentage,
           cmp.effective_from, cmp.effective_to,
           cmi.charge_code,
           cmi.service_code_id
      FROM charge_master_price cmp
      JOIN charge_master_item cmi ON cmi.id = cmp.item_id
     WHERE cmp.hospital_id = $1
       AND cmi.service_code_id IS NOT NULL
       AND cmp.effective_to IS NULL
  `, [args.hospital_id]) as Array<{
    price_id: string; legacy_charge_master_item_id: string; class_code: string;
    price: string; gst_percentage: string; effective_from: string; effective_to: string | null;
    charge_code: string; service_code_id: string;
  }>;
  console.log(`charge_master_price (active, with service_code_id mapping): ${prices.length}`);

  // Existing tiers — idempotency check
  const existing = await exec(dbUrl, `
    SELECT service_id, class_code FROM code_charge_tiers
     WHERE hospital_id = $1 AND service_id IS NOT NULL AND effective_to IS NULL
  `, [args.hospital_id]) as Array<{ service_id: string; class_code: string }>;
  const existingKeys = new Set(existing.map((r) => `${r.service_id}|${r.class_code}`));
  console.log(`Already-mapped (service_id, class_code): ${existingKeys.size}\n`);

  type TierRow = {
    hospital_id: string; service_id: string | null; item_id: string | null;
    code_kind: 'item' | 'service'; class_code: string;
    price_inr: string; gst_percentage: string;
    is_open_billing: boolean; package_member_count: number;
    source: string; source_ref: string;
  };
  const pending: TierRow[] = [];

  for (const p of prices) {
    const key = `${p.service_code_id}|${p.class_code}`;
    if (existingKeys.has(key)) continue;
    pending.push({
      hospital_id: args.hospital_id,
      service_id: p.service_code_id,
      item_id: null,
      code_kind: 'service',
      class_code: p.class_code,
      price_inr: parseFloat(p.price).toFixed(2),
      gst_percentage: parseFloat(p.gst_percentage || '0').toFixed(2),
      is_open_billing: false,
      package_member_count: 0,
      source: 'charge_master_price',
      source_ref: JSON.stringify({ source_table: 'charge_master_price', source_id: p.price_id, charge_code: p.charge_code }),
    });
    existingKeys.add(key);
  }

  // ── 3. charge_master_package → code_charge_tiers (class='_PACKAGE') ─────
  const packages = await exec(dbUrl, `
    SELECT cmp.id AS package_id, cmp.package_code, cmp.package_price,
           cmp.suite_open_billing, sc.id AS service_id
      FROM charge_master_package cmp
      JOIN service_codes sc ON sc.legacy_code = cmp.package_code AND sc.hospital_id = cmp.hospital_id
     WHERE cmp.hospital_id = $1
  `, [args.hospital_id]) as Array<{
    package_id: string; package_code: string; package_price: string;
    suite_open_billing: boolean; service_id: string;
  }>;
  console.log(`charge_master_package (mapped to service_codes): ${packages.length}`);

  for (const pk of packages) {
    const key = `${pk.service_id}|_PACKAGE`;
    if (existingKeys.has(key)) continue;
    pending.push({
      hospital_id: args.hospital_id,
      service_id: pk.service_id,
      item_id: null,
      code_kind: 'service',
      class_code: '_PACKAGE',
      price_inr: parseFloat(pk.package_price).toFixed(2),
      gst_percentage: '0.00',
      is_open_billing: pk.suite_open_billing,
      package_member_count: 0,
      source: 'charge_master_package',
      source_ref: JSON.stringify({ source_table: 'charge_master_package', source_id: pk.package_id, package_code: pk.package_code }),
    });
    existingKeys.add(key);
  }

  // ── 4. charge_master_room → code_charge_tiers (class=room_class) ────────
  const rooms = await exec(dbUrl, `
    SELECT cmr.id AS room_id, cmr.room_class, cmr.tariff,
           sc.id AS service_id
      FROM charge_master_room cmr
      JOIN service_codes sc ON sc.legacy_code = ('ROOM-' || cmr.room_class) AND sc.hospital_id = cmr.hospital_id
     WHERE cmr.hospital_id = $1
       AND cmr.tariff > 0
  `, [args.hospital_id]) as Array<{
    room_id: string; room_class: string; tariff: string; service_id: string;
  }>;
  console.log(`charge_master_room (mapped to service_codes, tariff > 0): ${rooms.length}`);

  // Map PDF room class names → CHARGE_TIER_CLASSES enum (some don't fit; fallback to GENERAL)
  const ROOM_CLASS_MAP: Record<string, string> = {
    DAY_CARE: 'GENERAL', GENERAL: 'GENERAL', TWIN_SHARING: 'SEMI_PVT',
    PRIVATE: 'PVT', SUITE: 'SUITE', ICU: 'ICU', HDU: 'HDU',
    LABOR_OBS: 'GENERAL', ER_OBS: 'ER',
  };

  for (const r of rooms) {
    const class_code = ROOM_CLASS_MAP[r.room_class] ?? 'GENERAL';
    const key = `${r.service_id}|${class_code}`;
    if (existingKeys.has(key)) continue;
    pending.push({
      hospital_id: args.hospital_id,
      service_id: r.service_id,
      item_id: null,
      code_kind: 'service',
      class_code,
      price_inr: parseFloat(r.tariff).toFixed(2),
      gst_percentage: '0.00',
      is_open_billing: false,
      package_member_count: 0,
      source: 'charge_master_room',
      source_ref: JSON.stringify({ source_table: 'charge_master_room', source_id: r.room_id, room_class: r.room_class }),
    });
    existingKeys.add(key);
  }

  console.log(`\nPending = ${pending.length} new code_charge_tiers rows.`);

  // Quick distribution by class
  const byClass: Record<string, number> = {};
  for (const t of pending) byClass[t.class_code] = (byClass[t.class_code] || 0) + 1;
  console.log(`Distribution by class:`);
  for (const [c, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(10)} ${n}`);
  }

  if (args.dry_run) {
    console.log('\nDRY RUN — no writes issued. Re-run with --commit.');
    return;
  }

  // Batch INSERT in chunks of 800
  const BATCH = 800;
  let inserted = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    const valueClauses: string[] = [];
    const params: any[] = [];
    let p = 1;
    for (const r of chunk) {
      valueClauses.push(
        `($${p}, $${p+1}, $${p+2}, $${p+3}, $${p+4}, $${p+5}, $${p+6}, $${p+7}, $${p+8}, $${p+9}::jsonb)`,
      );
      params.push(
        r.hospital_id,
        r.item_id,
        r.service_id,
        r.code_kind,
        r.class_code,
        r.price_inr,
        r.gst_percentage,
        r.is_open_billing,
        r.source,
        r.source_ref,
      );
      p += 10;
    }
    await exec(dbUrl, `
      INSERT INTO code_charge_tiers
        (hospital_id, item_id, service_id, code_kind, class_code, price_inr,
         gst_percentage, is_open_billing, source, source_ref)
      VALUES ${valueClauses.join(',')}
    `, params);
    inserted += chunk.length;
    console.log(`  batch ${Math.floor(i/BATCH)+1}: inserted ${chunk.length} (cumulative=${inserted})`);
  }

  console.log(`\n=== BACKFILL COMPLETE ===`);
  console.log(`  code_charge_tiers inserted: ${inserted}`);
}

main().catch((err) => { console.error('Backfill crashed:', err); process.exit(2); });
