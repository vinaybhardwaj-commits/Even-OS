/**
 * BV3.2.A — parse Tariff List - Room Rent.pdf
 *
 * Input:
 *   Daily Dash EHRC/Charge Master/Tariff List - Room Rent.pdf
 *
 * Output:
 *   out/room-rent.json  — array of ParsedRoomRow
 *   out/room-rent.csv   — import-ready CSV for `charge_master_room` (+ audit cols)
 *
 * The PDF has a 7-row table under heading "ROOM TARIFF 2025" with columns:
 *   BED CATEGORY NAME · BED CHARGES · NURSING CHARGES · TOTAL · CONSULTATION
 *
 * The 7 categories in the PDF map to 7 of the 9 room classes in
 * `charge_master_room.room_class` (LABOR_OBS and ER_OBS are NOT in the
 * current PDF — they stay at the BV3.1.E seeded ₹0 default).
 *
 * BV3.2.B's `promote` step will UPSERT by (hospital_id, room_class).
 *
 * Usage (from apps/web):
 *   pnpm exec tsx scripts/parse-charge-master/parse-room-rent.ts
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParsedRoomRow, ParseSummary, RoomClass } from './types';
import { pdfToText, writeCsv, writeJson, toInt, logSummary } from './util';

const __filename = typeof __dirname !== 'undefined'
  ? path.join(__dirname, 'parse-room-rent.ts')
  : fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..');
const DEFAULT_PDF = path.resolve(
  REPO_ROOT, '..', '..', 'mnt', 'Daily Dash EHRC',
  'Charge Master', 'Tariff List - Room Rent.pdf',
);

/** PDF "BED CATEGORY NAME" → schema `room_class`. */
const CLASS_MAP: Record<string, { room_class: RoomClass; label: string }> = {
  'DAY CARE':      { room_class: 'DAY_CARE',     label: 'Day Care' },
  'GENERAL WARD':  { room_class: 'GENERAL',      label: 'General Ward' },
  'TWIN SHARING':  { room_class: 'TWIN_SHARING', label: 'Twin Sharing' },
  'PRIVATE WARD':  { room_class: 'PRIVATE',      label: 'Private Ward' },
  'SUITE ROOM':    { room_class: 'SUITE',        label: 'Suite Room' },
  'ICU BED':       { room_class: 'ICU',          label: 'ICU Bed' },
  'HDU BED':       { room_class: 'HDU',          label: 'HDU Bed' },
};

export function parseRoomRent(pdfPath: string = DEFAULT_PDF): {
  rows: ParsedRoomRow[];
  summary: ParseSummary;
} {
  const started = Date.now();
  const text = pdfToText(pdfPath);
  const rows: ParsedRoomRow[] = [];

  // Match each line with a known category name + 4 trailing integers.
  // Tolerates variable whitespace.  Numbers may have commas (none expected, but safe).
  const categories = Object.keys(CLASS_MAP);
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const match = categories.find(c => line.toUpperCase().startsWith(c));
    if (!match) continue;
    const rest = line.slice(match.length).trim();
    // 4 integers: BED · NURSING · TOTAL · CONSULTATION
    const nums = rest.match(/(\d[\d,]*)/g);
    if (!nums || nums.length < 4) continue;
    const [bed, nursing, total, consultation] = nums.slice(0, 4).map(toInt);
    const mapped = CLASS_MAP[match];
    rows.push({
      room_class: mapped.room_class,
      room_class_label: mapped.label,
      tariff: total, // TOTAL is the billable room rent (bed + nursing)
      bed_charges: bed,
      nursing_charges: nursing,
      consultation,
    });
  }

  const outDir = path.join(SCRIPT_DIR, 'out');
  const jsonPath = path.join(outDir, 'room-rent.json');
  const csvPath = path.join(outDir, 'room-rent.csv');
  writeJson(jsonPath, rows);
  writeCsv(csvPath, rows as unknown as Record<string, unknown>[]);

  return {
    rows,
    summary: {
      source_file: pdfPath,
      parsed: rows.length,
      rejected: 0,
      duration_ms: Date.now() - started,
      output_json: jsonPath,
      output_csv: csvPath,
    },
  };
}

// Allow running directly:  `tsx parse-room-rent.ts`
const isMain = (() => {
  if (typeof require !== 'undefined' && require.main === module) return true;
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch { return false; }
})();

if (isMain) {
  const pdfArg = process.argv[2] || DEFAULT_PDF;
  const { rows, summary } = parseRoomRent(pdfArg);
  logSummary(summary);
  if (rows.length !== 7) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ Expected 7 room rows, got ${rows.length}. Review ${summary.output_json}.`);
    process.exit(1);
  }
}
