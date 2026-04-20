import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * DEMO.6 — seed the `demo` role row in the RBAC `roles` table.
 *
 * Context & why this is tiny:
 *
 *   `lib/rbac/index.ts` is a DB-backed permission library
 *   (`roles` → `role_permissions` → `permissions`) — but as of
 *   20 Apr 2026 NO tRPC procedure or route handler actually calls
 *   `hasPermission` / `getUserPermissions`. Protection today is:
 *     • `protectedProcedure` — "session exists"
 *     • `adminProcedure` — hardcoded `['super_admin','hospital_admin']`
 *     • DEMO.5 middleware — allowlist of 3 paths when role==='demo'
 *
 *   That means the *enforcement* for demo is already complete — a demo
 *   session cannot reach any caregiver/admin route by construction.
 *
 *   What's still missing is the RBAC *registration*: the `roles` table
 *   has no `demo` row, so any future surface that lights up permission
 *   checks (admin "Roles & Permissions" UI, per-role session-timeout
 *   column, is_active flip, etc.) would treat `demo` as unknown and
 *   either drop through as "no permissions" (fine) or silently hide
 *   the role from admin lists (not fine).
 *
 *   This migration fixes that. It writes one row:
 *
 *     roles(hospital_id='EHRC', name='demo', description='Demo
 *     Account — persona picker gate (no clinical or admin access).
 *     See middleware.ts for the 3-path allowlist.', role_group='system',
 *     is_active=true, is_system_role=true)
 *
 *   It does NOT write any role_permissions rows. A demo session
 *   therefore returns `new Set()` from `getUserPermissions`, which
 *   is the desired deny-by-default behavior.
 *
 * Guardrails:
 *   • Idempotent: SELECT-first, INSERT-if-missing, UPDATE-otherwise
 *     (same pattern as seed-roles/route.ts — ON CONFLICT is unreliable
 *     because `roles` has no unique (hospital_id, name) constraint in
 *     the current schema).
 *   • Does not touch role_permissions / permissions tables.
 *   • Returns the final row for a visual sanity check.
 *
 * GET-only; call once from a super_admin browser session.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    const hospitalId = 'EHRC';
    const name = 'demo';
    const description =
      'Demo Account — persona picker gate (no clinical or admin access). ' +
      'All routes except /demo/picker, /api/demo/switch, and /api/auth/logout ' +
      'are blocked by middleware.ts. Deny-by-default: no role_permissions ' +
      'rows reference this role.';
    const roleGroup = 'system';

    // ── 1. Upsert the demo role row ─────────────────────────────────
    const existing = (await sql`
      SELECT id, name, description, role_group, is_active, is_system_role
      FROM roles
      WHERE name = ${name} AND hospital_id = ${hospitalId}
      LIMIT 1
    `) as Array<{
      id: string;
      name: string;
      description: string;
      role_group: string;
      is_active: boolean;
      is_system_role: boolean;
    }>;

    if (existing.length === 0) {
      const inserted = (await sql`
        INSERT INTO roles (
          hospital_id, name, description, role_group,
          is_active, is_system_role
        )
        VALUES (
          ${hospitalId}, ${name}, ${description}, ${roleGroup},
          true, true
        )
        RETURNING id
      `) as Array<{ id: string }>;
      steps.push(`INSERT roles (demo) — id=${inserted[0]?.id}`);
    } else {
      await sql`
        UPDATE roles
        SET description = ${description},
            role_group = ${roleGroup},
            is_active = true,
            is_system_role = true
        WHERE name = ${name} AND hospital_id = ${hospitalId}
      `;
      steps.push(`UPDATE roles (demo) — id=${existing[0].id}`);
    }

    // ── 2. Verify: demo row exists and has zero permission rows ────
    const finalRow = (await sql`
      SELECT id, hospital_id, name, description, role_group,
             is_active, is_system_role
      FROM roles
      WHERE name = ${name} AND hospital_id = ${hospitalId}
      LIMIT 1
    `) as Array<{
      id: string;
      hospital_id: string;
      name: string;
      description: string;
      role_group: string;
      is_active: boolean;
      is_system_role: boolean;
    }>;

    if (finalRow.length !== 1) {
      throw new Error(`Expected 1 demo role row, found ${finalRow.length}`);
    }
    const row = finalRow[0];

    if (row.role_group !== 'system') {
      throw new Error(`demo role role_group=${row.role_group}, expected 'system'`);
    }
    if (!row.is_system_role) {
      throw new Error(`demo role is_system_role=false, expected true`);
    }
    if (!row.is_active) {
      throw new Error(`demo role is_active=false, expected true`);
    }

    // Count role_permissions rows that reference this role_id —
    // MUST be zero for deny-by-default semantics.
    const permCountRows = (await sql`
      SELECT COUNT(*)::int AS count
      FROM role_permissions
      WHERE role_id = ${row.id}
    `) as Array<{ count: number }>;

    const permCount = permCountRows[0]?.count ?? 0;
    if (permCount !== 0) {
      // This is not a hard failure (someone might have intentionally
      // granted something), but surface it loudly.
      steps.push(
        `⚠️  demo role has ${permCount} role_permissions rows — ` +
          `deny-by-default expectation violated. Review /admin/roles.`,
      );
    } else {
      steps.push('verify OK — demo role has 0 role_permissions rows (deny-by-default)');
    }

    return NextResponse.json({
      ok: true,
      migration: '0061_demo_role_seed',
      steps,
      role: row,
      permissionCount: permCount,
      note:
        'Enforcement today is via DEMO.5 middleware allowlist, NOT via ' +
        'rbac.hasPermission (no procedure currently calls it). This row ' +
        'exists so that if / when RBAC enforcement turns on, demo is a ' +
        'registered role with zero permissions.',
    });
  } catch (err: any) {
    console.error('[migration demo-rbac-seed] failed:', err);
    return NextResponse.json(
      { ok: false, steps, error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
