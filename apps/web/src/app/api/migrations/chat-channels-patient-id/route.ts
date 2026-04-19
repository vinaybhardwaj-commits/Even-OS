import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.4.A.1 migration — persistent patient chat channels.
 *
 * 1. ALTER TABLE chat_channels ADD COLUMN patient_id uuid NULL REFERENCES patients(id)
 * 2. CREATE INDEX idx_chat_channels_patient(hospital_id, patient_id)
 * 3. Backfill: for each patient without a persistent channel, insert one
 *    with channel_id = `patient-persistent-<patient_id>`, channel_type = 'patient',
 *    patient_id set, encounter_id NULL, created_by = any super_admin (or the
 *    first available user in that hospital if no super_admin exists).
 *
 * Idempotent. Re-running is safe: ALTER/INDEX use IF NOT EXISTS, backfill
 * skips patients that already have a persistent row.
 *
 * GET-only; call once from a super_admin browser session.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    // ── 1. Schema change ─────────────────────────────────────────────
    await sql`
      ALTER TABLE chat_channels
        ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id)
    `;
    steps.push('ALTER TABLE chat_channels ADD COLUMN patient_id');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chat_channels_patient
        ON chat_channels(hospital_id, patient_id)
    `;
    steps.push('CREATE INDEX idx_chat_channels_patient');

    // ── 2. Verify column present ─────────────────────────────────────
    const colCheck = (await sql`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'chat_channels' AND column_name = 'patient_id'
    `) as Array<{ column_name: string; data_type: string; is_nullable: string }>;
    if (colCheck.length !== 1) {
      throw new Error('patient_id column missing after ALTER');
    }
    steps.push(`verified patient_id (${colCheck[0].data_type}, nullable=${colCheck[0].is_nullable})`);

    // ── 3. Backfill persistent channels ──────────────────────────────
    // For each hospital, find a fallback user (super_admin preferred, else any active user)
    // to use as created_by for backfilled channels. Then insert one persistent
    // channel per patient that doesn't have one yet.

    const hospitals = (await sql`
      SELECT DISTINCT p.hospital_id, h.hospital_name
      FROM patients p
      JOIN hospitals h ON h.hospital_id = p.hospital_id
    `) as Array<{ hospital_id: string; hospital_name: string }>;

    let totalInserted = 0;
    const perHospital: Array<{ hospital_id: string; inserted: number; fallback_user: string | null }> = [];

    for (const hosp of hospitals) {
      // Pick a fallback user for created_by (persistent rooms created at registration
      // in new flows will use ctx.user.sub; this backfill uses any super_admin/admin).
      const [fallback] = (await sql`
        SELECT u.id FROM users u
        WHERE u.hospital_id = ${hosp.hospital_id}
          AND u.status = 'active'
        ORDER BY
          CASE WHEN 'super_admin' = ANY(u.roles) THEN 0
               WHEN 'admin' = ANY(u.roles) THEN 1
               ELSE 2 END,
          u.created_at ASC
        LIMIT 1
      `) as Array<{ id: string }>;

      if (!fallback) {
        perHospital.push({ hospital_id: hosp.hospital_id, inserted: 0, fallback_user: null });
        continue;
      }

      // Insert persistent channels for patients that don't have one.
      // Name pattern uses the patient's name and UHID for readability.
      const inserted = (await sql`
        INSERT INTO chat_channels (
          channel_id, channel_type, name, description,
          hospital_id, patient_id, encounter_id, created_by, metadata
        )
        SELECT
          'patient-persistent-' || p.id::text,
          'patient',
          COALESCE(p.name_full, p.name_given || ' ' || p.name_family) || ' — all admissions',
          'Persistent patient channel (spans all encounters) — UHID ' || p.uhid,
          p.hospital_id,
          p.id,
          NULL,
          ${fallback.id}::uuid,
          '{}'::jsonb
        FROM patients p
        WHERE p.hospital_id = ${hosp.hospital_id}
          AND NOT EXISTS (
            SELECT 1 FROM chat_channels cc
            WHERE cc.patient_id = p.id AND cc.encounter_id IS NULL
          )
        RETURNING id
      `) as Array<{ id: string }>;

      totalInserted += inserted.length;
      perHospital.push({
        hospital_id: hosp.hospital_id,
        inserted: inserted.length,
        fallback_user: fallback.id,
      });
    }

    steps.push(`backfilled ${totalInserted} persistent channel(s) across ${hospitals.length} hospital(s)`);

    // ── 4. Sanity check: count persistent rooms ──────────────────────
    const [totals] = (await sql`
      SELECT
        COUNT(*)::int FILTER (WHERE patient_id IS NOT NULL AND encounter_id IS NULL) AS persistent,
        COUNT(*)::int FILTER (WHERE encounter_id IS NOT NULL) AS encounter_scoped,
        COUNT(*)::int FILTER (WHERE channel_type = 'department') AS departments
      FROM chat_channels
    `) as Array<{ persistent: number; encounter_scoped: number; departments: number }>;

    return NextResponse.json({
      ok: true,
      migration: '0056_chat_channels_patient_id',
      steps,
      per_hospital: perHospital,
      totals,
    });
  } catch (err: any) {
    console.error('[migration chat-channels-patient-id] failed:', err);
    return NextResponse.json(
      { ok: false, steps, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
