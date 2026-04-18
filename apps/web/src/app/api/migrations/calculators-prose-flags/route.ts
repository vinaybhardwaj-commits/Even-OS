import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.2c3 migration — creates `calc_prose_flags` table for the prose
 * triage queue surfaced in /admin/ai-observatory ("Prose Flags" tab).
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS calc_prose_flags (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        calc_result_id   uuid NOT NULL REFERENCES calculator_results(id) ON DELETE CASCADE,
        hospital_id      text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        source           text NOT NULL,
        details          jsonb NOT NULL DEFAULT '{}'::jsonb,
        status           text NOT NULL DEFAULT 'open',
        disposition      text NULL,
        resolved_by      uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        resolved_at      timestamptz NULL,
        resolution_notes text NULL,
        created_at       timestamptz NOT NULL DEFAULT now()
      )
    `;
    steps.push('CREATE TABLE calc_prose_flags');

    await sql`CREATE INDEX IF NOT EXISTS idx_calc_prose_flags_status ON calc_prose_flags (status, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_calc_prose_flags_result ON calc_prose_flags (calc_result_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_calc_prose_flags_hospital ON calc_prose_flags (hospital_id)`;
    steps.push('CREATE INDEX x3');

    const backfillDeclined = (await sql`
      INSERT INTO calc_prose_flags (calc_result_id, hospital_id, source, details, status)
      SELECT cr.id,
             cr.hospital_id,
             'reviewer_declined',
             jsonb_build_object(
               'reason', COALESCE(cr.inputs->'__flag'->>'reason', '(no reason captured)')
             ),
             'open'
        FROM calculator_results cr
        WHERE cr.prose_status = 'declined'
          AND NOT EXISTS (
            SELECT 1 FROM calc_prose_flags f
             WHERE f.calc_result_id = cr.id AND f.source = 'reviewer_declined'
          )
      RETURNING id
    `) as Array<{ id: string }>;
    steps.push(`back-filled ${backfillDeclined.length} reviewer_declined flags`);

    const cols = (await sql`
      SELECT column_name, data_type
        FROM information_schema.columns
       WHERE table_name = 'calc_prose_flags'
       ORDER BY ordinal_position
    `) as Array<{ column_name: string; data_type: string }>;
    if (cols.length < 11) {
      throw new Error(`expected 11+ columns, got ${cols.length}`);
    }
    steps.push(`verified ${cols.length} columns`);

    return NextResponse.json({
      ok: true,
      steps,
      columns: cols,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message, steps },
      { status: 500 },
    );
  }
}
