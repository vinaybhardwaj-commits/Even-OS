/**
 * BV3.2.A — shared utilities for Charge Master PDF probes.
 *
 * - pdfToText(path)          → runs `pdftotext -layout` and returns stdout
 * - writeCsv(path, rows)     → writes an array-of-objects as CSV (RFC 4180)
 * - writeJson(path, data)    → pretty-prints JSON
 * - toInt(s)                 → strips commas, parses integer, returns 0 for empty
 * - dedup(arr, keyFn)        → dedupes by key, keeps first
 * - logSummary(summary)      → uniform stdout banner used by all 3 parsers
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ParseSummary } from './types';

export function pdfToText(pdfPath: string): string {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }
  // -layout preserves column alignment.  -nopgbrk suppresses the \f form-feed
  // char that would otherwise confuse line-based regex.
  return execSync(`pdftotext -layout -nopgbrk ${JSON.stringify(pdfPath)} -`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function toInt(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  const str = String(s).replace(/[, ]/g, '').trim();
  if (!str) return 0;
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * RFC 4180-ish CSV. Escapes only cells that contain comma, double-quote,
 * or newline.  Headers come from Object.keys of the first row (all rows
 * are assumed to have the same keys).
 */
export function writeCsv(filePath: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    fs.writeFileSync(filePath, '');
    return;
  }
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines: string[] = [];
  lines.push(headers.join(','));
  for (const row of rows) {
    lines.push(headers.map(h => esc(row[h])).join(','));
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

export function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

export function dedup<T>(arr: T[], keyFn: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

export function logSummary(s: ParseSummary): void {
  const ok = s.rejected === 0;
  const marker = ok ? '✓' : '⚠';
  // eslint-disable-next-line no-console
  console.log(
    `${marker} ${path.basename(s.source_file)} → parsed=${s.parsed}  rejected=${s.rejected}  (${s.duration_ms}ms)\n` +
    `   json: ${s.output_json}\n` +
    `   csv:  ${s.output_csv}` +
    (s.reject_csv ? `\n   rej:  ${s.reject_csv}` : '')
  );
}
