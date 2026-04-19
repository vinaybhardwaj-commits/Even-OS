import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.4.A.4 migration — patient_complaints table.
 *
 * 1. CREATE TYPE pc_complaint_priority ('low','normal','high','critical')
 * 2. CREATE TYPE pc_complaint_status ('open','in_progress','resolved','closed')
 * 3. CREATE TABLE patient_complaints (see 58-patient-complaints.ts)
 * 4. 4 indexes.
 *
 * Idempotent. Re-running is safe: types guarded by DO $$ blocks, table via
 * IF NOT EXISTS, indexes via CREATE INDEX IF NOT EXISTS.
 *
 * GET-only; call once from a super_admin browser session.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    // ── 1. Enum types (guarded so re-run is safe) ────────────────────
    await sql`
      DO $$ BEGIN
        CREATE TYPE pc_complaint_priority AS ENUM ('low','normal','high','critical');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `;
    steps.push('CREATE TYPE pc_complaint_priority');

    await sql`
      DO $$ BEGIN
        CREATE TYPE pc_complaint_status AS ENUM ('open','in_progress','resolved','closed');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `;
    steps.push('CREATE TYPE pc_complaint_status');

    // ── 2. Table ─────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS patient_complaints (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,

        category text NOT NULL,
        priority pc_complaint_priority NOT NULL DEFAULT 'normal',
        status pc_complaint_status NOT NULL DEFAULT 'open',

        subject text NOT NULL,
        description text NOT NULL,

        sla_due_at timestamptz NOT NULL,

        raised_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        raised_by_user_name text NOT NULL,
        raised_by_user_role text NOT NULL,

        resolved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        resolved_by_user_name text,
        resolved_at timestamptz,
        resolution_note text,

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    steps.push('CREATE TABLE patient_complaints');

    // ── 3. Indexes ───────────────────────────────────────────────────
    await sql`
      CREATE INDEX IF NOT EXISTS idx_patient_complaints_patient
        ON patient_complaints(hospital_id, patient_id, status)
    `;
    steps.push('CREATE INDEX idx_patient_complaints_patient');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_patient_complaints_encounter
        ON patient_complaints(encounter_id)
    `;
    steps.push('CREATE INDEX idx_patient_complaints_encounter');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_patient_complaints_sla
        ON patient_complaints(status, sla_due_at)
    `;
    steps.push('CREATE INDEX idx_patient_complaints_sla');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_patient_complaints_raiser
        ON patient_complaints(raised_by_user_id)
    `;
    steps.push('CREATE INDEX idx_patient_complaints_raiser');

    // ── 4. Verify ────────────────────────────────────────────────────
    const colCheck = (await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'patient_complaints'
      ORDER BY ordinal_position
    `) as Array<{ column_name: string; data_type: string; is_nullable: string }>;

    const idxCheck = (await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'patient_complaints'
      ORDER BY indexname
    `) as Array<{ indexname: string }>;

    return NextResponse.json({
      ok: true,
      steps,
      columns: colCheck.length,
      column_names: colCheck.map((c) => c.column_name),
      indexes: idxCheck.map((i) => i.indexname),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: msg, steps },
      { status: 500 },
    );
  }
}
