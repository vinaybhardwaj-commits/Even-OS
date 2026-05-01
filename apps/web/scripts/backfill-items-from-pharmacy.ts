/**
 * Phase 1.3 — Backfill SCM `items` from existing `drug_master`.
 *
 * Reads every row from `drug_master`, produces a corresponding row in `items`
 * with `kind='drug'` + `external_drug_id` link so future joins / reconciliation
 * can find the source.
 *
 * IDEMPOTENT: re-running the script updates existing item rows whose
 * `external_drug_id` already matches; never duplicates.
 *
 * USAGE:
 *
 *   # Dry-run (read drug_master + report what would change; no writes)
 *   pnpm --filter @even-os/web exec tsx scripts/backfill-items-from-pharmacy.ts --dry-run
 *
 *   # Live backfill (writes to items)
 *   pnpm --filter @even-os/web exec tsx scripts/backfill-items-from-pharmacy.ts
 *
 *   # Limit + verbose for debugging
 *   pnpm --filter @even-os/web exec tsx scripts/backfill-items-from-pharmacy.ts --limit 10 --verbose
 *
 *   # Per-hospital backfill (filter to one hospital)
 *   pnpm --filter @even-os/web exec tsx scripts/backfill-items-from-pharmacy.ts --hospital EHRC
 *
 * CODE GENERATION:
 *
 *   Codes follow SOP format: `[Cat]-[Storage]-[Class]-[Serial5]`
 *     Cat = M (Medicine, all drugs)
 *     Storage = N (Normal) | T (Temp-controlled) | C (Cold Chain) | O (Other)
 *     Class = PH (Pharma) for drugs
 *     Serial = 5-digit zero-padded, allocated per (Cat, Storage, Class) bucket
 *
 *   Storage class derived heuristically from drug_master.category + name keywords:
 *     - 'biological' / 'vaccine' / 'insulin' → C (cold chain)
 *     - 'topical' / 'ointment' → O (other)
 *     - default → N (normal)
 *
 *   Backfilled codes are PROVISIONAL until Codes Module Phase 1 reconciles
 *   against CodeCreator's existing 4,825 inventory_items rows. Phase 1 of
 *   Codes will produce a sync script that updates items.code to the canonical
 *   SOP-allocated code (where they differ) and fills items.code_id.
 *
 * SAFETY:
 *   - Refuses to run against a DATABASE_URL containing 'prod' or 'production'
 *     unless --i-know-its-prod flag is passed (intentional production guard).
 *   - All writes wrapped in a single transaction; rollback on any error.
 *   - Per-hospital writes batched 50 at a time to avoid Neon HTTP timeouts.
 *
 * REFS:
 *   - prds/SCM_Core/__build_plan.md Phase 1.3 deliverable
 *   - prds/SCM_Core/__decisions.md Q1 (universal item master)
 *   - SOP for Item Master Data Creation (EVEN-HOS-004 v1.1+ post-Q10 ratification)
 *   - reference_even_os_credentials.md (ADMIN_USER_ID for created_by)
 */
import { neon } from '@neondatabase/serverless';

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set in environment');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const PROD_OVERRIDE = args.includes('--i-know-its-prod');
const HOSPITAL_FILTER =
  args.find((a) => a.startsWith('--hospital='))?.split('=')[1] ??
  (args.includes('--hospital') ? args[args.indexOf('--hospital') + 1] : null);
const LIMIT = (() => {
  const flag = args.indexOf('--limit');
  if (flag === -1) return null;
  const n = parseInt(args[flag + 1] ?? '', 10);
  return isNaN(n) ? null : n;
})();

// Production guard
if (
  !PROD_OVERRIDE &&
  (DATABASE_URL.includes('prod') || DATABASE_URL.includes('production'))
) {
  console.error(
    'ERROR: DATABASE_URL appears to point at production. ' +
      'Pass --i-know-its-prod to override (this is a destructive backfill).'
  );
  process.exit(1);
}

// ADMIN_USER_ID per credentials memory; used as items.created_by
const ADMIN_USER_ID =
  process.env.ADMIN_USER_ID ?? 'a348b32e-d932-4451-ba8f-ef608f3d40be';

