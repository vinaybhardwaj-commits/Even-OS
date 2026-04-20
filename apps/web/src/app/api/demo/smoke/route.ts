import { NextResponse } from 'next/server';
import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, roles, auditLog } from '@db/schema';
import { getCurrentUser } from '@/lib/auth';
import { DEMO_ROLES } from '@/lib/demo/roles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * DEMO.8 — GET /api/demo/smoke
 *
 * Programmatic smoke test for the demo-account stack. Run this after
 * any deployment touching the demo flow OR after rotating target
 * test-user credentials. It does NOT click the picker; the UI-level
 * check is still manual (see DEMO-SMOKE-CHECKLIST.md in memory).
 *
 * What it verifies end-to-end (all server-side, no cookies):
 *
 *   [A] Environment
 *       • DEMO_ACCOUNT_ENABLED present + equal to 'true'
 *       • JWT_SECRET present (middleware needs it)
 *
 *   [B] Demo user row (DEMO.1)
 *       • exists in EHRC
 *       • roles contains 'demo'
 *       • status='active'
 *       • must_change_password=false
 *
 *   [C] RBAC registration (DEMO.6)
 *       • `demo` row exists in `roles` for EHRC
 *       • role_group='system', is_system_role=true, is_active=true
 *
 *   [D] Target users (DEMO.2 catalog × 4)
 *       For each DEMO_ROLES entry:
 *         • target_email resolves to exactly 1 row in EHRC
 *         • status='active'
 *         • roles array is non-empty
 *         • primary role is NOT 'demo' (sanity — a demo → demo swap
 *           would loop through middleware)
 *
 *   [E] Audit trail (DEMO.3)
 *       • count of audit_log rows with reason='demo.switch' in the
 *           last 24h (informational)
 *       • last 5 rows (id + actor_email + new_data.role_key + timestamp)
 *
 * Access: any authenticated super_admin session can GET this. 403 for
 * everyone else (including the demo user — we do NOT want demo to
 * self-probe the stack).
 *
 * Fail-fast: the first hard failure short-circuits with HTTP 500, but
 * downstream checks still run so the report surfaces every issue at
 * once. Each check returns {ok,true/false,...details} and the overall
 * status is ok only if every check passes.
 */

type CheckResult =
  | { ok: true; detail: Record<string, unknown> }
  | { ok: false; detail: Record<string, unknown>; error: string };

const ok = (detail: Record<string, unknown>): CheckResult => ({ ok: true, detail });
const fail = (error: string, detail: Record<string, unknown> = {}): CheckResult => ({
  ok: false,
  detail,
  error,
});

async function checkEnv(): Promise<CheckResult> {
  const flag = process.env.DEMO_ACCOUNT_ENABLED;
  const jwt = process.env.JWT_SECRET;
  const issues: string[] = [];
  if (flag !== 'true') issues.push(`DEMO_ACCOUNT_ENABLED=${JSON.stringify(flag)} (expected 'true')`);
  if (!jwt) issues.push('JWT_SECRET missing');
  if (issues.length > 0) {
    return fail(issues.join('; '), { DEMO_ACCOUNT_ENABLED: flag, JWT_SECRET_present: Boolean(jwt) });
  }
  return ok({ DEMO_ACCOUNT_ENABLED: 'true', JWT_SECRET_present: true });
}

async function checkDemoUser(): Promise<CheckResult> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      roles: users.roles,
      status: users.status,
      must_change_password: users.must_change_password,
    })
    .from(users)
    .where(and(eq(users.email, 'demo@even.in'), eq(users.hospital_id, 'EHRC')))
    .limit(1);

  if (rows.length === 0) return fail('demo@even.in not found in EHRC — run /api/migrations/demo-account-seed');
  const u = rows[0];
  const problems: string[] = [];
  if (!Array.isArray(u.roles) || !u.roles.includes('demo'))
    problems.push(`roles missing 'demo' (got ${JSON.stringify(u.roles)})`);
  if (u.status !== 'active') problems.push(`status=${u.status} (expected active)`);
  if (u.must_change_password)
    problems.push('must_change_password=true — will block picker flow');
  if (problems.length > 0) return fail(problems.join('; '), { ...u });
  return ok({ id: u.id, email: u.email, roles: u.roles });
}

