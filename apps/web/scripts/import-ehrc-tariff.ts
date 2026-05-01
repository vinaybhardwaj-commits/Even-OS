#!/usr/bin/env tsx
/**
 * Even OS — EHRC Charge Master tariff importer (BV3.1.A)
 *
 * Reads the 3 EHRC tariff PDFs, parses each, and writes to BV3.1 tables.
 * Idempotent: every importer uses ON CONFLICT to upsert. Every run creates
 * one charge_master_tariff_import audit row per kind.
 *
 * Usage:
 *   pnpm tsx scripts/import-ehrc-tariff.ts \
 *     --pdf-dir="/path/to/Charge Master/" \
 *     --kind=all \
 *     --dry-run
 *
 *   pnpm tsx scripts/import-ehrc-tariff.ts --pdf-dir=... --kind=all --commit
 *
 * Env required:
 *   DATABASE_URL  — Neon postgres connection string
 *
 * Env optional:
 *   HOSPITAL_ID         (default: 'EHRC')
 *   ADMIN_USER_ID       (default: null)
 *   PDFTOTEXT_BIN       (default: 'pdftotext'; needs poppler-utils)
 */

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractPdfText } from '../src/lib/billing/parsers/pdf-text-extract';
import { parseRoomTariff } from '../src/lib/billing/parsers/room-tariff-parser';
import { parsePackageTariff } from '../src/lib/billing/parsers/package-tariff-parser';
import { parseInvestigationsTariff } from '../src/lib/billing/parsers/investigations-parser';
import {
  importRooms,
  importPackages,
  importInvestigations,
  type ImportContext,
  type ImportSummary,
} from '../src/lib/billing/parsers/tariff-importer';

// ─── arg parsing ────────────────────────────────────────────────────────────
type Kind = 'rooms' | 'packages' | 'investigations' | 'all';

interface Args {
  pdf_dir: string;
  kind: Kind;
  dry_run: boolean;
  hospital_id: string;
  admin_user_id?: string;
}

function parseArgs(): Args {
  const args: Partial<Args> = {};
  let dryFlag = true; // dry by default — must opt-in with --commit
  for (const a of process.argv.slice(2)) {
    if (a === '--dry-run') dryFlag = true;
    else if (a === '--commit') dryFlag = false;
    else if (a.startsWith('--pdf-dir=')) args.pdf_dir = a.slice('--pdf-dir='.length);
    else if (a.startsWith('--kind=')) args.kind = a.slice('--kind='.length) as Kind;
    else if (a.startsWith('--hospital-id=')) args.hospital_id = a.slice('--hospital-id='.length);
    else if (a.startsWith('--admin-user-id=')) args.admin_user_id = a.slice('--admin-user-id='.length);
  }
  if (!args.pdf_dir) {
    console.error('ERROR: --pdf-dir=<path> required');
    process.exit(2);
  }
  args.kind = args.kind ?? 'all';
  args.hospital_id = args.hospital_id ?? process.env.HOSPITAL_ID ?? 'EHRC';
  args.admin_user_id = args.admin_user_id ?? process.env.ADMIN_USER_ID;
  if (!['rooms', 'packages', 'investigations', 'all'].includes(args.kind!)) {
    console.error(`ERROR: invalid --kind=${args.kind}; expected rooms|packages|investigations|all`);
    process.exit(2);
  }
  return { ...args, dry_run: dryFlag } as Args;
}

const PDF_FILENAMES: Record<Exclude<Kind, 'all'>, { filename: string; firstPage?: number; lastPage?: number }> = {
  rooms: { filename: 'Tariff List - Room Rent.pdf', firstPage: 5, lastPage: 5 },
  packages: { filename: 'Tariff List-Packages.pdf' },
  investigations: { filename: 'Tariff List - Investigations.pdf' },
};

// ─── reporting helpers ──────────────────────────────────────────────────────
function fmtSummary(s: ImportSummary): string {
  const tag = `[${s.kind}]`.padEnd(18);
  const stats = `total=${s.rows_total} inserted=${s.rows_inserted} updated=${s.rows_updated} skipped=${s.rows_skipped} errored=${s.rows_errored}`;
  const time = `(${s.duration_ms}ms${s.audit_row_id ? `, audit_row=${s.audit_row_id.slice(0, 8)}` : ', dry-run'})`;
  return `  ${tag} ${stats} ${time}`;
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL env not set.');
    process.exit(2);
  }

  console.log(`\nEHRC tariff importer — ${args.dry_run ? 'DRY RUN' : 'COMMIT'}`);
  console.log(`  pdf_dir:     ${args.pdf_dir}`);
  console.log(`  kind:        ${args.kind}`);
  console.log(`  hospital_id: ${args.hospital_id}`);
  console.log(`  database:    ${dbUrl.replace(/:[^@/]*@/, ':***@')}\n`);

  const targets: Array<Exclude<Kind, 'all'>> =
    args.kind === 'all' ? ['rooms', 'packages', 'investigations'] : [args.kind as Exclude<Kind, 'all'>];

  const summaries: ImportSummary[] = [];
  for (const k of targets) {
    const meta = PDF_FILENAMES[k];
    const path = resolve(args.pdf_dir, meta.filename);
    let bytes = 0;
    try {
      bytes = statSync(path).size;
    } catch {
      console.error(`ERROR: PDF not found: ${path}`);
      process.exit(2);
    }
    console.log(`  ${k}: extracting from ${meta.filename}...`);
    const text = await extractPdfText(path, {
      firstPage: meta.firstPage,
      lastPage: meta.lastPage,
    });

    let summary: ImportSummary;
    const ctx: ImportContext = {
      database_url: dbUrl,
      hospital_id: args.hospital_id,
      uploaded_by_user_id: args.admin_user_id,
      source_filename: meta.filename,
      source_bytes: bytes,
      dry_run: args.dry_run,
    };

    if (k === 'rooms') {
      const r = parseRoomTariff(text);
      console.log(`    parsed ${r.records.length} rooms (${r.skipped.length} skipped, ${r.errored.length} errored)`);
      summary = await importRooms(ctx, r.records);
    } else if (k === 'packages') {
      const r = parsePackageTariff(text);
      console.log(`    parsed ${r.records.length} packages (${r.skipped.length} skipped, ${r.errored.length} errored)`);
      summary = await importPackages(ctx, r.records);
    } else {
      const r = parseInvestigationsTariff(text);
      console.log(`    parsed ${r.records.length} investigations (${r.skipped.length} skipped, ${r.errored.length} errored)`);
      summary = await importInvestigations(ctx, r.records);
    }
    summaries.push(summary);
    console.log(fmtSummary(summary));
    if (summary.errors.length > 0) {
      console.log(`    First 5 errors:`);
      for (const e of summary.errors.slice(0, 5)) {
        console.log(`      ${e.row_key}: ${e.reason}`);
      }
    }
  }

  console.log('\n=== Summary ===');
  for (const s of summaries) console.log(fmtSummary(s));
  const totalErrored = summaries.reduce((acc, s) => acc + s.rows_errored, 0);
  if (totalErrored > 0) {
    console.log(`\nFinished with ${totalErrored} errored row(s) — review error_summary jsonb on audit rows.`);
    process.exit(1);
  }
  if (args.dry_run) {
    console.log('\nDry run — no DB writes issued. Re-run with --commit to apply.');
  } else {
    console.log('\nCommit complete.');
  }
}

main().catch((err) => {
  console.error('Importer crashed:', err);
  process.exit(2);
});