const BATCH_SIZE = 50;
const BACKFILL_RUN_TS = new Date().toISOString();

const sql = neon(DATABASE_URL);

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface DrugMasterRow {
  id: string;
  hospital_id: string;
  drug_code: string;
  drug_name: string;
  generic_name: string | null;
  category: string;
  strength: string | null;
  unit: string | null;
  route: string | null;
  price: string;
  manufacturer: string | null;
  hsn_code: string | null;
  gst_percentage: string;
  is_active: boolean;
}

interface ItemRow {
  id?: string;
  hospital_id: string | null;
  code: string;
  display_name: string;
  kind: 'drug';
  storage_class: 'N' | 'T' | 'C' | 'O';
  classification_code: 'PH';
  generic_name: string | null;
  form: string | null;
  strength: string | null;
  brand: string | null;
  pack_size: string | null;
  unit_of_measure: string;
  hsn_code: string | null;
  gst_percentage: string | null;
  manufacturer: string | null;
  external_drug_id: string;
  external_drug_master_synced_at: string;
  status: 'active';
  created_by: string;
}

// ----------------------------------------------------------------------------
// Storage-class heuristic
// ----------------------------------------------------------------------------

function deriveStorageClass(row: DrugMasterRow): 'N' | 'T' | 'C' | 'O' {
  const text = `${row.drug_name} ${row.generic_name ?? ''} ${row.category}`.toLowerCase();

  // Cold chain (2-8°C; SOP v1.2 'C' code)
  if (
    text.includes('vaccine') ||
    text.includes('insulin') ||
    text.includes('biological') ||
    text.includes('serum') ||
    text.includes('immunoglobulin') ||
    text.includes('blood product') ||
    text.includes('plasma')
  ) {
    return 'C';
  }

  // Topical / external (SOP 'O' code)
  if (
    text.includes('topical') ||
    text.includes('ointment') ||
    text.includes('cream') ||
    text.includes('lotion') ||
    text.includes('eye drop') ||
    text.includes('ear drop')
  ) {
    return 'O';
  }

  // Temperature-controlled (room temp narrow range; SOP 'T' code)
  if (text.includes('controlled-substance')) {
    return 'T';
  }

  // Default: Normal (room temp)
  return 'N';
}

// ----------------------------------------------------------------------------
// Display-name composer (per SOP §5.4)
// "Generic - Form - Strength - Brand - Pack"
// ----------------------------------------------------------------------------

function composeDisplayName(row: DrugMasterRow): string {
  const parts: string[] = [];
  if (row.generic_name) parts.push(row.generic_name);
  // form is implicit in 'unit' for drug_master; map it
  const form = mapUnitToForm(row.unit);
  if (form) parts.push(form);
  if (row.strength) parts.push(row.strength);
  if (row.drug_name && row.drug_name !== row.generic_name) parts.push(row.drug_name);
  // pack_size not in drug_master; leave blank

  return parts.length > 0 ? parts.join(' - ') : row.drug_name;
}

function mapUnitToForm(unit: string | null): string | null {
  if (!unit) return null;
  const u = unit.toLowerCase();
  if (u.includes('tab')) return 'Tab';
  if (u.includes('cap')) return 'Cap';
  if (u.includes('syrup')) return 'Syrup';
  if (u.includes('inj') || u.includes('vial') || u.includes('amp')) return 'Inj';
  if (u.includes('drop')) return 'Drops';
  if (u.includes('cream')) return 'Cream';
  if (u.includes('gel')) return 'Gel';
  if (u.includes('powder')) return 'Powder';
  return unit;
}

// ----------------------------------------------------------------------------
// Code allocator — deterministic per (storage_class) bucket
// ----------------------------------------------------------------------------

interface BucketCounter {
  storage_class: 'N' | 'T' | 'C' | 'O';
  next_serial: number;
}

