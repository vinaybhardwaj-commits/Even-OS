/**
 * BV3.2.A — parse Tariff List - Investigations.pdf
 *
 * Input:
 *   Daily Dash EHRC/Charge Master/Tariff List - Investigations.pdf  (~2,137 rows)
 *
 * Output:
 *   out/investigations.json          — array of ParsedInvestigationRow
 *   out/investigations.csv           — import CSV keyed by charge_code
 *   out/investigations.rejects.csv   — lines that didn't parse (if any)
 *
 * PDF shape (repeated across pages):
 *   Code  Service Type  Service Name  Even OPD  General  Semi-Pvt  Pvt  Suite  All ICU
 *
 * Code format:  `[A-Z]{2,4}\d{5}` — LHA00001, LBI00004, CAR00342, etc.
 *
 * Per Q3 (V's call 22 Apr 2026): "All ICU" column maps to BOTH `ICU` and
 * `HDU` class price rows at the same value.
 *
 * Service Type → dept_code mapping per Q4 default (Accident→ER,
 * Administrative→ADMIN, rest pass through in uppercase-short form).
 *
 * Usage:
 *   pnpm exec tsx scripts/parse-charge-master/parse-investigations.ts
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ParsedInvestigationRow,
  ParseReject,
  ParseSummary,
  ClassCode,
} from './types';
import { pdfToText, writeCsv, writeJson, toInt, logSummary } from './util';

const __filename = typeof __dirname !== 'undefined'
  ? path.join(__dirname, 'parse-investigations.ts')
  : fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..');
const DEFAULT_PDF = path.resolve(
  REPO_ROOT, '..', '..', 'mnt', 'Daily Dash EHRC',
  'Charge Master', 'Tariff List - Investigations.pdf',
);

/** Service Type (in PDF) → { dept_code, category }. */
const SERVICE_TYPE_MAP: Record<string, { dept_code: string; category: string }> = {
  accident:       { dept_code: 'ER',     category: 'emergency' },
  administrative: { dept_code: 'ADMIN',  category: 'admin' },
  cardiology:     { dept_code: 'CARDIO', category: 'cardiology' },
  lab:            { dept_code: 'LAB',    category: 'lab' },
  medical:        { dept_code: 'MED',    category: 'procedure' },
  nephrology:     { dept_code: 'NEPHRO', category: 'nephrology' },
  neurology:      { dept_code: 'NEURO',  category: 'neurology' },
  orthopeadic:    { dept_code: 'ORTHO',  category: 'orthopedics' }, // PDF spelling kept
  orthopedic:     { dept_code: 'ORTHO',  category: 'orthopedics' }, // safety alias
  pulmonology:    { dept_code: 'PULMO',  category: 'pulmonology' },
  radiology:      { dept_code: 'RADIO',  category: 'imaging' },
  urology:        { dept_code: 'URO',    category: 'urology' },
};

/**
 * Attempt to extract one item row from a line.
 *
 * Strategy:  the item Code is the leftmost token matching `[A-Z]{2,4}\d{5}`.
 * Everything after that is:  service_type · (service_name words) · 6 integers.
 * Integers come at the tail, so we walk right-to-left, collect up to 6
 * integer tokens, then split the middle into type + name.
 */
function parseRow(line: string, lineno: number): ParsedInvestigationRow | ParseReject {
  const trimmed = line.trim();
  const codeMatch = trimmed.match(/^([A-Z]{2,4}\d{5})\s+(.+)$/);
  if (!codeMatch) {
    return { lineno, raw_line: trimmed, reason: 'no leading code token' };
  }
  const charge_code = codeMatch[1];
  const rest = codeMatch[2];

  // Split into tokens.  Numbers may contain commas (unusual but safe).
  const tokens = rest.split(/\s+/).filter(Boolean);
  const isNum = (t: string) => /^[\d,]+$/.test(t) && /\d/.test(t);

  // Walk from the right collecting trailing numeric tokens.
  const trailingNums: string[] = [];
  let cut = tokens.length;
  while (cut > 0 && isNum(tokens[cut - 1]) && trailingNums.length < 6) {
    trailingNums.unshift(tokens[cut - 1]);
    cut--;
  }
  // Accept 6 prices (active) or 0 prices (pending_finance placeholder — PDF
  // has Administrative rows like ADM00007 "Medical Certificate Charges"
  // with no price columns; Finance re-prices these in BV3.2 via the UI).
  if (trailingNums.length !== 6 && trailingNums.length !== 0) {
    return { lineno, raw_line: trimmed, reason: `found ${trailingNums.length} trailing numbers (need 6 or 0)` };
  }
  if (cut < 1) {
    return { lineno, raw_line: trimmed, reason: 'no service type / service name after code' };
  }
  const service_type = tokens[0];
  const nameTokens = tokens.slice(1, cut);
  const charge_name = nameTokens.join(' ').replace(/\s+/g, ' ').trim();
  if (!charge_name) {
    return { lineno, raw_line: trimmed, reason: 'empty service name' };
  }

  const svcKey = service_type.toLowerCase();
  const svcMap = SERVICE_TYPE_MAP[svcKey];
  if (!svcMap) {
    return { lineno, raw_line: trimmed, reason: `unknown service type '${service_type}'` };
  }

  const [opd, general, semi_pvt, pvt, suite, all_icu] = trailingNums.map(toInt);

  // HDU duplicates ICU (Q3).  _ANY is not used for investigations (per-class only).
  const prices: Record<ClassCode, number | null> = {
    OPD: opd,
    GENERAL: general,
    SEMI_PVT: semi_pvt,
    PVT: pvt,
    SUITE: suite,
    ICU: all_icu,
    HDU: all_icu,
    _ANY: null,
  };

  return {
    charge_code,
    service_type,
    dept_code: svcMap.dept_code,
    category: svcMap.category,
    charge_name,
    prices,
  };
}

