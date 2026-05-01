// =============================================================================
// Investigations parser
// =============================================================================
// Parses Charge Master/Tariff List - Investigations.pdf — ~1,773 rows across
// 144 pages. Three physical row patterns occur:
//
//   1. Standard inline:
//        LHA00001  LAB         ABSOLUTE EOSINOPHIL COUNT  422 528 592 656 718 656
//
//   2. Pending-finance (no prices yet):
//        ADM00007  Administrative  Medical Certificate Charges
//        AMB00034  Administrative  MLC Charges
//
//   3. Code-orphan / data-orphan pair (data on the line ABOVE the code):
//                   LAB           AMINO ACID QUALITATIVE  1755 2194 ...  2722
//        LBI00947
//
// All three are normalized to InvestigationTariffRecord. Pattern (3) was
// causing ~496 silent skips before this parser refinement (1 May 2026).
//
// Service-type recognition is longest-first: "Accident & ER" wins over
// "Accident", "Administrative Mortuary" wins over "Administrative".
// =============================================================================

import type { InvestigationTariffRecord, ParseResult } from './tariff-parser-types';
import { iterateLines } from './pdf-text-extract';
import {
  classifyServiceType,
  dept_from_code_prefix,
  matchServiceTypeAtStart,
} from './tariff-parser-types';

// Anchor: charge code = 3 letters + 5 digits at line start.
const CODE_RE = /^([A-Z]{3}\d{5})\s*/;

// Trailing 6 prices.
const PRICE = String.raw`(\d{1,8})`;
const TAIL_RE = new RegExp(
  String.raw`${PRICE}\s+${PRICE}\s+${PRICE}\s+${PRICE}\s+${PRICE}\s+${PRICE}\s*$`,
);

interface ParsedTail {
  opd: number;
  general: number;
  semi: number;
  pvt: number;
  suite: number;
  allIcu: number;
}

function parseTail(line: string): ParsedTail | null {
  const m = line.match(TAIL_RE);
  if (!m) return null;
  const [, a, b, c, d, e, f] = m;
  const nums = [a, b, c, d, e, f].map((n) => parseInt(n, 10));
  if (nums.some(Number.isNaN)) return null;
  return { opd: nums[0], general: nums[1], semi: nums[2], pvt: nums[3], suite: nums[4], allIcu: nums[5] };
}

function tailToPrices(t: ParsedTail): InvestigationTariffRecord['prices'] {
  const prices: InvestigationTariffRecord['prices'] = {};
  if (t.opd > 0) prices.OPD = t.opd;
  if (t.general > 0) prices.GENERAL = t.general;
  if (t.semi > 0) prices.SEMI_PVT = t.semi;
  if (t.pvt > 0) prices.PVT = t.pvt;
  if (t.suite > 0) prices.SUITE = t.suite;
  // Schema split: ICU + HDU both get the "All ICU" PDF column.
  if (t.allIcu > 0) {
    prices.ICU = t.allIcu;
    prices.HDU = t.allIcu;
  }
  return prices;
}

/**
 * Resolve a Service Type + Name from a "middle" string. The middle is the
 * post-code, pre-tail substring of a row line, OR the entire body of a
 * data-orphan line that has no code.
 *
 * Strategy: try multi-token longest-first matching against the known list.
 * Falls back to (a) treating the first token as Service Type if it's a
 * known unprefixed value, then (b) emitting a generic "(unknown)" if
 * nothing matches.
 */
function splitServiceTypeAndName(middle: string): { service_type: string; name: string } {
  const trimmed = middle.trim();
  const matched = matchServiceTypeAtStart(trimmed);
  if (matched) return { service_type: matched.type, name: matched.name };

  // Fallback: first token + remainder. Better than nothing for unclassified rows.
  const space = trimmed.indexOf(' ');
  if (space === -1) return { service_type: '', name: trimmed };
  return { service_type: trimmed.slice(0, space), name: trimmed.slice(space + 1).trim() };
}

