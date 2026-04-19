import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.3.4 Track E — create chart_permission_matrix_versions table.
 *
 * Idempotent. Creates the table + indexes if missing. Matches the
 * Drizzle definition in drizzle/schema/57-chart-matrix-versions.ts.
 *
 * Does NOT backfill v1 snapshots — the first chartMatrix.update after
 * this migration will emit v1 organically. (A backfill pass would
 * require picking a "before" snapshot, which we don't have; skipping
 * it keeps the timeline clean: v1 = first tracked edit.)
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS chart_permission_matrix_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        matrix_id uuid NOT NULL REFERENCES chart_permission_matrix(id) ON DELETE CASCADE,
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        version_number integer NOT NULL,
        snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        changed_keys text[] NOT NULL DEFAULT '{}',
        change_note text,
        changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
        changed_by_name text,
        changed_by_role text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    steps.push('created chart_permission_matrix_versions table');

    await sql`CREATE INDEX IF NOT EXISTS idx_matrix_versions_matrix   ON chart_permission_matrix_versions(matrix_id, version_number)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_matrix_versions_hospital ON chart_permission_matrix_versions(hospital_id, created_at)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_matrix_version   ON chart_permission_matrix_versions(matrix_id, version_number)`;
    steps.push('created 3 indexes (incl. uniq_matrix_version)');

    const check = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'chart_permission_matrix_versions'
      ORDER BY ordinal_position
    `) as Array<{ column_name: string }>;
    steps.push(`verified ${check.length} columns: ${check.map((c) => c.column_name).join(', ')}`);

    return NextResponse.json({ ok: true, steps });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message, steps }, { status: 500 });
  }
}