/**
 * Stitch pass: ~13/2115 rows in the real PDF have the Code on one line and
 * the `SERVICE_TYPE name  price price …` on an adjacent line.  Sometimes
 * the code is above the data (LBI00947), sometimes below (LBI00949).  This
 * pass fuses those pairs into a single line so `parseRow` can see them.
 */
function stitchOrphanCodes(lines: string[]): string[] {
  const out = [...lines];
  const isOrphanCode = (l: string) => /^\s*[A-Z]{2,4}\d{5}\s*$/.test(l);
  const hasTrailingSixNums = (l: string) => {
    const toks = l.trim().split(/\s+/);
    if (toks.length < 7) return false;
    // last 6 tokens must be integers
    return toks.slice(-6).every(t => /^[\d,]+$/.test(t) && /\d/.test(t));
  };
  const hasLeadingCode = (l: string) => /^\s*[A-Z]{2,4}\d{5}\s/.test(l);
  for (let i = 0; i < out.length; i++) {
    if (!isOrphanCode(out[i])) continue;
    const code = out[i].trim();
    // Look backwards through blank lines for an orphan data line.
    let up = i - 1;
    while (up >= 0 && out[up].trim() === '') up--;
    let down = i + 1;
    while (down < out.length && out[down].trim() === '') down++;
    const candidate = [
      up >= 0 ? up : -1,
      down < out.length ? down : -1,
    ].find(idx => idx >= 0 && !hasLeadingCode(out[idx]) && hasTrailingSixNums(out[idx]));
    if (candidate === undefined) continue;
    // Merge: code + single space + (trimmed) data line.
    out[candidate] = `${code} ${out[candidate].trim()}`;
    out[i] = ''; // clear the orphan code line
  }
  return out;
}

export function parseInvestigations(pdfPath: string = DEFAULT_PDF): {
  rows: ParsedInvestigationRow[];
  rejects: ParseReject[];
  summary: ParseSummary;
} {
  const started = Date.now();
  const text = pdfToText(pdfPath);
  const rows: ParsedInvestigationRow[] = [];
  const rejects: ParseReject[] = [];
  const seen = new Set<string>();

  const lines = stitchOrphanCodes(text.split(/\r?\n/));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Quick pre-filter: only lines starting (after whitespace) with a code pattern.
    if (!/^\s*[A-Z]{2,4}\d{5}/.test(line)) continue;
    const parsed = parseRow(line, i + 1);
    if ('reason' in parsed) {
      rejects.push(parsed);
      continue;
    }
    if (seen.has(parsed.charge_code)) continue; // duplicate header/row echo
    seen.add(parsed.charge_code);
    rows.push(parsed);
  }

  const outDir = path.join(SCRIPT_DIR, 'out');
  const jsonPath = path.join(outDir, 'investigations.json');
  const csvPath = path.join(outDir, 'investigations.csv');
  const rejPath = path.join(outDir, 'investigations.rejects.csv');

  writeJson(jsonPath, rows);

  // CSV shape matches BV3.2.B upload contract (one row per item + flattened prices).
  const flatRows = rows.map(r => ({
    charge_code: r.charge_code,
    charge_name: r.charge_name,
    service_type: r.service_type,
    dept_code: r.dept_code,
    category: r.category,
    price_opd: r.prices.OPD ?? '',
    price_general: r.prices.GENERAL ?? '',
    price_semi_pvt: r.prices.SEMI_PVT ?? '',
    price_pvt: r.prices.PVT ?? '',
    price_suite: r.prices.SUITE ?? '',
    price_icu: r.prices.ICU ?? '',
    price_hdu: r.prices.HDU ?? '',
  }));
  writeCsv(csvPath, flatRows);
  if (rejects.length > 0) {
    writeCsv(rejPath, rejects as unknown as Record<string, unknown>[]);
  }

  return {
    rows,
    rejects,
    summary: {
      source_file: pdfPath,
      parsed: rows.length,
      rejected: rejects.length,
      duration_ms: Date.now() - started,
      output_json: jsonPath,
      output_csv: csvPath,
      reject_csv: rejects.length > 0 ? rejPath : undefined,
    },
  };
}

const isMain = (() => {
  if (typeof require !== 'undefined' && require.main === module) return true;
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch { return false; }
})();

if (isMain) {
  const pdfArg = process.argv[2] || DEFAULT_PDF;
  const { rows, rejects, summary } = parseInvestigations(pdfArg);
  logSummary(summary);

  // Sanity breakdown by dept_code
  // eslint-disable-next-line no-console
  console.log('\nBreakdown by dept_code:');
  const byDept = new Map<string, number>();
  for (const r of rows) byDept.set(r.dept_code, (byDept.get(r.dept_code) || 0) + 1);
  for (const [k, v] of [...byDept.entries()].sort((a, b) => b[1] - a[1])) {
    // eslint-disable-next-line no-console
    console.log(`   ${k.padEnd(8)} ${v}`);
  }

  if (rejects.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`\n⚠ ${rejects.length} rejects. First 5:`);
    for (const r of rejects.slice(0, 5)) {
      // eslint-disable-next-line no-console
      console.log(`   L${r.lineno}: ${r.reason} | ${r.raw_line.slice(0, 120)}`);
    }
  }
  if (rows.length < 2000) {
    process.exit(1);
  }
}
