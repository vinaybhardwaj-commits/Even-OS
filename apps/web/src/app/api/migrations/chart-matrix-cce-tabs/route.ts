import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.4.A.6 migration (19 Apr 2026) — update CCE tab order in
 * chart_permission_matrix from the old ['overview','brief','documents','billing']
 * to the PRD v2.0 lock #1 order:
 *   ['overview','brief','comms','complaints','billing']
 *
 * Idempotent — only updates rows where preset_key = 'cce'. If a hospital
 * has never run /api/migrations/chart-role-model, there will be no CCE
 * row and this is a no-op.
 *
 * Safe to re-run — UPDATE is deterministic.
 */
export async function POST() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json({ ok: false, error: 'DATABASE_URL not set' }, { status: 500 });
  }
  const sql = neon(url);
  try {
    const result = (await sql`
      UPDATE chart_permission_matrix
         SET tabs = ARRAY['overview','brief','comms','complaints','billing']::text[],
             description = 'Customer care / reception chart — Overview → Brief → Comms → Complaints → Bill (PRD v2.0 lock #1). Appointments dropped per §27.1.',
             updated_at  = now()
       WHERE preset_key = 'cce'
       RETURNING hospital_id, role_id, tabs
    `) as Array<{ hospital_id: string; role_id: string; tabs: string[] }>;

    return NextResponse.json({
      ok: true,
      updated: result.length,
      rows: result,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
