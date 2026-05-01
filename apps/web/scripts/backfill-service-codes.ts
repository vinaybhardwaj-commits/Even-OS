#!/usr/bin/env tsx
/**
 * Even OS — Service Codes backfill (Phase 3.5)
 *
 * Reads existing charge_master_item / _package / _room rows and creates
 * matching service_codes entries with status='active'. Idempotent —
 * existing service_codes rows (matched by legacy_code) are skipped.
 *
 * Usage:
 *   DATABASE_URL='postgres://...' \
 *     pnpm tsx scripts/backfill-service-codes.ts \
 *       --hospital-id=EHRC \
 *       [--dry-run | --commit]
 *
 * Default: dry-run.
 */

import {
  classifyTariffItem,
  classifyTariffPackage,
  classifyTariffRoom,
  buildServiceCode,
  bucketKey,
} from '../src/lib/codes/service-code-utils';

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

interface NextSerialResult {
  bucket: string;
  next_serial: number;
}

/** Reserve N consecutive serials for a bucket atomically. Returns starting serial. */
async function reserveSerials(database_url: string, bucket: string, count: number): Promise<number> {
  if (count <= 0) return 1;
  const rows = await exec(
    database_url,
    `INSERT INTO service_serial_counters (bucket, last_serial)
     VALUES ($1, $2)
     ON CONFLICT (bucket) DO UPDATE
       SET last_serial = service_serial_counters.last_serial + $2,
           updated_at = NOW()
     RETURNING last_serial`,
    [bucket, count],
  );
  const last = rows[0].last_serial as number;
  return last - count + 1; // first serial of the reserved range
}

