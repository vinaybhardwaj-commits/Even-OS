import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * DEMO.9 — add `users.hidden` column + flag the 5 demo/test accounts.
 *
 * Why this migration exists:
 *
 *   The demo stack (DEMO.1–8) added one demo user + promotes four
 *   pre-existing test users as personas. All five are real rows in
 *   `users` with real hospital_id='EHRC' memberships, so they appear
 *   in the admin People page alongside genuine clinicians. That's
 *   noise — an EHRC admin scanning their staff list should not see
 *   `demo@even.in` or `test.nurse@even.in` unless they explicitly
 *   ask for "hidden accounts".
 *
 *   We intentionally did NOT solve this by suspending / deleting the
 *   rows — they need to stay `status='active'` so the session swap
 *   in /api/demo/switch finds them (the route filters on
 *   status='active' for safety). Adding a distinct `hidden` column
 *   lets us keep the rows operational while scrubbing them from
 *   admin display lists.
 *
 * What this migration does:
 *
 *   1. ALTER TABLE users ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false
 *      (idempotent via IF NOT EXISTS — safe to re-run)
 *
 *   2. CREATE INDEX idx_users_hidden ON users(hidden)
 *      (supports the WHERE hidden=false filter that will fire on
 *      every admin user-list query)
 *
 *   3. UPDATE users SET hidden=true
 *      WHERE email IN (<5 demo/test emails>) AND hospital_id='EHRC'
 *
 *   4. Verify exactly 5 rows flipped; else surface a warning.
 *
 * What this migration does NOT do:
 *
 *   • Does NOT suspend or delete any user row.
 *   • Does NOT touch hospitals / roles / role_permissions / audit_log.
 *   • Does NOT reach into any enforcement path — auth login, profile,
 *     shift lookups etc. all use exact-ID lookups and ignore hidden.
 *     Only display-layer queries (admin People list, Roles & Permissions
 *     user counts, Role-drilldown user list) filter on hidden=false.
 *
 * Guardrails:
 *   • All three statements are idempotent — safe to re-run.
 *   • UPDATE is scoped to the exact 5 emails AND hospital_id='EHRC'
 *     — zero risk of flipping other tenants or unrelated users.
 *   • GET-only; call once from a super_admin browser session.
 */

const DEMO_EMAILS = [
  'demo@even.in',
  'dr.patel@even.in',
  'dr.arun.jose@even.in',
  'charge.nurse@even.in',
  'test.nurse@even.in',
  'test.ipd@even.in',
] as const;

export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    // ── 1. Add `hidden` column (idempotent) ────────────────────────
    await sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false
    `;
    steps.push('ALTER TABLE users ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false');

    // ── 2. Create supporting index ─────────────────────────────────
    await sql`
      CREATE INDEX IF NOT EXISTS idx_users_hidden ON users(hidden)
    `;
    steps.push('CREATE INDEX idx_users_hidden ON users(hidden)');

    // ── 3. Flag the 5 demo/test accounts ───────────────────────────
    const flipped = (await sql`
      UPDATE users
      SET hidden = true, updated_at = NOW()
      WHERE email = ANY(${DEMO_EMAILS as unknown as string[]}::text[])
        AND hospital_id = 'EHRC'
        AND hidden = false
      RETURNING id, email
    `) as Array<{ id: string; email: string }>;

    steps.push(
      `UPDATE users SET hidden=true — matched ${flipped.length} row(s): ` +
        flipped.map((r) => r.email).join(', '),
    );

    // ── 4. Verify: all 5 emails now exist and are hidden ───────────
    const hiddenRows = (await sql`
      SELECT email, hidden, status
      FROM users
      WHERE email = ANY(${DEMO_EMAILS as unknown as string[]}::text[])
        AND hospital_id = 'EHRC'
      ORDER BY email
    `) as Array<{ email: string; hidden: boolean; status: string }>;

    const problems: string[] = [];
    for (const email of DEMO_EMAILS) {
      const row = hiddenRows.find((r) => r.email === email);
      if (!row) {
        problems.push(`${email} not found in EHRC (expected — run seed-test-data / demo-account-seed first)`);
      } else if (!row.hidden) {
        problems.push(`${email} exists but hidden=false`);
      }
    }

    if (problems.length > 0) {
      steps.push(`⚠️  verification issues: ${problems.join('; ')}`);
    } else {
      steps.push(`verify OK — all ${DEMO_EMAILS.length} demo/test rows are hidden=true`);
    }

    // Informational counts
    const totalHiddenRows = (await sql`
      SELECT COUNT(*)::int AS count FROM users WHERE hidden = true AND hospital_id = 'EHRC'
    `) as Array<{ count: number }>;
    const totalActive = (await sql`
      SELECT COUNT(*)::int AS count FROM users
      WHERE hidden = false AND status = 'active' AND hospital_id = 'EHRC'
    `) as Array<{ count: number }>;

    return NextResponse.json({
      ok: problems.length === 0,
      migration: '0060_users_hidden',
      steps,
      flipped_now: flipped.length,
      hidden_rows: hiddenRows,
      counts: {
        hidden_total_ehrc: totalHiddenRows[0]?.count ?? 0,
        visible_active_ehrc: totalActive[0]?.count ?? 0,
      },
      problems,
      note:
        'Display-layer filter lives in server/routers/users.ts::list (default hides) and ' +
        'server/routers/roles.ts user-count queries. Exact-ID lookups (auth login, profile, ' +
        'shifts, etc.) are intentionally NOT filtered — demo/test accounts must still be ' +
        'reachable by the session-swap route.',
    });
  } catch (err: any) {
    console.error('[migration users-hidden-seed] failed:', err);
    return NextResponse.json(
      { ok: false, steps, error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
