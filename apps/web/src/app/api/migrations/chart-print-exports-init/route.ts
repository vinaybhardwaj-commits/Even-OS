import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.4.D.2.1 migration — chart_print_exports.
 *
 * Audit + file log for per-tab PDF exports from the Patient Chart.
 *
 * 1. Enum: cpe_status ('generating','ready','failed')
 * 2. Table chart_print_exports with 16 columns:
 *    - hospital_id / user_id / user_name / user_role (denorm for audit)
 *    - patient_id / uhid_at_time (denorm — UHID at time of print)
 *    - scope ('tab:overview', 'tab:notes', ...) — text for D.3 extensibility
 *    - tab_name / watermark (rendered string frozen at gen time)
 *    - file_url (Vercel Blob URL, may be null if status=failed)
 *    - file_size_bytes / page_count
 *    - status (generating -> ready | failed)
 *    - error (set if status=failed)
 *    - created_at / ready_at
 *
 * Indexes:
 *    - idx_chart_print_patient_created (patient_id, created_at) — chart history
 *    - idx_chart_print_user_created (user_id, created_at) — admin audit
 *    - idx_chart_print_hospital_created (hospital_id, created_at) — tenant scope
 *
 * Denorm columns (user_name, user_role, uhid_at_time, watermark) are frozen
 * at export time for audit immutability — prints are legal records. Later
 * renames/role changes/UHID changes must not rewrite history.
 *
 * Idempotent. GET-only; run once from a super_admin browser session after
 * Vercel turns green for the D.2.1 commit.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    // ── 1. Enum (guarded) ───────────────────────────────────────────
    await sql`
      DO $$ BEGIN
        CREATE TYPE cpe_status AS ENUM ('generating','ready','failed');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `;
    steps.push('CREATE TYPE cpe_status');

    // ── 2. Table ────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS chart_print_exports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        user_name text NOT NULL,
        user_role text NOT NULL,
        patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
        uhid_at_time text NOT NULL,
        scope text NOT NULL,
        tab_name text NOT NULL,
        watermark text NOT NULL,
        file_url text,
        file_size_bytes integer,
        page_count integer,
        status cpe_status NOT NULL DEFAULT 'generating',
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        ready_at timestamptz
      )
    `;
    steps.push('CREATE TABLE chart_print_exports');

    // ── 3. Indexes ──────────────────────────────────────────────────
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_print_patient_created
        ON chart_print_exports (patient_id, created_at DESC)
    `;
    steps.push('CREATE INDEX idx_chart_print_patient_created');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_print_user_created
        ON chart_print_exports (user_id, created_at DESC)
    `;
    steps.push('CREATE INDEX idx_chart_print_user_created');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_print_hospital_created
        ON chart_print_exports (hospital_id, created_at DESC)
    `;
    steps.push('CREATE INDEX idx_chart_print_hospital_created');

    return NextResponse.json({ ok: true, steps });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, steps, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
