#!/usr/bin/env tsx
/**
 * Cleanup the 8 placeholder test rows CodeCreator left in inventory_items.
 *
 * Per PRD §3 ("8 test rows in codecreator-source need cleanup"):
 *   `hgdfhgdh-Lozenge-657mg-jhfghfh-1's`,
 *   `Conc1-Tablet-101mg-BrandX1-10's`, etc.
 *
 * These were created by CodeCreator during dev. They have source='codecreator'
 * and obviously synthetic names. This script removes the 8 rows + their
 * compositions + decrements the corresponding inventory_serial_counters.
 *
 * Idempotent. Dry-run by default; pass --apply to commit. Production-guard:
 * refuses to run against URLs containing 'prod' / 'production' unless
 * --i-know-its-prod is passed.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-codecreator-test-rows.ts            # dry-run
 *   pnpm tsx scripts/cleanup-codecreator-test-rows.ts --apply
 */
import { neon } from '@neondatabase/serverless';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROD_OVERRIDE = args.includes('--i-know-its-prod');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}
if ((url.includes('prod') || url.includes('production')) && !PROD_OVERRIDE) {
  console.error('Refusing to run against URL containing prod/production. Pass --i-know-its-prod to override.');
  process.exit(1);
}

const sql = neon(url);

// The 8 placeholder display-name patterns (case-insensitive).
// CodeCreator's test rows have obviously synthetic display names per PRD §3.
// We identify them by source='codecreator' AND display_name LIKE one of these patterns.
const PATTERNS = [
  '%hgdfhgdh%',
  '%jhfghfh%',
  '%Conc1%',
  '%BrandX1%',
];

async function main() {
  console.log(`[cleanup] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} url=${url.replace(/\/\/[^@]+@/, '//<creds>@')}`);

  // Find candidate rows
  const candidates = await sql`
    SELECT id, item_code, item_display_name, category_code, storage_code, classification_code, source, created_at
    FROM inventory_items
    WHERE source = 'codecreator'
      AND (
        item_display_name ILIKE ${PATTERNS[0]}
        OR item_display_name ILIKE ${PATTERNS[1]}
        OR item_display_name ILIKE ${PATTERNS[2]}
        OR item_display_name ILIKE ${PATTERNS[3]}
      )
    ORDER BY created_at ASC
  ` as Array<{ id: string; item_code: string; item_display_name: string; category_code: string; storage_code: string; classification_code: string; source: string; created_at: string }>;

  console.log(`[cleanup] found ${candidates.length} candidate placeholder rows:`);
  for (const c of candidates) {
    console.log(`  - ${c.item_code} :: ${c.item_display_name}`);
  }

  if (candidates.length === 0) {
    console.log('[cleanup] nothing to clean — done.');
    return;
  }

  if (!APPLY) {
    console.log('[cleanup] dry-run only. Pass --apply to delete.');
    return;
  }

  // Delete in 3 steps:
  //   1. compositions cascade via inventory_compositions FK on item_id
  //   2. inventory_items rows themselves
  //   3. (note) inventory_serial_counters NOT decremented — counters are
  //      monotonic; resetting them would break later codes. The 8 deleted
  //      serial numbers are gaps in the bucket — that's OK.
  let deleted = 0;
  for (const c of candidates) {
    // Compositions cascade automatically via FK ON DELETE CASCADE
    const r = await sql`DELETE FROM inventory_items WHERE id = ${c.id} RETURNING id`;
    if ((r as any[]).length === 1) deleted++;
  }
  console.log(`[cleanup] deleted ${deleted} placeholder rows. Serial counter gaps are intentional (monotonic).`);
}

main().catch((e) => {
  console.error('[cleanup] failed:', e);
  process.exit(1);
});
