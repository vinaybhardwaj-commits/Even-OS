// =============================================================================
// Package tariff parser
// =============================================================================
// Parses Charge Master/Tariff List-Packages.pdf — table layout:
//
//                                                                            Open       ← stray
//   8   ENT  ENT-PKG-008  MASTOIDECTOMY - ENT PKG     2  0  122000  132500  159000
//                                                                            Billing    ← stray
//
// "Open Billing" is the Suite column; pdftotext renders it as two physical
// stray lines that we filter. The CODE_RE-anchored line carries the tail of
// 5 numbers (DAYS, ICU, GENERAL, SEMI_PVT, PVT) when Suite=open; or 6 numbers
// (..., SUITE) when Suite is a fixed price.
//
// For packages whose name wraps:
//                       MICROLARYNGEAL SURGERIES FOR CYSTS AND POLYPS -
//   10  ENT  ENT-PKG-010                                              2  0  70000  80000  96000
//                       ENT PKG
//
// the parser stitches the name from adjacent lines (the row above + the row
// below the code-line, filtering out "Open" / "Billing" stray markers).
// =============================================================================

import type { PackageTariffRecord, ParseResult } from './tariff-parser-types';

const CODE_RE = /\b([A-Z][A-Z0-9]{0,8})-PKG-(\d{2,4})\b/i;

/** 6 trailing numbers = Suite has a fixed price. */
const TAIL_6 = /(\d{1,3})\s+(\d{1,8})\s+(\d{1,8})\s+(\d{1,8})\s+(\d{1,8})\s+(\d{1,8})\s*$/;
/** 5 trailing numbers = Suite is "Open Billing". */
const TAIL_5 = /(\d{1,3})\s+(\d{1,8})\s+(\d{1,8})\s+(\d{1,8})\s+(\d{1,8})\s*$/;

/** Lines that are sole-token continuation noise from the Suite column. */
const STRAY_RE = /^\s*(open|billing|continued)\s*$/i;

/** Header / footer noise to strip from name candidates. Also strips
 * standalone "Open" / "Billing" tokens that wrap from the Suite column
 * and end up interleaved into the name.
 */
const NOISE_RE = /\b(SL|DEPT|CODES|Item Name|Total|Days|ICU|General|Spvt|Pvt|Suite|TARIFF\s*\d{4}\s*-?\d*|Package\s+Tariff|IP\s+PACKAGES|Open|Billing|Vascular\s+Surgery)\b/gi;

/** Final scrub: collapse repeated whitespace, trim trailing punctuation drift. */
function scrubName(s: string): string {
  return s
    .replace(NOISE_RE, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-,&/]+|[\s\-,&/]+$/g, '')
    .replace(/\s+(\d{1,4})\s*$/, '') // trailing stray number (e.g. "...PKG 202")
    .trim();
}

