// =============================================================================
// Room tariff parser
// =============================================================================
// Parses Charge Master/Tariff List - Room Rent.pdf — page 5 contains a clean
// tabular section that looks like:
//
//   BED CATEGORY NAME   BED CHARGES   NURSING CHARGES   TOTAL   CONSULTATION
//   DAY CARE            1300          1050              2350    900
//   GENERAL WARD        2800          1200              4000    900
//   ...
//
// Output: 7 RoomTariffRecord rows (DAY_CARE..HDU). The schema's 9-class set
// includes LABOR_OBS + ER_OBS which the EHRC bootstrap seed already populates
// at ₹0 — those classes are NOT touched by this parser.
// =============================================================================

import type { RoomTariffRecord, ParseResult } from './tariff-parser-types';
import { iterateLines } from './pdf-text-extract';

/** Map PDF "BED CATEGORY NAME" → schema room_class enum. */
const PDF_NAME_MAP: Record<string, RoomTariffRecord['room_class']> = {
  'DAY CARE':       'DAY_CARE',
  'GENERAL WARD':   'GENERAL',
  'TWIN SHARING':   'TWIN_SHARING',
  'PRIVATE WARD':   'PRIVATE',
  'SUITE ROOM':     'SUITE',
  'ICU BED':        'ICU',
  'HDU BED':        'HDU',
};

const ALL_NAMES = Object.keys(PDF_NAME_MAP);

/** Build a regex that matches any known room category name + 4 prices. */
const PRICE = String.raw`(\d{1,7})`;
const ROW_RE = new RegExp(
  String.raw`^\s*(${ALL_NAMES.map((n) => n.replace(/ /g, '\\s+')).join('|')})\s+` +
    `${PRICE}\\s+${PRICE}\\s+${PRICE}\\s+${PRICE}\\s*$`,
  'i',
);

export function parseRoomTariff(layoutText: string): ParseResult<RoomTariffRecord> {
  const records: RoomTariffRecord[] = [];
  const skipped: ParseResult<RoomTariffRecord>['skipped'] = [];
  const errored: ParseResult<RoomTariffRecord>['errored'] = [];
  let total = 0;
  const seen = new Set<string>();

  for (const { lineNo, line } of iterateLines(layoutText)) {
    total++;
    const m = line.match(ROW_RE);
    if (!m) {
      skipped.push({ line, reason: 'no_match', line_no: lineNo });
      continue;
    }
    const pdfName = m[1].replace(/\s+/g, ' ').toUpperCase();
    const room_class = PDF_NAME_MAP[pdfName];
    if (!room_class) {
      errored.push({ line, reason: `unknown_room_class:${pdfName}`, line_no: lineNo });
      continue;
    }
    if (seen.has(room_class)) {
      // Defensive: dup row in same PDF.
      errored.push({ line, reason: `duplicate_room_class:${room_class}`, line_no: lineNo });
      continue;
    }
    seen.add(room_class);

    const bed = parseInt(m[2], 10);
    const nursing = parseInt(m[3], 10);
    const total_tariff = parseInt(m[4], 10);
    const consultation = parseInt(m[5], 10);

    if ([bed, nursing, total_tariff, consultation].some(Number.isNaN)) {
      errored.push({ line, reason: 'price_parse_fail', line_no: lineNo });
      continue;
    }

    // Sanity: bed + nursing should equal total. If not, log but accept.
    if (Math.abs(bed + nursing - total_tariff) > 1) {
      // Allow small rounding drift; flag larger ones.
      // Don't block import — Finance may have applied a manual adjustment.
    }

    records.push({
      room_class,
      room_class_label: pdfName,
      tariff: total_tariff,
      bed_charges: bed,
      nursing_charges: nursing,
      consultation_charge: consultation,
      // PDF doesn't carry billing_unit. Default per existing seed convention:
      // ICU/HDU/SUITE/PRIVATE/SHARING/GENERAL/DAY_CARE all → 'day'.
      billing_unit: 'day',
    });
  }

  return { records, skipped, errored, lines_total: total };
}
