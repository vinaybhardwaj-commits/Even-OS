/**
 * BV3.2.A — parse Tariff List - Packages.pdf
 *
 * Input:
 *   Daily Dash EHRC/Charge Master/Tariff List-Packages.pdf  (201 rows)
 *
 * Output:
 *   out/packages.json         — array of ParsedPackageRow
 *   out/packages.csv          — import-ready CSV keyed by package_code
 *   out/packages.rejects.csv  — rows that did not parse (if any)
 *
 * PDF shape:
 *   SL · DEPT · CODE · NAME · DAYS · ICU_DAYS · GENERAL · SPVT · PVT · "Open Billing"
 *
 * Code format:   `[A-Z]{3}-PKG-\d{3}`  (ENT / GAS / GEN / OBG / ORT / URO / VAS)
 *
 * Per V (22 Apr 2026): all 201 current-PDF packages are Suite-open-billing;
 * the "ICU" column is a 0/1 day-count flag, NOT a price — so the parser
 * stores it as `icu_days` and leaves prices.ICU null for now.  Finance
 * can re-price via the BV3.2.B UI.
 *
 * Quirks handled:
 *   - Name wraps forward (continuation line after the data line)
 *   - Name wraps backward (leading name fragment on the line above the data line)
 *   - Code sometimes appears on its own line, with name+numbers below (OBG-PKG-066)
 *   - One row (OBG-PKG-109) has only 3 trailing numbers (no days/icu)
 *   - DEPT column wraps ("Orthopa" / "edics", "General" / "Surgery") — dept_code is
 *     always derived from the 3-char code prefix, so we just strip those words
 *   - Suite column is "Open Billing" which wraps onto 2 adjacent lines (±1 of data)
 *     with "Open" ABOVE and "Billing" BELOW the data line.  When a name fragment
 *     is on the same line as the Suite-column wrap, the tail word is stripped.
 *   - Disambiguating name fragments between two adjacent data lines:
 *       * A line ending with "Open" within 2 lines ABOVE a data line
 *         belongs to that data line's "above" (Suite-column head).
 *       * A line ending with "Billing" within 2 lines BELOW a data line
 *         belongs to that data line's "below" (Suite-column tail).
 *
 * Usage:
 *   pnpm exec tsx scripts/parse-charge-master/parse-packages.ts
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ParsedPackageRow,
  ParseReject,
  ParseSummary,
  ClassCode,
} from './types';
import { pdfToText, writeCsv, writeJson, toInt, logSummary } from './util';

const __filename = typeof __dirname !== 'undefined'
  ? path.join(__dirname, 'parse-packages.ts')
  : fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..');
const DEFAULT_PDF = path.resolve(
  REPO_ROOT, '..', '..', 'mnt', 'Daily Dash EHRC',
  'Charge Master', 'Tariff List-Packages.pdf',
);

/** Code-prefix → (full dept label, dept_code). */
const DEPT_LABEL: Record<string, { dept: string; dept_code: string }> = {
  ENT: { dept: 'ENT',              dept_code: 'ENT'    },
  GAS: { dept: 'Gastro Medical',   dept_code: 'GASTRO' },
  GEN: { dept: 'General Surgery',  dept_code: 'GSURG'  },
  OBG: { dept: 'OBG',              dept_code: 'OBG'    },
  ORT: { dept: 'Orthopaedics',     dept_code: 'ORTHO'  },
  URO: { dept: 'Urology',          dept_code: 'URO'    },
  VAS: { dept: 'Vascular Surgery', dept_code: 'VASC'   },
};

const CODE_RE = /([A-Z]{3})-PKG-(\d{3})/;
const isNumTok = (t: string) => /^\d[\d,]*$/.test(t);
const SUITE_TAIL_RE = /^(open|billing)$/i;

/**
 * Dept-column spillover words that appear at the LEFT of a name/data line
 * when pdftotext split the DEPT cell across rows.  These are always safe
 * to strip because no package name in the PDF starts with them (verified
 * against all 201 rows).
 */
const DEPT_COL_WORDS = new Set([
  'ent', 'obg', 'orthopa', 'edics', 'gastro', 'medical',
  'general', 'surgery', 'vascular', 'urology',
]);

function stripSuiteTail(toks: string[]): string[] {
  const out = [...toks];
  while (out.length && SUITE_TAIL_RE.test(out[out.length - 1])) out.pop();
  return out;
}

function trailingNumCount(line: string): number {
  const toks = stripSuiteTail(line.trim().split(/\s+/).filter(Boolean));
  let n = 0;
  while (n < toks.length && isNumTok(toks[toks.length - 1 - n])) n++;
  return n;
}

/** Left-strip SL digits and dept-col words from a token array. */
function stripLeftNoise(toks: string[]): string[] {
  const out = [...toks];
  while (out.length && /^\d+$/.test(out[0])) out.shift();
  while (out.length && DEPT_COL_WORDS.has(out[0].toLowerCase())) out.shift();
  return out;
}

