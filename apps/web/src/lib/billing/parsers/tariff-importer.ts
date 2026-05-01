// =============================================================================
// Tariff importer
// =============================================================================
// Takes parsed records (RoomTariffRecord, PackageTariffRecord,
// InvestigationTariffRecord) and writes them to BV3.1 tables idempotently.
// Every run creates one charge_master_tariff_import audit row capturing
// rows_inserted / rows_updated / rows_skipped / rows_errored.
//
// Talks to Neon directly via the @neondatabase/serverless HTTP fetch API
// (no Drizzle dep — keeps this script self-contained for CLI use).
// =============================================================================

import type {
  RoomTariffRecord,
  PackageTariffRecord,
  InvestigationTariffRecord,
} from './tariff-parser-types';

export interface ImportContext {
  database_url: string;
  hospital_id: string;
  uploaded_by_user_id?: string;
  source_filename: string;
  source_bytes?: number;
  /** When true, no INSERT/UPDATE issued; counts are simulated. */
  dry_run: boolean;
}

export interface ImportSummary {
  kind: 'rooms' | 'packages' | 'investigations';
  rows_total: number;
  rows_inserted: number;
  rows_updated: number;
  rows_skipped: number;
  rows_errored: number;
  errors: Array<{ row_key: string; reason: string }>;
  audit_row_id: string | null; // null when dry_run
  duration_ms: number;
}

