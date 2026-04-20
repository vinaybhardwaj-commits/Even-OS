import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * DEMO.1 migration — seed the universal demo account.
 *
 * Creates `demo@even.in` with password `demo1234`, role=`demo`, hospital=`EHRC`.
 * On login, this user lands on `/demo/picker` (enforced by middleware in DEMO.5)
 * and swaps into one of 4 test-user sessions via `POST /api/demo/switch`
 * (shipped in DEMO.3). No other code path should ever authenticate as `demo`.
 *
 * Guardrails baked in:
 *   - The DEMO_ACCOUNT_ENABLED env-flag gate was retired 20 Apr 2026 — the
 *     only kill switch now is to NOT run this migration, or to delete /
 *     deactivate the row after the fact. The row is authoritative: it exists
 *     iff demo login should work.
 *   - `must_change_password=false` so the picker path isn't blocked by a
 *     forced-password-change redirect.
 *   - `roles='{demo}'::text[]` is a new value but no enum change is required
 *     (users.roles is text[]).
 *   - `ON CONFLICT (email, hospital_id) DO NOTHING` — idempotent. Password hash
 *     is NOT updated on re-run; if V ever rotates it, run this after a
 *     targeted `UPDATE users SET password_hash = ... WHERE email = 'demo@even.in'`.
 *
 * The `hidden=true` column flip lives in DEMO.9 (separate migration). That
 * migration will also flip the 4 target test accounts to hidden=true so they
 * don't clutter the admin user lists.
 *
 * Precomputed bcrypt hash for 'demo1234' (12 rounds, matches SALT_ROUNDS in
 * lib/auth/password.ts). Generated via:
 *   node -e "console.log(require('bcryptjs').hashSync('demo1234', 12))"
 *
 * GET-only; call once from a super_admin browser session, then verify.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    const hospitalId = 'EHRC';
    const email = 'demo@even.in';
    const fullName = 'Demo Account';
    // bcrypt hash of 'demo1234' with SALT_ROUNDS=12
    const passwordHash = '$2a$12$kLQN0RGVFc7Hi0nO4QFjkObroPlJAKpyf6dqmzxJ1DiWLISbpH7S6';

    // ── 1. Insert demo user (idempotent) ───────────────────────────
    const result = await sql`
      INSERT INTO users (
        hospital_id, email, full_name, roles, department,
        password_hash, status, must_change_password
      )
      VALUES (
        ${hospitalId}, ${email}, ${fullName},
        '{demo}'::text[], 'Demo',
        ${passwordHash}, 'active', false
      )
      ON CONFLICT (email, hospital_id) DO NOTHING
      RETURNING id, email, roles, status
    `;

    if (result.length > 0) {
      steps.push(`INSERT users (demo@even.in) — id=${result[0].id}`);
    } else {
      steps.push('demo@even.in already exists — skipped INSERT');
    }

    // ── 2. Verify the row is present and has role=demo ────────────
    const verify = (await sql`
      SELECT id, email, roles, status, must_change_password
      FROM users
      WHERE email = ${email} AND hospital_id = ${hospitalId}
    `) as Array<{
      id: string;
      email: string;
      roles: string[];
      status: string;
      must_change_password: boolean;
    }>;

    if (verify.length !== 1) {
      throw new Error(`Expected 1 demo row, found ${verify.length}`);
    }
    const row = verify[0];
    if (!Array.isArray(row.roles) || !row.roles.includes('demo')) {
      throw new Error(`demo row roles missing 'demo': ${JSON.stringify(row.roles)}`);
    }
    if (row.status !== 'active') {
      throw new Error(`demo row status is ${row.status}, expected active`);
    }
    if (row.must_change_password) {
      throw new Error('demo row must_change_password=true — will block picker flow');
    }

    steps.push(`verify OK — id=${row.id}, roles=${JSON.stringify(row.roles)}`);

    return NextResponse.json({
      ok: true,
      migration: '0059_demo_user_seed',
      steps,
      envNote:
        'DEMO_ACCOUNT_ENABLED gate retired 20 Apr 2026 — demo login is ACTIVE whenever this row exists.',
      demoUser: row,
    });
  } catch (err: any) {
    console.error('[migration demo-account-seed] failed:', err);
    return NextResponse.json(
      { ok: false, steps, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