/** Clean a non-data line: strip left noise + Open/Billing tail + zero-width space. */
function cleanNameLine(line: string): string {
  const raw = line.trim().replace(/\u200B/g, '');
  const toks = stripLeftNoise(stripSuiteTail(raw.split(/\s+/).filter(Boolean)));
  return toks.join(' ').trim();
}

function isColumnHeaderOrBanner(cleaned: string, orig: string): boolean {
  if (/IP\s+PACKAGES/i.test(orig)) return true;
  if (/^(SL|No|DEPT|CODES|Item|Total|Days|ICU|Genral|Spvt|Pvt|Suite|TARIFF|Package)\b/i.test(cleaned)) return true;
  return false;
}

type LineKind = 'data' | 'code_only' | 'name' | 'noise';
interface LineAnalysis {
  kind: LineKind;
  code?: string;
  nums?: number[];
  nameOnData?: string;
  cleaned?: string;
}

function analyze(line: string): LineAnalysis {
  const raw = line.trim().replace(/\u200B/g, '');
  if (!raw) return { kind: 'noise' };

  const numCount = trailingNumCount(raw);
  const isData = numCount === 5 || numCount === 3;
  const codeMatch = raw.match(CODE_RE);

  if (isData) {
    const toksAll = raw.split(/\s+/).filter(Boolean);
    const toks = stripSuiteTail(toksAll);
    const nums = toks.slice(toks.length - numCount).map(toInt);
    const prefix = stripLeftNoise(toks.slice(0, toks.length - numCount));
    const codeIdx = prefix.findIndex(tk => CODE_RE.test(tk));
    const nameOnData = codeIdx >= 0
      ? prefix.slice(codeIdx + 1).join(' ').trim()
      : prefix.join(' ').trim();
    return { kind: 'data', code: codeMatch ? codeMatch[0] : undefined, nums, nameOnData };
  }

  if (codeMatch) {
    // Line contains a code but no valid num tail → "code_only" (name wraps onto
    // adjacent lines; data line is within 1-3 lines below).
    return { kind: 'code_only', code: codeMatch[0] };
  }

  const cleaned = cleanNameLine(raw);
  if (!cleaned) return { kind: 'noise' };
  if (!/[A-Za-z]/.test(cleaned)) return { kind: 'noise' };
  if (isColumnHeaderOrBanner(cleaned, raw)) return { kind: 'noise' };
  return { kind: 'name', cleaned };
}

