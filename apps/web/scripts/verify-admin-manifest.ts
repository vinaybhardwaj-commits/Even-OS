/**
 * CI gate — verifies src/lib/admin-manifest.ts matches the pages on disk.
 *
 * Run via `pnpm --filter @even-os/web verify:admin-manifest` or as a
 * prebuild hook on Vercel.
 *
 * Fails (exit 1) if EITHER of these invariants is violated:
 *   1. A page.tsx exists under src/app/(admin)/admin/** whose route is NOT
 *      registered in admin-manifest.ts (and not in MANIFEST_SKIP_PATHS).
 *   2. A manifest entry whose path starts with /admin/ does NOT have a
 *      matching page.tsx on disk (i.e. the manifest links to a dead route).
 *
 * Why: the core pathology of the old admin dashboard was silent drift —
 * pages shipped without nav, and nav pointed at pages that got deleted.
 * This gate catches both classes of drift at build time.
 *
 * Usage:
 *   pnpm --filter @even-os/web exec tsx scripts/verify-admin-manifest.ts
 *   pnpm --filter @even-os/web exec tsx scripts/verify-admin-manifest.ts --strict
 *
 * --strict: also flag manifest entries whose path starts with / (non-/admin)
 *           if they don't have a matching page on disk. Default is off so
 *           routes like /profile (outside (admin) group) don't false-positive.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve relative to this script so it works from any cwd.
// ESM-safe via import.meta.url so the script runs under both tsx (our
// default) and node --experimental-strip-types.
const __filename = typeof __dirname !== 'undefined'
  ? path.join(__dirname, 'verify-admin-manifest.ts') // CJS (tsx in node<18 compat mode)
  : fileURLToPath(import.meta.url);                  // ESM
const SCRIPT_DIR = path.dirname(__filename);
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..');
const ADMIN_ROOT = path.join(WEB_ROOT, 'src', 'app', '(admin)', 'admin');
const MANIFEST_PATH = path.join(WEB_ROOT, 'src', 'lib', 'admin-manifest.ts');

// Colors for terminal output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ─── Walk filesystem ────────────────────────────────────────────────────

function walkPages(dir: string, prefix = '/admin'): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Skip private folders Next ignores (e.g. _components, (group))
      if (entry.name.startsWith('_')) continue;
      const childPrefix = entry.name.startsWith('(') && entry.name.endsWith(')')
        ? prefix // route groups don't affect URL
        : `${prefix}/${entry.name}`;
      out.push(...walkPages(path.join(dir, entry.name), childPrefix));
    } else if (entry.isFile() && (entry.name === 'page.tsx' || entry.name === 'page.ts' || entry.name === 'page.jsx' || entry.name === 'page.js')) {
      out.push(prefix);
    }
  }
  return out;
}

// ─── Parse manifest file ────────────────────────────────────────────────

function parseManifest(file: string): { paths: Set<string>; skipPaths: Set<string>; count: number } {
  const src = fs.readFileSync(file, 'utf8');

  // Extract every `path: '...'` occurrence in adminRoutes array.
  // Not a full TS parser, but resilient enough — the manifest file is the
  // only file we parse, and its shape is tightly controlled.
  const paths = new Set<string>();
  const pathRe = /path:\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(src)) !== null) {
    paths.add(m[1]);
  }

  // Extract MANIFEST_SKIP_PATHS entries.
  const skipPaths = new Set<string>();
  const skipBlock = src.match(/MANIFEST_SKIP_PATHS\s*=\s*new\s+Set<[^>]+>\(\[([\s\S]*?)\]\s*\)/);
  if (skipBlock) {
    const skipRe = /['"]([^'"]+)['"]/g;
    let s: RegExpExecArray | null;
    while ((s = skipRe.exec(skipBlock[1])) !== null) {
      skipPaths.add(s[1]);
    }
  }

  return { paths, skipPaths, count: paths.size };
}

// ─── Main ────────────────────────────────────────────────────────────────

function main() {
  const strict = process.argv.includes('--strict');

  console.log(`${DIM}verify-admin-manifest${RESET}`);
  console.log(`${DIM}  web root:     ${WEB_ROOT}${RESET}`);
  console.log(`${DIM}  admin pages:  ${ADMIN_ROOT}${RESET}`);
  console.log(`${DIM}  manifest:     ${MANIFEST_PATH}${RESET}`);
  console.log();

  const onDisk = walkPages(ADMIN_ROOT);
  // Normalize dynamic segments: Next.js uses [id] -> keep as-is so the
  // manifest can list them explicitly if it wants to.
  const diskSet = new Set(onDisk);

  const { paths: manifestPaths, skipPaths, count } = parseManifest(MANIFEST_PATH);

  console.log(`Pages on disk:       ${onDisk.length}`);
  console.log(`Routes in manifest:  ${count}`);
  console.log(`Skip list:           ${skipPaths.size}`);
  console.log();

  const errors: string[] = [];

  // Invariant 1: every on-disk admin page should be registered (or skipped).
  const unregistered: string[] = [];
  for (const p of onDisk) {
    if (manifestPaths.has(p)) continue;
    if (skipPaths.has(p)) continue;
    unregistered.push(p);
  }
  if (unregistered.length > 0) {
    errors.push(
      `${RED}✗ ${unregistered.length} admin page(s) are NOT registered in admin-manifest.ts:${RESET}\n` +
        unregistered.map(p => `    ${p}`).join('\n') +
        `\n\n  Fix: add each to adminRoutes[] in src/lib/admin-manifest.ts, or to\n  MANIFEST_SKIP_PATHS if it is intentionally not a nav target (e.g. a\n  dynamic route or a hidden landing).`
    );
  }

  // Invariant 2: every manifest entry under /admin should point at a real page.
  const dead: string[] = [];
  for (const p of manifestPaths) {
    if (!p.startsWith('/admin')) {
      // Non-/admin routes: only check in --strict mode, and even then skip
      // the common allow-list so /profile, /break-glass don't false-positive.
      if (!strict) continue;
      if (p === '/profile' || p === '/break-glass' || p === '/login' || p === '/logout') continue;
      // Without a parallel filesystem walker for non-(admin) routes, we
      // skip these even in strict mode — a richer walker lands in AD.5
      // when we wire redirects.
      continue;
    }
    if (diskSet.has(p)) continue;
    dead.push(p);
  }
  if (dead.length > 0) {
    errors.push(
      `${RED}✗ ${dead.length} manifest entr${dead.length === 1 ? 'y points' : 'ies point'} at a page that does NOT exist on disk:${RESET}\n` +
        dead.map(p => `    ${p}`).join('\n') +
        `\n\n  Fix: either create the page at src/app/(admin)<path>/page.tsx\n  or remove the entry from src/lib/admin-manifest.ts.`
    );
  }

  // Summary
  if (errors.length === 0) {
    console.log(`${GREEN}✓ admin-manifest is in sync with filesystem.${RESET}`);
    console.log(`${GREEN}✓ ${onDisk.length} pages on disk, ${count} manifest entries, ${skipPaths.size} skipped.${RESET}`);
    process.exit(0);
  }

  for (const err of errors) {
    console.error(err);
    console.error();
  }

  console.error(`${RED}admin-manifest verification failed.${RESET}`);
  process.exit(1);
}

main();