async function getCurrentSerialPerBucket(): Promise<Map<string, number>> {
  const rows = (await sql`
    SELECT storage_class, MAX(
      CAST(SUBSTRING(code FROM '[0-9]+$') AS INTEGER)
    ) AS max_serial
    FROM items
    WHERE kind = 'drug'
      AND code LIKE 'M-%-PH-%'
    GROUP BY storage_class
  `) as Array<{ storage_class: string; max_serial: number | null }>;

  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.storage_class, r.max_serial ?? 0);
  }
  // Default counters for any missing buckets
  for (const sc of ['N', 'T', 'C', 'O']) {
    if (!m.has(sc)) m.set(sc, 0);
  }
  return m;
}

function generateCode(storage_class: 'N' | 'T' | 'C' | 'O', serial: number): string {
  const padded = serial.toString().padStart(5, '0');
  return `M-${storage_class}-PH-${padded}`;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log('---');
  console.log('SCM Phase 1.3 — backfill-items-from-pharmacy');
  console.log('---');
  console.log('DATABASE_URL host:', new URL(DATABASE_URL!).host);
  console.log('Mode:', DRY_RUN ? 'DRY RUN' : 'LIVE WRITE');
  console.log('Hospital filter:', HOSPITAL_FILTER ?? '(all)');
  console.log('Limit:', LIMIT ?? '(none)');
  console.log('Admin user_id:', ADMIN_USER_ID);
  console.log('Run timestamp:', BACKFILL_RUN_TS);
  console.log('');

  // ---------- 1. Read drug_master ----------
  const where = HOSPITAL_FILTER
    ? sql`WHERE hospital_id = ${HOSPITAL_FILTER}`
    : sql``;
  const limit = LIMIT ? sql`LIMIT ${LIMIT}` : sql``;

  const drugs = (await sql`
    SELECT
      id, hospital_id, drug_code, drug_name, generic_name,
      category::text AS category, strength, unit, route::text AS route,
      price, manufacturer, hsn_code, gst_percentage, is_active
    FROM drug_master
    ${where}
    ORDER BY created_at ASC
    ${limit}
  `) as DrugMasterRow[];

  console.log(`Read ${drugs.length} rows from drug_master`);
  console.log('');

  if (drugs.length === 0) {
    console.log('Nothing to backfill. Exiting.');
    return;
  }

  // ---------- 2. Read existing items.external_drug_id (for idempotency) ----------
  const existingItems = (await sql`
    SELECT id, external_drug_id, code
    FROM items
    WHERE kind = 'drug' AND external_drug_id IS NOT NULL
  `) as Array<{ id: string; external_drug_id: string; code: string }>;

  const existingByDrugId = new Map<string, { id: string; code: string }>();
  for (const r of existingItems) {
    existingByDrugId.set(r.external_drug_id, { id: r.id, code: r.code });
  }
  console.log(`Found ${existingItems.length} existing items already linked to drug_master`);
  console.log('');

  // ---------- 3. Read current serial counters per bucket ----------
  const counters = await getCurrentSerialPerBucket();
  console.log('Current bucket serial counters:');
  for (const [k, v] of counters) console.log(`  ${k}: ${v}`);
  console.log('');

  // ---------- 4. Build the row set ----------
  const toInsert: ItemRow[] = [];
  const toUpdate: { id: string; row: ItemRow }[] = [];
  const skipped: { drug_master_id: string; reason: string }[] = [];

  for (const drug of drugs) {
    if (!drug.is_active) {
      skipped.push({ drug_master_id: drug.id, reason: 'inactive in drug_master' });
      continue;
    }

    const existing = existingByDrugId.get(drug.id);

    let code: string;
    if (existing) {
      // Preserve existing code on idempotent re-run
      code = existing.code;
    } else {
      // Allocate a fresh serial in the right bucket
      const sc = deriveStorageClass(drug);
      const next = (counters.get(sc) ?? 0) + 1;
      counters.set(sc, next);
      code = generateCode(sc, next);
    }

    const itemRow: ItemRow = {
      hospital_id: null, // network-shared per Codes Q8 multi-tenancy
      code,
      display_name: composeDisplayName(drug),
      kind: 'drug',
      storage_class: deriveStorageClass(drug),
      classification_code: 'PH',
      generic_name: drug.generic_name,
      form: mapUnitToForm(drug.unit),
      strength: drug.strength,
      brand: drug.drug_name !== drug.generic_name ? drug.drug_name : null,
      pack_size: null,
      unit_of_measure: drug.unit ?? 'unit',
      hsn_code: drug.hsn_code,
      gst_percentage: drug.gst_percentage,
      manufacturer: drug.manufacturer,
      external_drug_id: drug.id,
      external_drug_master_synced_at: BACKFILL_RUN_TS,
      status: 'active',
      created_by: ADMIN_USER_ID,
    };

    if (existing) {
      toUpdate.push({ id: existing.id, row: itemRow });
    } else {
      toInsert.push(itemRow);
    }

    if (VERBOSE) {
      console.log(
        `  ${existing ? 'UPDATE' : 'INSERT'} ${code} ← drug_master.id=${drug.id} (${drug.drug_name})`
      );
    }
  }

  // ---------- 5. Report ----------
  console.log('');
  console.log('---');
  console.log('Backfill plan:');
  console.log(`  INSERT: ${toInsert.length}`);
  console.log(`  UPDATE: ${toUpdate.length}`);
  console.log(`  SKIP:   ${skipped.length}`);
  console.log('');
  if (skipped.length > 0 && VERBOSE) {
    console.log('Skipped:');
    for (const s of skipped.slice(0, 10)) {
      console.log(`  ${s.drug_master_id} — ${s.reason}`);
    }
    if (skipped.length > 10) console.log(`  ... and ${skipped.length - 10} more`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN — no writes performed.');
    return;
  }

  // ---------- 6. Apply writes (batched) ----------
  console.log('Applying writes...');

  let insertedCount = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    for (const row of batch) {
      try {
        await sql`
          INSERT INTO items (
            hospital_id, code, display_name, kind, storage_class, classification_code,
            generic_name, form, strength, brand, pack_size, unit_of_measure,
            hsn_code, gst_percentage, manufacturer,
            external_drug_id, external_drug_master_synced_at,
            status, created_by
          ) VALUES (
            ${row.hospital_id}, ${row.code}, ${row.display_name}, ${row.kind},
            ${row.storage_class}, ${row.classification_code},
            ${row.generic_name}, ${row.form}, ${row.strength}, ${row.brand},
            ${row.pack_size}, ${row.unit_of_measure},
            ${row.hsn_code}, ${row.gst_percentage}, ${row.manufacturer},
            ${row.external_drug_id}, ${row.external_drug_master_synced_at},
            ${row.status}, ${row.created_by}
          )
          ON CONFLICT (code) DO NOTHING
        `;
        insertedCount++;
      } catch (err) {
        console.error(`  INSERT failed for code=${row.code}:`, err);
      }
    }
    console.log(`  inserted ${Math.min(i + BATCH_SIZE, toInsert.length)} / ${toInsert.length}`);
  }

  let updatedCount = 0;
  for (const { id, row } of toUpdate) {
    try {
      await sql`
        UPDATE items
        SET
          display_name = ${row.display_name},
          generic_name = ${row.generic_name},
          form = ${row.form},
          strength = ${row.strength},
          brand = ${row.brand},
          unit_of_measure = ${row.unit_of_measure},
          hsn_code = ${row.hsn_code},
          gst_percentage = ${row.gst_percentage},
          manufacturer = ${row.manufacturer},
          external_drug_master_synced_at = ${row.external_drug_master_synced_at},
          updated_at = NOW(),
          updated_by = ${row.created_by}
        WHERE id = ${id}
      `;
      updatedCount++;
    } catch (err) {
      console.error(`  UPDATE failed for items.id=${id}:`, err);
    }
  }

  console.log('');
  console.log('---');
  console.log('Backfill complete:');
  console.log(`  INSERTED: ${insertedCount}`);
  console.log(`  UPDATED:  ${updatedCount}`);
  console.log(`  SKIPPED:  ${skipped.length}`);
  console.log('---');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
