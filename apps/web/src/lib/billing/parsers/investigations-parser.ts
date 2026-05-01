// =============================================================================
// Investigations parser
// =============================================================================
// Parses Charge Master/Tariff List - Investigations.pdf — ~1,773 rows across
// 144 pages.
//
// Layout:
//   Code       Service Type   Service Name              OPD  General Semi-Pvt Pvt  Suite All ICU
//   LHA00001   LAB            ABSOLUTE EOSINOPHIL COUNT 422  528     592      656  718   656
//
// Service Type values seen: LAB, Radiology, Cardiology, Urology, Orthopeadic,
// Accident, Administrative.
//
// Code patterns: L?? (lab), RAD, CAD, EMR, ADM, AMB, OT?, etc.
// "All ICU" column writes both ICU and HDU class prices.
// =============================================================================

import type { InvestigationTariffRecord, ParseResult } from './tariff-parser-types';
import { iterateLines } from './pdf-text-extract';
import { classifyServiceType, dept_from_code_prefix } from './tariff-parser-types';

// Anchor: charge code = 3 letters + 5 digits at line start.
const CODE_RE = /^([A-Z]{3}\d{5})\s+/;

// Trailing 6 prices.
const PRICE = String.raw`(\d{1,8})`;
const TAIL_RE = new RegExp(
  String.raw`${PRICE}\s+${PRICE}\s+${PRICE}\s+${PRICE}\s+${PRICE}\s+${PRICE}\s*$`,
);

export function parseInvestigationsTariff(
  layoutText: string,
): ParseResult<InvestigationTariffRecord> {
  const records: InvestigationTariffRecord[] = [];
  const skipped: ParseResult<InvestigationTariffRecord>['skipped'] = [];
  const errored: ParseResult<InvestigationTariffRecord>['errored'] = [];
  let total = 0;
  const seen = new Set<string>();

  for (const { lineNo, line } of iterateLines(layoutText)) {
    total++;

    const codeMatch = line.match(CODE_RE);
    if (!codeMatch) {
      skipped.push({ line, reason: 'no_code', line_no: lineNo });
      continue;
    }
    const charge_code = codeMatch[1];

    const tailMatch = line.match(TAIL_RE);
    if (!tailMatch) {
      errored.push({ line, reason: 'no_price_tail', line_no: lineNo });
      continue;
    }

    if (seen.has(charge_code)) {
      // Investigations PDF has known dup codes (e.g. LMI00271 appears twice).
      // Dedup: keep first, flag rest.
      errored.push({
        line,
        reason: `duplicate_code:${charge_code}`,
        line_no: lineNo,
      });
      continue;
    }
    seen.add(charge_code);

    // Slice out the Service Type + Service Name between the code and tail.
    const codeEnd = codeMatch[0].length;
    const tailIdx = line.search(TAIL_RE);
    if (tailIdx < 0) {
      errored.push({ line, reason: 'tail_idx_lost', line_no: lineNo });
      continue;
    }
    const middle = line.slice(codeEnd, tailIdx).trim();

    // Service Type is the first token of the middle (or first 1-3 tokens).
    // Use a known-list match against `classifyServiceType` keys.
    const knownTypes = ['LAB', 'Radiology', 'Cardiology', 'Urology', 'Orthopeadic', 'Accident', 'Administrative'];
    let service_type = '';
    let service_name = middle;
    for (const kt of knownTypes) {
      if (middle.toUpperCase().startsWith(kt.toUpperCase() + ' ')) {
        service_type = kt;
        service_name = middle.slice(kt.length).trim();
        break;
      }
    }
    if (!service_type) {
      // Some rows are all caps with the type smashed in — fall back to code-prefix.
      service_type = '';
      service_name = middle;
    }

    const { category, dept_code } = service_type
      ? classifyServiceType(service_type)
      : { category: 'unknown', dept_code: dept_from_code_prefix(charge_code) };

    // Prices: tail has 6 numbers in order: OPD, General, Semi-Pvt, Pvt, Suite, All ICU.
    const [opd, general, semi, pvt, suite, allIcu] = [
      parseInt(tailMatch[1], 10),
      parseInt(tailMatch[2], 10),
      parseInt(tailMatch[3], 10),
      parseInt(tailMatch[4], 10),
      parseInt(tailMatch[5], 10),
      parseInt(tailMatch[6], 10),
    ];

    if ([opd, general, semi, pvt, suite, allIcu].some(Number.isNaN)) {
      errored.push({ line, reason: 'price_parse_fail', line_no: lineNo });
      continue;
    }

    const prices: InvestigationTariffRecord['prices'] = {};
    if (opd > 0) prices.OPD = opd;
    if (general > 0) prices.GENERAL = general;
    if (semi > 0) prices.SEMI_PVT = semi;
    if (pvt > 0) prices.PVT = pvt;
    if (suite > 0) prices.SUITE = suite;
    // Schema split: ICU + HDU both get the "All ICU" price.
    if (allIcu > 0) {
      prices.ICU = allIcu;
      prices.HDU = allIcu;
    }

    records.push({
      charge_code,
      charge_name: service_name,
      category,
      dept_code,
      prices,
    });
  }

  return { records, skipped, errored, lines_total: total };
}