export function parsePackages(pdfPath: string = DEFAULT_PDF): {
  rows: ParsedPackageRow[];
  rejects: ParseReject[];
  summary: ParseSummary;
} {
  const started = Date.now();
  const text = pdfToText(pdfPath);
  const lines = text.split(/\r?\n/);
  const rows: ParsedPackageRow[] = [];
  const rejects: ParseReject[] = [];

  // Pass 1 — classify every line.
  const analyzed = lines.map(analyze);

  // Pass 2 — find each data line, associate with its code (on same line or
  // on a "code_only" line within 1–3 lines above).
  interface PkgBlock {
    dataIdx: number;
    codeIdx: number;
    code: string;
    nums: number[];
    nameOnData: string;
  }
  const blocks: PkgBlock[] = [];
  const seenCodes = new Set<string>();

  for (let i = 0; i < analyzed.length; i++) {
    const a = analyzed[i];
    if (a.kind !== 'data') continue;
    let code = a.code;
    let codeIdx = i;
    if (!code) {
      for (let up = i - 1; up >= Math.max(0, i - 4); up--) {
        const ua = analyzed[up];
        if (ua.kind === 'code_only') {
          code = ua.code;
          codeIdx = up;
          break;
        }
        if (ua.kind === 'data') break;
      }
    }
    if (!code) {
      rejects.push({ lineno: i + 1, raw_line: lines[i].trim(), reason: 'data line has no associable code' });
      continue;
    }
    if (seenCodes.has(code)) continue;
    seenCodes.add(code);
    blocks.push({ dataIdx: i, codeIdx, code, nums: a.nums!, nameOnData: a.nameOnData || '' });
  }

  // Pass 3 — for each block, walk UPWARD from codeIdx-1 to gather "above"
  // name fragments.  Stop at a data line or the previous data line.  The
  // Open/Billing tail heuristic discriminates between this block's above and
  // the previous block's below when a name fragment is sandwiched between them.
  const above: string[][] = blocks.map((b, k) => {
    const prevDataIdx = k > 0 ? blocks[k - 1].dataIdx : -1;
    const acc: string[] = [];
    for (let up = b.codeIdx - 1; up > prevDataIdx; up--) {
      const a = analyzed[up];
      if (a.kind === 'noise') continue;
      if (a.kind === 'name') {
        const orig = lines[up].trim();
        const endsWithBilling = /\bBilling\s*$/i.test(orig);
        // "Billing" is the Suite-column TAIL of the previous data line.  If
        // this name fragment ends with "Billing" and the previous data line
        // is within 2 lines, it belongs to the PREVIOUS block's below.
        if (endsWithBilling && up - prevDataIdx <= 2) break;
        acc.unshift(a.cleaned!);
      } else {
        break;
      }
    }
    return acc;
  });

  // Pass 4 — for each block, walk DOWNWARD from dataIdx+1 to gather "below"
  // name fragments.  Stop at the next block's data line or at a line ending
  // with "Open" (which is the Suite-column HEAD of the next data line).
  const below: string[][] = blocks.map((b, k) => {
    const nextDataIdx = k < blocks.length - 1 ? blocks[k + 1].dataIdx : lines.length;
    const acc: string[] = [];
    for (let dn = b.dataIdx + 1; dn < nextDataIdx; dn++) {
      const a = analyzed[dn];
      if (a.kind === 'noise') continue;
      if (a.kind === 'name') {
        const orig = lines[dn].trim();
        const endsWithOpen = /\bOpen\s*$/i.test(orig);
        if (endsWithOpen && nextDataIdx - dn <= 2) break;
        acc.push(a.cleaned!);
      } else {
        break;
      }
    }
    return acc;
  });

  // Pass 5 — assemble each package row.
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const { dataIdx, codeIdx, code, nums, nameOnData } = b;

    // Middle: name fragments between codeIdx and dataIdx (only when code is
    // on a separate line — e.g. OBG-PKG-066 has the code one line above the
    // actual "LAPAROSCOPIC ... -PKG <nums>" data line, with the rest of the
    // name on the line(s) between).
    const middle: string[] = [];
    for (let m = codeIdx + 1; m < dataIdx; m++) {
      if (analyzed[m].kind === 'name') middle.push(analyzed[m].cleaned!);
    }

    // Assemble in document order:
    //   above (before code line) → middle (between code and data) → data-line name → below
    const parts = [
      above[k].join(' '),
      middle.join(' '),
      nameOnData,
      below[k].join(' '),
    ].filter(Boolean);
    const package_name = parts.join(' ').replace(/\s+/g, ' ').trim();

    if (!package_name) {
      rejects.push({
        lineno: dataIdx + 1,
        raw_line: lines[dataIdx].trim(),
        reason: `empty package name for ${code}`,
      });
      continue;
    }

    const prefix = code.slice(0, 3);
    const deptMap = DEPT_LABEL[prefix];
    if (!deptMap) {
      rejects.push({
        lineno: dataIdx + 1,
        raw_line: lines[dataIdx].trim(),
        reason: `unknown dept prefix '${prefix}' in ${code}`,
      });
      continue;
    }

    let days = 0, icuDays = 0, general = 0, spvt = 0, pvt = 0;
    if (nums.length === 5) [days, icuDays, general, spvt, pvt] = nums;
    else if (nums.length === 3) [general, spvt, pvt] = nums;

    const prices: Partial<Record<ClassCode, number | null>> = {
      GENERAL: general,
      SEMI_PVT: spvt,
      PVT: pvt,
      ICU: null,   // ICU column is a day-count flag, not a price — finance re-prices via UI
      SUITE: null, // Suite = "Open Billing" for all current packages — finance re-prices via UI
    };

    rows.push({
      package_code: code,
      package_name,
      dept: deptMap.dept,
      dept_code: deptMap.dept_code,
      duration_days: days,
      icu_days: icuDays,
      suite_open_billing: true,
      prices,
    });
  }

  const outDir = path.join(SCRIPT_DIR, 'out');
  const jsonPath = path.join(outDir, 'packages.json');
  const csvPath = path.join(outDir, 'packages.csv');
  const rejPath = path.join(outDir, 'packages.rejects.csv');

  writeJson(jsonPath, rows);

  const flatRows = rows.map(r => ({
    package_code: r.package_code,
    package_name: r.package_name,
    dept: r.dept,
    dept_code: r.dept_code,
    duration_days: r.duration_days,
    icu_days: r.icu_days,
    suite_open_billing: r.suite_open_billing ? 1 : 0,
    price_general: r.prices.GENERAL ?? '',
    price_semi_pvt: r.prices.SEMI_PVT ?? '',
    price_pvt: r.prices.PVT ?? '',
    price_icu: r.prices.ICU ?? '',
    price_suite: r.prices.SUITE ?? '',
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
  const { rows, rejects, summary } = parsePackages(pdfArg);
  logSummary(summary);

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
  if (rows.length < 195) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ Expected ≥195 package rows, got ${rows.length}. Review ${summary.output_json}.`);
    process.exit(1);
  }
}