// ─── thin Neon HTTP client ─────────────────────────────────────────────────
async function execSql(
  database_url: string,
  query: string,
  params: any[] = [],
): Promise<any[]> {
  const u = new URL(database_url);
  const resp = await fetch(`https://${u.hostname}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': database_url,
    },
    body: JSON.stringify({ query, params }),
  });
  if (!resp.ok) {
    throw new Error(`Neon SQL ${resp.status}: ${await resp.text()}`);
  }
  const json: any = await resp.json();
  return json.rows ?? [];
}

// ─── audit row helpers ──────────────────────────────────────────────────────
async function openAuditRow(
  ctx: ImportContext,
  kind: ImportSummary['kind'],
  rows_total: number,
): Promise<string | null> {
  if (ctx.dry_run) return null;
  const rows = await execSql(
    ctx.database_url,
    `INSERT INTO charge_master_tariff_import
       (hospital_id, import_kind, source_filename, source_bytes, rows_total,
        status, started_at, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, 'running', NOW(), $6)
     RETURNING id`,
    [
      ctx.hospital_id,
      kind,
      ctx.source_filename,
      ctx.source_bytes ?? null,
      rows_total,
      ctx.uploaded_by_user_id ?? null,
    ],
  );
  return rows[0].id;
}

async function closeAuditRow(
  ctx: ImportContext,
  audit_id: string | null,
  result: Omit<ImportSummary, 'audit_row_id' | 'duration_ms' | 'kind'>,
): Promise<void> {
  if (!audit_id || ctx.dry_run) return;
  const status =
    result.rows_errored > 0
      ? result.rows_errored === result.rows_total
        ? 'failed'
        : 'partial'
      : 'success';
  await execSql(
    ctx.database_url,
    `UPDATE charge_master_tariff_import
       SET rows_inserted = $1,
           rows_updated  = $2,
           rows_skipped  = $3,
           rows_errored  = $4,
           error_summary = $5::jsonb,
           status        = $6,
           finished_at   = NOW()
     WHERE id = $7`,
    [
      result.rows_inserted,
      result.rows_updated,
      result.rows_skipped,
      result.rows_errored,
      JSON.stringify(result.errors),
      status,
      audit_id,
    ],
  );
}

// ─── Rooms importer ─────────────────────────────────────────────────────────
export async function importRooms(
  ctx: ImportContext,
  records: RoomTariffRecord[],
): Promise<ImportSummary> {
  const t0 = Date.now();
  const audit_id = await openAuditRow(ctx, 'rooms', records.length);

  let inserted = 0,
    updated = 0,
    skipped = 0,
    errored = 0;
  const errors: ImportSummary['errors'] = [];

  for (const r of records) {
    try {
      if (ctx.dry_run) {
        // Simulate: peek existing.
        const existing = await execSql(
          ctx.database_url,
          `SELECT 1 FROM charge_master_room WHERE hospital_id = $1 AND room_class = $2 LIMIT 1`,
          [ctx.hospital_id, r.room_class],
        );
        if (existing.length > 0) updated++;
        else inserted++;
        continue;
      }
      const result = await execSql(
        ctx.database_url,
        `INSERT INTO charge_master_room
           (hospital_id, room_class, room_class_label, billing_unit, tariff)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (hospital_id, room_class)
         DO UPDATE SET
           room_class_label = EXCLUDED.room_class_label,
           billing_unit     = EXCLUDED.billing_unit,
           tariff           = EXCLUDED.tariff,
           updated_at       = NOW()
         RETURNING (xmax = 0) AS was_inserted`,
        [
          ctx.hospital_id,
          r.room_class,
          r.room_class_label,
          r.billing_unit,
          r.tariff,
        ],
      );
      if (result[0]?.was_inserted) inserted++;
      else updated++;
    } catch (err: any) {
      errored++;
      errors.push({ row_key: r.room_class, reason: err.message?.slice(0, 200) ?? String(err) });
    }
  }

  await closeAuditRow(ctx, audit_id, {
    rows_total: records.length,
    rows_inserted: inserted,
    rows_updated: updated,
    rows_skipped: skipped,
    rows_errored: errored,
    errors,
  });

  return {
    kind: 'rooms',
    rows_total: records.length,
    rows_inserted: inserted,
    rows_updated: updated,
    rows_skipped: skipped,
    rows_errored: errored,
    errors,
    audit_row_id: audit_id,
    duration_ms: Date.now() - t0,
  };
}

// ─── Packages importer ──────────────────────────────────────────────────────
export async function importPackages(
  ctx: ImportContext,
  records: PackageTariffRecord[],
): Promise<ImportSummary> {
  const t0 = Date.now();
  const audit_id = await openAuditRow(ctx, 'packages', records.length);

  let inserted = 0, updated = 0, skipped = 0, errored = 0;
  const errors: ImportSummary['errors'] = [];

  for (const r of records) {
    try {
      const inclusions = JSON.stringify({
        days: r.total_days,
        prices: r.prices,
        suite: r.suite_open_billing
          ? { open_billing: true }
          : { open_billing: false, price: r.suite_price },
      });
      // package_price = highest non-suite price as a heuristic; Finance can re-set.
      const candidatePrices = Object.values(r.prices).filter((n): n is number => typeof n === 'number');
      const package_price = candidatePrices.length > 0 ? Math.max(...candidatePrices) : 0;

      if (ctx.dry_run) {
        const existing = await execSql(
          ctx.database_url,
          `SELECT 1 FROM charge_master_package WHERE hospital_id = $1 AND package_code = $2 LIMIT 1`,
          [ctx.hospital_id, r.package_code],
        );
        if (existing.length > 0) updated++;
        else inserted++;
        continue;
      }

      const result = await execSql(
        ctx.database_url,
        `INSERT INTO charge_master_package
           (hospital_id, package_code, package_name, package_price, status,
            suite_open_billing, inclusions)
         VALUES ($1, $2, $3, $4, 'draft', $5, $6::jsonb)
         ON CONFLICT (hospital_id, package_code)
         DO UPDATE SET
           package_name        = EXCLUDED.package_name,
           package_price       = EXCLUDED.package_price,
           suite_open_billing  = EXCLUDED.suite_open_billing,
           inclusions          = EXCLUDED.inclusions,
           updated_at          = NOW()
         RETURNING (xmax = 0) AS was_inserted`,
        [
          ctx.hospital_id,
          r.package_code,
          r.package_name,
          package_price,
          r.suite_open_billing,
          inclusions,
        ],
      );
      if (result[0]?.was_inserted) inserted++;
      else updated++;
    } catch (err: any) {
      errored++;
      errors.push({ row_key: r.package_code, reason: err.message?.slice(0, 200) ?? String(err) });
    }
  }

  await closeAuditRow(ctx, audit_id, {
    rows_total: records.length,
    rows_inserted: inserted,
    rows_updated: updated,
    rows_skipped: skipped,
    rows_errored: errored,
    errors,
  });

  return {
    kind: 'packages',
    rows_total: records.length,
    rows_inserted: inserted,
    rows_updated: updated,
    rows_skipped: skipped,
    rows_errored: errored,
    errors,
    audit_row_id: audit_id,
    duration_ms: Date.now() - t0,
  };
}

// ─── Investigations importer ────────────────────────────────────────────────
export async function importInvestigations(
  ctx: ImportContext,
  records: InvestigationTariffRecord[],
): Promise<ImportSummary> {
  const t0 = Date.now();
  const audit_id = await openAuditRow(ctx, 'investigations', records.length);

  let inserted = 0, updated = 0, skipped = 0, errored = 0;
  const errors: ImportSummary['errors'] = [];

  for (const r of records) {
    try {
      // Each investigation = 1 row in charge_master_item + N rows in charge_master_price.
      let item_id: string;
      let was_inserted_item = false;

      if (ctx.dry_run) {
        const existing = await execSql(
          ctx.database_url,
          `SELECT id FROM charge_master_item WHERE hospital_id = $1 AND charge_code = $2 LIMIT 1`,
          [ctx.hospital_id, r.charge_code],
        );
        if (existing.length > 0) {
          updated++;
        } else {
          inserted++;
        }
        continue;
      }

      // Honor record's status: 'pending_finance' rows get inserted with the
      // pending_finance status sentinel and skip price writes entirely.
      const itemStatus = r.status === 'pending_finance' ? 'pending_finance' : 'active';
      const itemResult = await execSql(
        ctx.database_url,
        `INSERT INTO charge_master_item
           (hospital_id, charge_code, charge_name, category, dept_code, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (hospital_id, charge_code)
         DO UPDATE SET
           charge_name = EXCLUDED.charge_name,
           category    = EXCLUDED.category,
           dept_code   = EXCLUDED.dept_code,
           -- Preserve human-set status: only widen pending_finance → active when
           -- the parser actually has prices.
           status      = CASE
                           WHEN charge_master_item.status = 'pending_finance' AND EXCLUDED.status = 'active'
                             THEN 'active'
                           WHEN charge_master_item.status = 'pending_finance' AND EXCLUDED.status = 'pending_finance'
                             THEN 'pending_finance'
                           ELSE charge_master_item.status
                         END,
           updated_at  = NOW()
         RETURNING id, (xmax = 0) AS was_inserted`,
        [ctx.hospital_id, r.charge_code, r.charge_name, r.category, r.dept_code, itemStatus],
      );
      item_id = itemResult[0].id;
      was_inserted_item = itemResult[0].was_inserted;
      if (was_inserted_item) inserted++;
      else updated++;

      // Pending-finance rows: no prices to write, skip the price block.
      if (r.status === 'pending_finance') {
        continue;
      }

      // Close out any prior current prices for this item; they'll be re-issued.
      await execSql(
        ctx.database_url,
        `UPDATE charge_master_price
           SET effective_to = NOW()
         WHERE item_id = $1 AND effective_to IS NULL`,
        [item_id],
      );

      // Insert one current price per class.
      for (const [class_code, price] of Object.entries(r.prices)) {
        if (typeof price !== 'number' || price <= 0) continue;
        await execSql(
          ctx.database_url,
          `INSERT INTO charge_master_price
             (hospital_id, item_id, class_code, price, effective_from, effective_to)
           VALUES ($1, $2, $3, $4, NOW(), NULL)
           ON CONFLICT (item_id, class_code, effective_from) DO NOTHING`,
          [ctx.hospital_id, item_id, class_code, price.toFixed(2)],
        );
      }
    } catch (err: any) {
      errored++;
      errors.push({ row_key: r.charge_code, reason: err.message?.slice(0, 200) ?? String(err) });
    }
  }

  await closeAuditRow(ctx, audit_id, {
    rows_total: records.length,
    rows_inserted: inserted,
    rows_updated: updated,
    rows_skipped: skipped,
    rows_errored: errored,
    errors,
  });

  return {
    kind: 'investigations',
    rows_total: records.length,
    rows_inserted: inserted,
    rows_updated: updated,
    rows_skipped: skipped,
    rows_errored: errored,
    errors,
    audit_row_id: audit_id,
    duration_ms: Date.now() - t0,
  };
}