export function parsePackageTariff(layoutText: string): ParseResult<PackageTariffRecord> {
  const records: PackageTariffRecord[] = [];
  const skipped: ParseResult<PackageTariffRecord>['skipped'] = [];
  const errored: ParseResult<PackageTariffRecord>['errored'] = [];

  const rawLines = layoutText.split(/\r?\n/);
  // Trim every line but keep empty slots so indices remain meaningful for
  // adjacent-line stitching.
  const lines = rawLines.map((l) => l.trimEnd());

  let total = 0;
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    total++;

    // The anchor: every package row's main physical line includes the code.
    const cm = line.match(CODE_RE);
    if (!cm) continue;

    // We need a tail of 5 or 6 numbers on this line.
    const tail6 = line.match(TAIL_6);
    const tail5 = !tail6 ? line.match(TAIL_5) : null;
    if (!tail6 && !tail5) {
      skipped.push({ line, reason: 'code_without_tail', line_no: i + 1 });
      continue;
    }

    const package_code = cm[0].toUpperCase();
    const dept_code = cm[1].toUpperCase();

    if (seen.has(package_code)) {
      errored.push({ line, reason: `duplicate_package_code:${package_code}`, line_no: i + 1 });
      continue;
    }
    seen.add(package_code);

    // Strip the tail and code from the line; what's left in the middle is the
    // inline name fragment (may be blank for wrapped names).
    const codeStart = line.indexOf(cm[0]);
    const codeEnd = codeStart + cm[0].length;
    const tailIdx = (tail6 || tail5)!.index!;
    const inlineName = line.slice(codeEnd, tailIdx).trim();

    // For wrapped names, look 1-2 lines above and below for fragments. We only
    // pull lines that (a) don't contain a CODE_RE themselves (would be another
    // package's row), (b) aren't stray "Open" / "Billing" tokens, (c) have
    // some non-numeric content.
    const fragments: string[] = [];
    const aboveCandidates = [lines[i - 1] ?? '', lines[i - 2] ?? ''];
    const belowCandidates = [lines[i + 1] ?? '', lines[i + 2] ?? ''];

    for (const candidate of aboveCandidates) {
      const c = candidate.trim();
      if (!c) continue;
      if (STRAY_RE.test(c)) continue;
      if (CODE_RE.test(c)) continue;
      if (/^\d+\s+/.test(c)) continue; // looks like a numeric row header
      fragments.unshift(c);
    }

    if (inlineName) fragments.push(inlineName);

    for (const candidate of belowCandidates) {
      const c = candidate.trim();
      if (!c) continue;
      if (STRAY_RE.test(c)) continue;
      if (CODE_RE.test(c)) continue;
      if (/^\d+\s+/.test(c)) continue;
      fragments.push(c);
    }

    // Only keep above-fragments if the inline name is empty (suggesting a
    // multi-line wrap that started above the code line).
    let name_pieces: string[];
    if (inlineName) {
      // Inline name present → only allow below continuation, since
      // standalone-name-above belongs to the previous row.
      name_pieces = [inlineName];
      for (const candidate of belowCandidates) {
        const c = candidate.trim();
        if (!c || STRAY_RE.test(c) || CODE_RE.test(c)) continue;
        // Below line is a continuation only if the inline name didn't end
        // with a clear delimiter and the below line looks like part of a name
        // (no numbers, ALL CAPS or Title Case fragment).
        if (/^[A-Z][A-Z\s\-/&\(\),]+$/.test(c) && c.length < 60) {
          name_pieces.push(c);
        }
      }
    } else {
      // Inline name empty → name is split across above and below lines.
      name_pieces = fragments;
    }

    // Stitch and clean.
    const stitchedName = name_pieces.join(' ').replace(/\s+/g, ' ').trim();
    let package_name = scrubName(stitchedName);
    if (!package_name) package_name = `(unnamed ${package_code})`;

    // Tail values
    const t = tail6 ?? tail5!;
    const total_days = parseInt(t[1], 10);
    const icu = parseInt(t[2], 10);
    const general = parseInt(t[3], 10);
    const spvt = parseInt(t[4], 10);
    const pvt = parseInt(t[5], 10);
    const suite_price = tail6 ? parseInt(tail6[6], 10) : null;
    const suite_open_billing = !tail6;

    if ([total_days, icu, general, spvt, pvt].some(Number.isNaN)) {
      errored.push({ line, reason: 'price_parse_fail', line_no: i + 1 });
      continue;
    }

    const prices: PackageTariffRecord['prices'] = {};
    if (general > 0) prices.GENERAL = general;
    if (spvt > 0) prices.SEMI_PVT = spvt;
    if (pvt > 0) prices.PVT = pvt;
    if (icu > 0) prices.ICU = icu;

    records.push({
      package_code,
      dept_code,
      package_name,
      total_days,
      prices,
      suite_open_billing,
      suite_price,
    });
  }

  return { records, skipped, errored, lines_total: total };
}