export function parseInvestigationsTariff(
  layoutText: string,
): ParseResult<InvestigationTariffRecord> {
  const records: InvestigationTariffRecord[] = [];
  const skipped: ParseResult<InvestigationTariffRecord>['skipped'] = [];
  const errored: ParseResult<InvestigationTariffRecord>['errored'] = [];
  let total = 0;
  const seen = new Set<string>();

  // Materialize the full line list so we can index for orphan-pair lookups.
  const lines: Array<{ lineNo: number; line: string }> = [];
  for (const entry of iterateLines(layoutText)) lines.push(entry);

  // Track which previous line (if any) is the most recent data-orphan candidate
  // that the next code-orphan should claim. We also track which line was
  // already "consumed" as a data-orphan pair so it doesn't double-attribute.
  const consumedAsOrphanPair = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const { lineNo, line } = lines[i];
    total++;

    const codeMatch = line.match(CODE_RE);
    if (!codeMatch) {
      // Non-code line. Could be a data-orphan that the next iteration will
      // claim, or just header/footer noise. Skip — not a record.
      skipped.push({ line, reason: 'no_code', line_no: lineNo });
      continue;
    }
    const charge_code = codeMatch[1];

    if (seen.has(charge_code)) {
      // Investigations PDF has known dup codes (LMI00271 etc.). Keep first, flag rest.
      errored.push({ line, reason: `duplicate_code:${charge_code}`, line_no: lineNo });
      continue;
    }

    const codeEnd = codeMatch[0].length;
    const tailMatch = parseTail(line);

    if (tailMatch) {
      // ── Pattern 1: Standard inline ──
      const middle = line.slice(codeEnd, line.search(TAIL_RE)).trim();
      const { service_type, name } = splitServiceTypeAndName(middle);
      const cls = service_type
        ? classifyServiceType(service_type)
        : { category: 'unknown', dept_code: dept_from_code_prefix(charge_code) };

      records.push({
        charge_code,
        charge_name: name || `(unnamed ${charge_code})`,
        category: cls.category,
        dept_code: cls.dept_code,
        prices: tailToPrices(tailMatch),
        status: 'active',
        source_pattern: 'inline',
      });
      seen.add(charge_code);
      continue;
    }

    // ── No tail on this line. Could be patterns 2 or 3. ──
    const afterCode = line.slice(codeEnd).trim();

    if (afterCode.length > 3) {
      // ── Pattern 2: Pending-finance (Service Type + Name on code line, no prices) ──
      const { service_type, name } = splitServiceTypeAndName(afterCode);
      const cls = service_type
        ? classifyServiceType(service_type)
        : { category: 'unknown', dept_code: dept_from_code_prefix(charge_code) };

      records.push({
        charge_code,
        charge_name: name || `(unnamed ${charge_code})`,
        category: cls.category,
        dept_code: cls.dept_code,
        prices: {},
        status: 'pending_finance',
        source_pattern: 'pending_finance',
      });
      seen.add(charge_code);
      continue;
    }

    // ── Pattern 3: Orphan code — look at the line above for the paired data ──
    let pairedDataLineIdx = -1;
    // Walk backwards skipping blank lines.
    for (let j = i - 1; j >= 0 && j > i - 4; j--) {
      const candidate = lines[j];
      if (!candidate) continue;
      if (consumedAsOrphanPair.has(j)) break; // already taken by another code
      // The candidate must NOT itself have a code (it'd be a different row).
      if (CODE_RE.test(candidate.line)) break;
      // The candidate must have a 6-num tail.
      if (parseTail(candidate.line)) {
        pairedDataLineIdx = j;
        break;
      }
      // Otherwise keep walking back; some PDF lines have just blank visual gap.
      // Don't walk past more than ~3 lines.
    }

    if (pairedDataLineIdx >= 0) {
      const dataLine = lines[pairedDataLineIdx].line;
      const parsedTail = parseTail(dataLine)!;
      const middle = dataLine.slice(0, dataLine.search(TAIL_RE)).trim();
      const { service_type, name } = splitServiceTypeAndName(middle);
      const cls = service_type
        ? classifyServiceType(service_type)
        : { category: 'unknown', dept_code: dept_from_code_prefix(charge_code) };

      records.push({
        charge_code,
        charge_name: name || `(unnamed ${charge_code})`,
        category: cls.category,
        dept_code: cls.dept_code,
        prices: tailToPrices(parsedTail),
        status: 'active',
        source_pattern: 'orphan_pair',
      });
      seen.add(charge_code);
      consumedAsOrphanPair.add(pairedDataLineIdx);
      continue;
    }

    // No data we can attribute to this code. Genuinely no info.
    errored.push({
      line,
      reason: 'orphan_code_without_paired_data',
      line_no: lineNo,
    });
  }

  return { records, skipped, errored, lines_total: total };
}
