import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * CHAT.X.6 migration — tasks table.
 *
 * Creates the structured `tasks` table that backs the /task slash
 * command. /task continues to write a chat_messages row (so the task
 * card still renders inline in the channel) AND now also writes a
 * tasks row, with `chat_message_id` linking the two.
 *
 * Idempotent. Safe to re-run: CREATE TABLE / INDEX use IF NOT EXISTS.
 *
 * GET-only; call once from a super_admin browser session, then verify
 * via SELECT count(*) FROM tasks;
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    // ── 1. Create table ──────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
        hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        created_by UUID NOT NULL REFERENCES users(id),
        assignee_id UUID NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT,
        due_at TIMESTAMPTZ,
        priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent','critical')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled','reassigned')),
        encounter_id UUID REFERENCES encounters(id),
        patient_id UUID REFERENCES patients(id),
        completed_at TIMESTAMPTZ,
        completed_by UUID REFERENCES users(id),
        reassigned_from UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    steps.push('CREATE TABLE tasks');

    // ── 2. Indexes ───────────────────────────────────────────────────
    await sql`
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status
        ON tasks (assignee_id, status)
        WHERE status IN ('pending','in_progress')
    `;
    steps.push('CREATE INDEX idx_tasks_assignee_status');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_tasks_encounter
        ON tasks (encounter_id)
        WHERE encounter_id IS NOT NULL
    `;
    steps.push('CREATE INDEX idx_tasks_encounter');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_tasks_chat_message
        ON tasks (chat_message_id)
        WHERE chat_message_id IS NOT NULL
    `;
    steps.push('CREATE INDEX idx_tasks_chat_message');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_tasks_hospital_created
        ON tasks (hospital_id, created_at DESC)
    `;
    steps.push('CREATE INDEX idx_tasks_hospital_created');

    // ── 3. Verify table + columns ────────────────────────────────────
    const cols = (await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'tasks'
      ORDER BY ordinal_position
    `) as Array<{ column_name: string; data_type: string; is_nullable: string }>;

    if (cols.length < 17) {
      throw new Error(`tasks table has ${cols.length} columns, expected 17`);
    }
    steps.push(`verified tasks table (${cols.length} columns)`);

    // ── 4. Sanity counts ─────────────────────────────────────────────
    const [counts] = (await sql`
      SELECT
        (SELECT COUNT(*) FROM tasks)::int AS task_rows,
        (SELECT COUNT(*) FROM chat_messages WHERE message_type = 'task')::int AS chat_task_messages
    `) as Array<{ task_rows: number; chat_task_messages: number }>;

    return NextResponse.json({
      ok: true,
      migration: '0057_tasks',
      steps,
      columns: cols,
      counts,
    });
  } catch (err: any) {
    console.error('[migration tasks-table] failed:', err);
    return NextResponse.json(
      { ok: false, steps, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