async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL not set.'); process.exit(2); }

  console.log(`\nService Codes backfill — ${args.dry_run ? 'DRY RUN' : 'COMMIT'}`);
  console.log(`  hospital_id: ${args.hospital_id}`);
  console.log(`  database:    ${dbUrl.replace(/:[^@/]*@/, ':***@')}\n`);

  // ── 1. Pull existing charge_master_item / _package / _room ─────────────
  const items = await exec(dbUrl, `
    SELECT id, charge_code, charge_name, category, dept_code, status
    FROM charge_master_item
    WHERE hospital_id = $1
    ORDER BY charge_code
  `, [args.hospital_id]) as Array<{
    id: string; charge_code: string; charge_name: string;
    category: string; dept_code: string; status: string;
  }>;

  const packages = await exec(dbUrl, `
    SELECT id, package_code, package_name, package_price, suite_open_billing
    FROM charge_master_package
    WHERE hospital_id = $1
    ORDER BY package_code
  `, [args.hospital_id]) as Array<{
    id: string; package_code: string; package_name: string;
    package_price: string; suite_open_billing: boolean;
  }>;

  const rooms = await exec(dbUrl, `
    SELECT id, room_class, room_class_label, billing_unit, tariff
    FROM charge_master_room
    WHERE hospital_id = $1
    ORDER BY room_class
  `, [args.hospital_id]) as Array<{
    id: string; room_class: string; room_class_label: string;
    billing_unit: string; tariff: string;
  }>;

  console.log(`Source rows: items=${items.length} packages=${packages.length} rooms=${rooms.length}\n`);

  // ── 2. Pull existing service_codes for idempotency check ────────────────
  const existing = await exec(dbUrl, `
    SELECT legacy_code FROM service_codes WHERE hospital_id = $1 AND legacy_code IS NOT NULL
  `, [args.hospital_id]) as Array<{ legacy_code: string }>;
  const existingLegacy = new Set(existing.map((r) => r.legacy_code));
  console.log(`Already-mapped legacy codes: ${existingLegacy.size}\n`);

  // ── 3. Classify everything + group by bucket ────────────────────────────
  type Pending = {
    legacy_code: string;
    legacy_id: string;
    service_type_code: string;
    department_code: string;
    service_name: string;
    package_subtype: string;
    source_label: 'charge_master_item' | 'charge_master_package' | 'charge_master_room';
    is_chargeable: boolean;
    package_type: string;
    is_orderable: boolean;
  };
  const pending: Pending[] = [];

  for (const it of items) {
    if (existingLegacy.has(it.charge_code)) continue;
    const cls = classifyTariffItem({
      category: it.category,
      dept_code: it.dept_code,
      charge_code: it.charge_code,
    });
    pending.push({
      legacy_code: it.charge_code,
      legacy_id: it.id,
      service_type_code: cls.service_type_code,
      department_code: cls.department_code,
      service_name: it.charge_name,
      package_subtype: '',
      source_label: 'charge_master_item',
      is_chargeable: true,
      package_type: 'NA',
      is_orderable: it.status === 'active',
    });
  }
  for (const p of packages) {
    if (existingLegacy.has(p.package_code)) continue;
    const cls = classifyTariffPackage(p.package_code);
    pending.push({
      legacy_code: p.package_code,
      legacy_id: p.id,
      service_type_code: cls.service_type_code,
      department_code: cls.department_code,
      service_name: p.package_name,
      package_subtype: p.suite_open_billing ? 'open_billing_suite' : 'fixed_price',
      source_label: 'charge_master_package',
      is_chargeable: true,
      package_type: 'ipd',
      is_orderable: true,
    });
  }
  for (const r of rooms) {
    const legacyCode = `ROOM-${r.room_class}`; // synthesize legacy code
    if (existingLegacy.has(legacyCode)) continue;
    const cls = classifyTariffRoom(r.room_class);
    pending.push({
      legacy_code: legacyCode,
      legacy_id: r.id,
      service_type_code: cls.service_type_code,
      department_code: cls.department_code,
      service_name: r.room_class_label,
      package_subtype: '',
      source_label: 'charge_master_room',
      is_chargeable: true,
      package_type: 'NA',
      is_orderable: true,
    });
  }

  // ── 4. Group by bucket; bucket-counter reservation ──────────────────────
  const byBucket = new Map<string, Pending[]>();
  for (const p of pending) {
    const k = bucketKey({ service_type_code: p.service_type_code as any, department_code: p.department_code });
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k)!.push(p);
  }

  console.log(`Pending = ${pending.length} new service_codes to allocate across ${byBucket.size} buckets:`);
  for (const [k, list] of byBucket.entries()) console.log(`  ${k.padEnd(12)} ${list.length}`);
  console.log('');

  if (args.dry_run) {
    console.log('DRY RUN — no writes issued. Re-run with --commit.');
    return;
  }

  // ── 5. Open audit row in charge_master_tariff_import ────────────────────
  const auditRow = (await exec(dbUrl, `
    INSERT INTO charge_master_tariff_import
      (hospital_id, import_kind, source_filename, rows_total, status, started_at, uploaded_by)
    VALUES ($1, 'items', 'service_codes_backfill', $2, 'running', NOW(), $3)
    RETURNING id
  `, [args.hospital_id, pending.length, process.env.ADMIN_USER_ID ?? null]))[0].id;
  console.log(`Audit row: ${auditRow}\n`);

  // ── 6. Reserve serials per bucket + batched INSERT into service_codes ───
  let inserted = 0;
  const errors: Array<{ row_key: string; reason: string }> = [];

  for (const [bucket, list] of byBucket.entries()) {
    const startSerial = await reserveSerials(dbUrl, bucket, list.length);
    console.log(`  bucket ${bucket}: starting serial ${startSerial} for ${list.length} rows`);

    // Build batched VALUES insert for this bucket
    const valueClauses: string[] = [];
    const params: any[] = [];
    let p = 1;
    list.forEach((row, idx) => {
      const serial = startSerial + idx;
      const code = buildServiceCode({
        service_type_code: row.service_type_code as any,
        department_code: row.department_code,
        serial,
      });
      valueClauses.push(
        `($${p}, $${p+1}, $${p+2}, $${p+3}, $${p+4}, $${p+5}, $${p+6}, 'active', $${p+7}, $${p+8}, $${p+9}, ` +
        `'charge_master_backfill', $${p+10}::jsonb)`,
      );
      params.push(
        args.hospital_id,
        code,
        row.service_type_code,
        row.department_code,
        serial,
        row.service_name,
        row.legacy_code,
        row.is_orderable,
        row.is_chargeable,
        row.package_type,
        JSON.stringify({ source_table: row.source_label, source_id: row.legacy_id }),
      );
      p += 11;
    });

    try {
      const sql = `
        INSERT INTO service_codes
          (hospital_id, service_code, service_type_code, department_code,
           serial, service_name, legacy_code, status,
           is_orderable, is_chargeable, package_type,
           source, source_ref)
        VALUES ${valueClauses.join(',')}
      `;
      await exec(dbUrl, sql, params);
      inserted += list.length;
    } catch (err: any) {
      console.error(`  bucket ${bucket} INSERT failed: ${err.message}`);
      errors.push({ row_key: bucket, reason: err.message?.slice(0, 200) ?? String(err) });
    }
  }

  // ── 7. Close audit row ──────────────────────────────────────────────────
  const status = errors.length > 0 ? (errors.length === byBucket.size ? 'failed' : 'partial') : 'success';
  await exec(dbUrl, `
    UPDATE charge_master_tariff_import
       SET rows_inserted = $1, rows_updated = 0, rows_skipped = 0,
           rows_errored = $2, error_summary = $3::jsonb,
           status = $4, finished_at = NOW()
     WHERE id = $5
  `, [inserted, errors.length, JSON.stringify(errors), status, auditRow]);

  console.log(`\n=== BACKFILL COMPLETE ===`);
  console.log(`  service_codes inserted: ${inserted}`);
  console.log(`  bucket errors:          ${errors.length}`);
  console.log(`  audit row:              ${auditRow}`);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(2);
});
