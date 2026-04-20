import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users, auditLog } from '@db/schema';
import { getCurrentUser, createSession, destroySession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit/logger';
import { isDemoRoleKey, getDemoRole } from '@/lib/demo/roles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * DEMO.3 — POST /api/demo/switch
 *
 * Swaps the current demo session into a target test-user session.
 * This is the beating heart of the persona picker: the demo login's
 * own session is destroyed and a fresh session is minted as the
 * configured target user (e.g. dr.patel@even.in).
 *
 * Why a Route Handler (not tRPC)?
 *   - We need full control over response shape + cookie mutation order
 *     (destroy demo cookie → set target cookie), which is fiddly to
 *     do cleanly through tRPC's wrapping.
 *   - We return JSON `{ ok: true, redirect: '/' }` rather than a
 *     literal 303 — the picker page (DEMO.4) will issue a hard
 *     `window.location.href = '/'` after a successful response so the
 *     new session cookie is picked up by the next request's middleware.
 *
 * Guardrails (in order):
 *   1. Caller must have a live session with role='demo' — else 403.
 *      (No anonymous, no full-user, no break-glass can hit this route.
 *      The env-flag `DEMO_ACCOUNT_ENABLED` gate was retired 20 Apr 2026;
 *      row-existence + role='demo' are now the primary auth check.)
 *   2. Body.role must be a DEMO_ROLES key — else 400.
 *   3. Rate-limit: at most 20 `demo.switch` audit rows for this actor
 *      in the last minute — else 429. Mirrors CHAT.X.9's COUNT-on-
 *      audit-log pattern (no extra table needed).
 *   4. Target user lookup: must exist in the same hospital, be
 *      status='active', and have at least one role — else 500.
 *
 * Audit row is written BEFORE destroySession so `actor_id` still
 * references the demo user; DEMO.9's hidden filter will keep these
 * rows out of the admin user-scoped reports but they remain queryable
 * under reason='demo.switch'.
 */

interface SwitchBody {
  role?: unknown;
}

export async function POST(req: NextRequest) {
  // Env kill-switch removed 20 Apr 2026 — the only thing that reaches this
  // route is a live session with role='demo', which can only be obtained
  // by logging in as demo@even.in (a row that only exists if the seed
  // migration was deliberately run). The role-gate below is now the primary
  // authorization check.

  // ── Caller must be the demo user ───────────────────────────────────
  const caller = await getCurrentUser();
  if (!caller) {
    return NextResponse.json(
      { ok: false, error: 'Not signed in.' },
      { status: 401 },
    );
  }
  if (caller.role !== 'demo') {
    return NextResponse.json(
      { ok: false, error: 'Only the demo account can use /api/demo/switch.' },
      { status: 403 },
    );
  }

  // ── 3. Body validation ──────────────────────────────────────────────
  let body: SwitchBody;
  try {
    body = (await req.json()) as SwitchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }
  const roleKey = typeof body.role === 'string' ? body.role : '';
  if (!isDemoRoleKey(roleKey)) {
    return NextResponse.json(
      { ok: false, error: 'Unknown demo role key.' },
      { status: 400 },
    );
  }
  const demoRole = getDemoRole(roleKey)!; // safe after isDemoRoleKey

  // ── 4. Rate-limit — 20 switches / minute / demo actor ───────────────
  // Counts audit rows for this actor with our semantic reason string.
  // Uses a narrow WHERE that's covered by idx_audit_log_actor_id +
  // idx_audit_log_timestamp.
  try {
    const rateRows = (await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM audit_log
      WHERE actor_id = ${caller.sub}::uuid
        AND reason = 'demo.switch'
        AND timestamp > NOW() - INTERVAL '1 minute'
    `)) as unknown as Array<{ count: number }>;
    const recent = Array.isArray(rateRows) && rateRows[0] ? rateRows[0].count : 0;
    if (recent >= 20) {
      return NextResponse.json(
        { ok: false, error: 'Too many role switches. Slow down.' },
        { status: 429 },
      );
    }
  } catch (err) {
    // Rate-limit check failure is non-fatal — log and continue. The env
    // gate + demo-only role already make this endpoint hard to abuse.
    console.warn('[demo.switch] rate-limit query failed:', err);
  }

  // ── 5. Target user lookup (same hospital as the demo user) ──────────
  const [target] = await db
    .select({
      id: users.id,
      hospital_id: users.hospital_id,
      email: users.email,
      full_name: users.full_name,
      roles: users.roles,
      department: users.department,
      status: users.status,
    })
    .from(users)
    .where(
      and(
        eq(users.email, demoRole.target_email),
        eq(users.hospital_id, caller.hospital_id),
      ),
    )
    .limit(1);

  if (!target) {
    console.error(
      `[demo.switch] target user not found: ${demoRole.target_email} @ ${caller.hospital_id}`,
    );
    return NextResponse.json(
      { ok: false, error: `Target user not provisioned: ${demoRole.target_email}` },
      { status: 500 },
    );
  }
  if (target.status !== 'active') {
    return NextResponse.json(
      { ok: false, error: `Target user is ${target.status}, not active.` },
      { status: 500 },
    );
  }

  const targetPrimaryRole =
    Array.isArray(target.roles) && target.roles.length > 0
      ? (target.roles[0] as string)
      : 'staff';

  // ── 6. Audit BEFORE the swap — keeps actor_id tied to the demo user ──
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined;
  const userAgent = req.headers.get('user-agent') ?? undefined;

  await writeAuditLog(caller, {
    action: 'ACCESS',
    table_name: 'users',
    row_id: target.id,
    reason: 'demo.switch',
    new_values: {
      role_key: demoRole.key,
      target_email: target.email,
      target_user_id: target.id,
      target_role: targetPrimaryRole,
    },
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  // ── 7. Swap sessions: destroy demo → create target ──────────────────
  await destroySession();
  await createSession({
    id: target.id,
    hospital_id: target.hospital_id,
    role: targetPrimaryRole,
    email: target.email,
    full_name: target.full_name,
    department: target.department ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    redirect: '/',
    user: {
      id: target.id,
      email: target.email,
      full_name: target.full_name,
      role: targetPrimaryRole,
      department: target.department,
    },
  });
}
