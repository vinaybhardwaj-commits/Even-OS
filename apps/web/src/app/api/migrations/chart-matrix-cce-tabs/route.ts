import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.4.A.6 migration (19 Apr 2026, rewritten 19 Apr 2026 post-closeout) —
 * update the CCE tab array in `chart_permission_matrix` from the old
 *   ['overview','brief','documents','billing']
 * seeded by PC.3.1 to the PRD v2.0 §27 lock #1 order:
 *   ['overview','brief','comms','complaints','billing']
 *
 * Schema note: `chart_permission_matrix` keys on (role, role_tag, hospital_id)
 * — there is NO preset_key column. The original v1 of this endpoint UPDATEd
 * WHERE preset_key='cce' and soft-failed in prod. PC.3.2.1 activated
 * matrix-driven tab filtering (matrix wins over inline getTabsForRole()
 * fallback), so the rows in the matrix were actually authoritative and the
 * inline cceRoles branch was NOT taking effect for seeded hospitals.
 *
 * CCE persona covers 4 role slugs seeded per ROLE_TO_PRESET in
 * /api/migrations/chart-role-model:
 *   - 'cce' (canonical)
 *   - 'customer_care_executive'
 *   - 'ip_coordinator'
 *   - 'receptionist'
 * All four are updated in one statement.
 *
 * Idempotent — UPDATE is deterministic. Safe to re-run.
 */
const CCE_ROLE_SLUGS = ['cce', 'customer_care_executive', 'ip_coordinator', 'receptionist'] as const;
const NEW_TABS = ['overview', 'brief', 'comms', 'complaints', 'billing'] as const;
const NEW_DESCRIPTION =
  'Customer care / reception chart — Overview → Brief → Comms → Complaints → Bill (PRD v2.0 lock #1). Appointments dropped per §27.1.';

export async function POST() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not set' }, { status: 500 });
  }
  const sql = neon(url);
  try {
    const before = (await sql`
      SELECT role, hospital_id, tabs
        FROM chart_permission_matrix
       WHERE role = ANY(${CCE_ROLE_SLUGS as any}::text[])
         AND role_tag IS NULL
       ORDER BY hospital_id, role
    `) as Array<{ role: string; hospital_id: string; tabs: string[] }>;

    const result = (await sql`
      UPDATE chart_permission_matrix
         SET tabs        = ${NEW_TABS as any}::text[],
             description = ${NEW_DESCRIPTION},
             updated_at  = now()
       WHERE role = ANY(${CCE_ROLE_SLUGS as any}::text[])
         AND role_tag IS NULL
      RETURNING role, hospital_id, tabs
    `) as Array<{ role: string; hospital_id: string; tabs: string[] }>;

    return NextResponse.json({
      ok: true,
      updated: result.length,
      rows: result,
      before,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
