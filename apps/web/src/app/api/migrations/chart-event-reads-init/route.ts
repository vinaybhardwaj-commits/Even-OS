import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.4.B.3 migration — chart_notification_event_reads.
 *
 * 1. Enum: cnr_state ('unread','read','dismissed')
 * 2. Table chart_notification_event_reads
 *    - UNIQUE (event_id, user_id)
 *    - indexes on (user_id, state) and (event_id)
 *
 * No backfill needed — absence of a row = unread. That's the entire
 * behavioral contract.
 *
 * Idempotent. GET-only; run once from a super_admin browser session after
 * Vercel turns green for the B.3 commit.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    // ── 1. Enum (guarded) ───────────────────────────────────────────
    await sql`
      DO $$ BEGIN
        CREATE TYPE cnr_state AS ENUM ('unread','read','dismissed');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `;
    steps.push('CREATE TYPE cnr_state');

    // ── 2. Table ────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS chart_notification_event_reads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL REFERENCES chart_notification_events(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        state cnr_state NOT NULL DEFAULT 'unread',
        seen_at timestamptz,
        dismissed_at timestamptz,
        ack_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    steps.push('CREATE TABLE chart_notification_event_reads');

    // ── 3. Indexes ──────────────────────────────────────────────────
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_chart_evt_read
        ON chart_notification_event_reads (event_id, user_id)
    `;
    steps.push('CREATE UNIQUE INDEX uniq_chart_evt_read');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_evt_read_user
        ON chart_notification_event_reads (user_id, state)
    `;
    steps.push('CREATE INDEX idx_chart_evt_read_user');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_evt_read_event
        ON chart_notification_event_reads (event_id)
    `;
    steps.push('CREATE INDEX idx_chart_evt_read_event');

    return NextResponse.json({ ok: true, steps });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, steps, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
