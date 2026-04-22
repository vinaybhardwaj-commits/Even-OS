import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Temporary diagnostic for /admin/billing-v2 empty census.
 * super_admin only. Returns row counts + status breakdown + first 5
 * encounters for the caller's hospital so we can tell whether the
 * 0-rows census is correct (nobody admitted) or a query bug.
 */
export async function GET() {
  const caller = await getCurrentUser();
  if (!caller) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }
  if (caller.role !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'super_admin only' }, { status: 403 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const hospitalId = caller.hospital_id;

  try {
    const totals = await sql`
      SELECT COUNT(*)::int AS total FROM encounters WHERE hospital_id = ${hospitalId}
    `;
    const byStatus = await sql`
      SELECT status, COUNT(*)::int AS cnt
      FROM encounters WHERE hospital_id = ${hospitalId}
      GROUP BY status ORDER BY cnt DESC
    `;
    const byClass = await sql`
      SELECT encounter_class, COUNT(*)::int AS cnt
      FROM encounters WHERE hospital_id = ${hospitalId}
      GROUP BY encounter_class ORDER BY cnt DESC
    `;
    const inProgress = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM encounters WHERE hospital_id = ${hospitalId} AND status = 'in-progress'
    `;
    const recent = await sql`
      SELECT e.id, e.status, e.encounter_class, e.admission_at, e.discharge_at,
             p.name_full, p.uhid
      FROM encounters e
      JOIN patients p ON p.id = e.patient_id
      WHERE e.hospital_id = ${hospitalId}
      ORDER BY e.admission_at DESC NULLS LAST
      LIMIT 5
    `;
    const patientsCount = await sql`
      SELECT COUNT(*)::int AS cnt FROM patients WHERE hospital_id = ${hospitalId}
    `;

    return NextResponse.json({
      ok: true,
      hospital_id: hospitalId,
      encounters_total: (totals as any)[0]?.total ?? 0,
      encounters_in_progress: (inProgress as any)[0]?.cnt ?? 0,
      patients_total: (patientsCount as any)[0]?.cnt ?? 0,
      by_status: byStatus,
      by_class: byClass,
      recent_5: recent,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 },
    );
  }
}
