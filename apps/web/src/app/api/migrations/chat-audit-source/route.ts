import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * CHAT.X.7 migration — chat_audit_log `source` column + relaxed user_id/user_name NOT NULL.
 *
 * Allows system-orchestrated actions (patient channel lifecycle in
 * channel-manager.ts; clinical auto-events in auto-events.ts) to log
 * into chat_audit_log without a human actor.
 *
 * Idempotent. Safe to re-run.
 *
 * GET-only; call once from a super_admin browser session, then verify.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    // ── 1. Relax NOT NULL on actor fields ────────────────────────────
    await sql`ALTER TABLE chat_audit_log ALTER COLUMN user_id DROP NOT NULL`;
    steps.push('DROP NOT NULL user_id');

    await sql`ALTER TABLE chat_audit_log ALTER COLUMN user_name DROP NOT NULL`;
    steps.push('DROP NOT NULL user_name');

    // ── 2. Add source column ─────────────────────────────────────────
    await sql`
      ALTER TABLE chat_audit_log
        ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user'
          CHECK (source IN ('user','system','integration'))
    `;
    steps.push('ADD COLUMN source');

    // ── 3. Add composite constraint (guarded) ────────────────────────
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_audit_user_req'
        ) THEN
          ALTER TABLE chat_audit_log
            ADD CONSTRAINT chk_audit_user_req
            CHECK (source <> 'user' OR (user_id IS NOT NULL AND user_name IS NOT NULL));
        END IF;
      END$$
    `;
    steps.push('ADD CONSTRAINT chk_audit_user_req');

    // ── 4. Index on (source, created_at) for split-by-source views ───
    await sql`
      CREATE INDEX IF NOT EXISTS idx_chat_audit_source
        ON chat_audit_log (source, created_at DESC)
    `;
    steps.push('CREATE INDEX idx_chat_audit_source');

    // ── 5. Verify ────────────────────────────────────────────────────
    const cols = (await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'chat_audit_log'
      ORDER BY ordinal_position
    `) as Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>;

    const sourceCol = cols.find((c) => c.column_name === 'source');
    if (!sourceCol) throw new Error('source column missing after migration');

    const userIdCol = cols.find((c) => c.column_name === 'user_id');
    const userNameCol = cols.find((c) => c.column_name === 'user_name');
    if (userIdCol?.is_nullable !== 'YES')
      throw new Error('user_id is still NOT NULL');
    if (userNameCol?.is_nullable !== 'YES')
      throw new Error('user_name is still NOT NULL');

    // Sanity: count rows by source
    const countsBySource = (await sql`
      SELECT source, COUNT(*)::int AS rows
      FROM chat_audit_log
      GROUP BY source
      ORDER BY source
    `) as Array<{ source: string; rows: number }>;

    return NextResponse.json({
      ok: true,
      migration: '0058_chat_audit_log_source',
      steps,
      columns: cols,
      countsBySource,
    });
  } catch (err: any) {
    console.error('[migration chat-audit-source] failed:', err);
    return NextResponse.json(
      { ok: false, steps, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