async function checkDemoRoleRow(): Promise<CheckResult> {
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      role_group: roles.role_group,
      is_active: roles.is_active,
      is_system_role: roles.is_system_role,
    })
    .from(roles)
    .where(and(eq(roles.name, 'demo'), eq(roles.hospital_id, 'EHRC')))
    .limit(1);

  if (rows.length === 0)
    return fail('`demo` role row not found — run /api/migrations/demo-rbac-seed');
  const r = rows[0];
  const problems: string[] = [];
  if (r.role_group !== 'system') problems.push(`role_group=${r.role_group} (expected 'system')`);
  if (!r.is_system_role) problems.push('is_system_role=false');
  if (!r.is_active) problems.push('is_active=false');
  if (problems.length > 0) return fail(problems.join('; '), { ...r });
  return ok({ id: r.id, role_group: r.role_group });
}

interface TargetResult {
  role_key: string;
  target_email: string;
  ok: boolean;
  error?: string;
  target?: {
    id: string;
    full_name: string;
    primary_role: string | undefined;
    status: string;
  };
}

async function checkTargets(): Promise<{ allOk: boolean; results: TargetResult[] }> {
  const results: TargetResult[] = [];

  for (const role of DEMO_ROLES) {
    const rows = await db
      .select({
        id: users.id,
        full_name: users.full_name,
        roles: users.roles,
        status: users.status,
      })
      .from(users)
      .where(and(eq(users.email, role.target_email), eq(users.hospital_id, 'EHRC')))
      .limit(1);

    if (rows.length === 0) {
      results.push({
        role_key: role.key,
        target_email: role.target_email,
        ok: false,
        error: 'target user not found in EHRC',
      });
      continue;
    }

    const u = rows[0];
    const primaryRole = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles[0] : undefined;

    const problems: string[] = [];
    if (u.status !== 'active') problems.push(`status=${u.status}`);
    if (!Array.isArray(u.roles) || u.roles.length === 0) problems.push('roles array empty');
    if (primaryRole === 'demo') problems.push("primary role='demo' (loop risk)");

    results.push({
      role_key: role.key,
      target_email: role.target_email,
      ok: problems.length === 0,
      error: problems.length > 0 ? problems.join('; ') : undefined,
      target: {
        id: u.id,
        full_name: u.full_name,
        primary_role: primaryRole,
        status: u.status,
      },
    });
  }

  return { allOk: results.every((r) => r.ok), results };
}

async function recentDemoSwitches(): Promise<{
  count_24h: number;
  last_five: Array<{
    actor_email: string | null;
    new_data: unknown;
    timestamp: Date;
  }>;
}> {
  const countRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM audit_log
    WHERE reason = 'demo.switch'
      AND timestamp > NOW() - INTERVAL '24 hours'
  `);
  const count_24h = countRows.rows?.[0]?.count ?? (countRows as any)[0]?.count ?? 0;

  const lastFive = await db
    .select({
      actor_email: auditLog.actor_email,
      new_data: auditLog.new_data,
      timestamp: auditLog.timestamp,
    })
    .from(auditLog)
    .where(eq(auditLog.reason, 'demo.switch'))
    .orderBy(desc(auditLog.timestamp))
    .limit(5);

  return { count_24h, last_five: lastFive };
}

export async function GET() {
  // Gate: super_admin only. We intentionally do NOT allow the demo
  // user itself to hit this (would leak target-user details back into
  // a demo session).
  const caller = await getCurrentUser();
  if (!caller) {
    return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  }
  if (caller.role !== 'super_admin') {
    return NextResponse.json(
      { ok: false, error: 'super_admin role required for demo smoke.' },
      { status: 403 },
    );
  }

  const [envCheck, userCheck, roleRowCheck, targetsCheck, recent] = await Promise.all([
    checkEnv(),
    checkDemoUser(),
    checkDemoRoleRow(),
    checkTargets(),
    recentDemoSwitches().catch((err) => ({
      count_24h: -1,
      last_five: [],
      error: err?.message || String(err),
    })),
  ]);

  const allOk = envCheck.ok && userCheck.ok && roleRowCheck.ok && targetsCheck.allOk;

  return NextResponse.json(
    {
      ok: allOk,
      ran_by: { id: caller.sub, email: caller.email, role: caller.role },
      checks: {
        A_env: envCheck,
        B_demo_user: userCheck,
        C_rbac_role_row: roleRowCheck,
        D_targets: targetsCheck,
      },
      E_audit_trail: recent,
      notes: [
        'Programmatic smoke only — the UI click-through (login → pick each card → land on correct dashboard) is still manual.',
        'See DEMO-SMOKE-CHECKLIST in the PRD for the manual steps.',
        'To rerun: GET /api/demo/smoke from a super_admin browser tab.',
      ],
    },
    { status: allOk ? 200 : 500 },
  );
}
