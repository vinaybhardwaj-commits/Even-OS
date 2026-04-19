import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.3.4 Track A — create admin_audit_log table.
 *
 * Idempotent. Creates the table + indexes if missing. Matches the
 * Drizzle definition in drizzle/schema/56-admin-audit-log.ts.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        user_role text NOT NULL,
        action text NOT NULL,
        resource_type text NOT NULL,
        resource_id uuid,
        payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    steps.push('created admin_audit_log table');

    await sql`CREATE INDEX IF NOT EXISTS idx_admin_audit_hospital ON admin_audit_log(hospital_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_admin_audit_user     ON admin_audit_log(user_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_admin_audit_action   ON admin_audit_log(action, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_admin_audit_resource ON admin_audit_log(resource_type, resource_id)`;
    steps.push('created 4 indexes');

    // Verify
    const check = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'admin_audit_log'
      ORDER BY ordinal_position
    `) as Array<{ column_name: string }>;
    steps.push(`verified ${check.length} columns: ${check.map((c) => c.column_name).join(', ')}`);

    return NextResponse.json({ ok: true, steps });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message, steps }, { status: 500 });
  }
}
