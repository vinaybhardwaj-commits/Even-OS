/**
 * DEMO.6 — tiny server-side guard helpers for the demo role.
 *
 * Purpose: expose a single source of truth for "is this session a
 * demo session?" and "what paths is a demo session allowed to hit?"
 * so future procedures / route handlers / server components don't
 * have to re-derive the rule.
 *
 * Enforcement today (20 Apr 2026):
 *   • DEMO.1 — login route rejects demo@even.in when DEMO_ACCOUNT_ENABLED
 *     !== 'true'.
 *   • DEMO.3 — POST /api/demo/switch is the ONLY mutation a demo session
 *     can make (env-gated, rate-limited, audit-logged).
 *   • DEMO.5 — middleware.ts redirects any demo session to /demo/picker
 *     unless the request path is on `DEMO_ALLOWED_PATH_PREFIXES`.
 *   • DEMO.6 (this file + migrations/demo-rbac-seed) — the `demo` role
 *     is now a registered row in the RBAC `roles` table with zero
 *     permissions. `rbac.getUserPermissions(['demo'], 'EHRC')` returns
 *     an empty Set. If / when any procedure starts calling
 *     `rbac.hasPermission`, a demo session fails every check.
 *
 * Keep this file tiny and edge-runtime-safe — no DB imports, no
 * zod-env imports. Middleware.ts imports the PATH constants via
 * an inline copy today; if we want it to import from here later,
 * we just need to be careful not to pull any heavy deps in.
 */

/** Canonical role name for the demo persona-picker gate user. */
export const DEMO_ROLE = 'demo' as const;

/**
 * The 3 path prefixes a demo session is allowed to reach.
 * Mirrors `DEMO_ALLOWED_PREFIXES` in apps/web/src/middleware.ts.
 *
 * If you edit this list, edit middleware.ts too — they are kept
 * separate because middleware runs in edge runtime and we don't
 * want to risk dragging the wider `lib/` dependency graph into
 * the edge bundle.
 */
export const DEMO_ALLOWED_PATH_PREFIXES: readonly string[] = [
  '/demo/picker',
  '/api/demo/switch',
  '/api/auth/logout',
] as const;

/** True if a user (by roles[] or session role string) is the demo persona. */
export function isDemoRole(role: string | string[] | null | undefined): boolean {
  if (!role) return false;
  if (Array.isArray(role)) return role.includes(DEMO_ROLE);
  return role === DEMO_ROLE;
}

/** True if `path` is on the demo allowlist (exact match or prefix-with-slash). */
export function isDemoAllowedPath(path: string): boolean {
  for (const prefix of DEMO_ALLOWED_PATH_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + '/')) return true;
  }
  return false;
}
