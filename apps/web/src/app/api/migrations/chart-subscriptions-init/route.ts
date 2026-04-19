import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * PC.4.B.1 migration — chart_subscriptions + chart_notification_events.
 *
 * 1. Enums: cs_source, cne_event_type, cne_severity
 * 2. Table chart_subscriptions (4 indexes incl. UNIQUE patient_id+user_id)
 * 3. Table chart_notification_events (4 indexes incl. partial UNIQUE on dedup_key)
 * 4. Backfill: for every in-progress encounter, seed auto_care_team rows for
 *    attending_practitioner + all active patient_assignments nurses.
 *    ON CONFLICT: no-op (don't clobber existing rows from a previous run).
 *
 * Idempotent. GET-only; call once from a super_admin browser session.
 */
export async function GET() {
  const sql = neon(process.env.DATABASE_URL!);
  const steps: string[] = [];

  try {
    // ── 1. Enums (guarded so re-run is safe) ────────────────────────
    await sql`
      DO $$ BEGIN
        CREATE TYPE cs_source AS ENUM ('auto_care_team','watch');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `;
    steps.push('CREATE TYPE cs_source');

    await sql`
      DO $$ BEGIN
        CREATE TYPE cne_event_type AS ENUM (
          'critical_vital',
          'critical_lab',
          'cosign_overdue',
          'llm_proposal_new',
          'calc_red_band',
          'encounter_transition',
          'edit_lock_override'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `;
    steps.push('CREATE TYPE cne_event_type');

    await sql`
      DO $$ BEGIN
        CREATE TYPE cne_severity AS ENUM ('critical','high','normal','info');
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `;
    steps.push('CREATE TYPE cne_severity');

    // ── 2. chart_subscriptions ──────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS chart_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        source cs_source NOT NULL,
        role_snapshot text,

        silenced boolean NOT NULL DEFAULT false,
        silenced_at timestamptz,
        silenced_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        silenced_reason text,

        event_filters text[],

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
      )
    `;
    steps.push('CREATE TABLE chart_subscriptions');

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_subscriptions_patient_user
        ON chart_subscriptions(patient_id, user_id)
    `;
    steps.push('CREATE UNIQUE INDEX idx_chart_subscriptions_patient_user');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_subscriptions_user
        ON chart_subscriptions(user_id)
    `;
    steps.push('CREATE INDEX idx_chart_subscriptions_user');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_subscriptions_patient_silenced
        ON chart_subscriptions(patient_id, silenced)
    `;
    steps.push('CREATE INDEX idx_chart_subscriptions_patient_silenced');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_subscriptions_hospital
        ON chart_subscriptions(hospital_id)
    `;
    steps.push('CREATE INDEX idx_chart_subscriptions_hospital');

    // ── 3. chart_notification_events ────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS chart_notification_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        hospital_id text NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
        patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,

        event_type cne_event_type NOT NULL,
        severity cne_severity NOT NULL DEFAULT 'normal',

        source_kind text NOT NULL,
        source_id uuid,

        dedup_key text,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,

        fired_at timestamptz NOT NULL DEFAULT now(),
        fired_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
      )
    `;
    steps.push('CREATE TABLE chart_notification_events');

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_notification_events_dedup
        ON chart_notification_events(dedup_key)
        WHERE dedup_key IS NOT NULL
    `;
    steps.push('CREATE PARTIAL UNIQUE INDEX idx_chart_notification_events_dedup');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_notification_events_patient_fired
        ON chart_notification_events(patient_id, fired_at)
    `;
    steps.push('CREATE INDEX idx_chart_notification_events_patient_fired');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_notification_events_type_fired
        ON chart_notification_events(event_type, fired_at)
    `;
    steps.push('CREATE INDEX idx_chart_notification_events_type_fired');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_chart_notification_events_hospital_fired
        ON chart_notification_events(hospital_id, fired_at)
    `;
    steps.push('CREATE INDEX idx_chart_notification_events_hospital_fired');

    // ── 4. Backfill care-team rows from active encounters ───────────
    // Attendings first
    const attendingRes = (await sql`
      INSERT INTO chart_subscriptions (hospital_id, patient_id, user_id, source, role_snapshot)
      SELECT DISTINCT e.hospital_id, e.patient_id, e.attending_practitioner_id, 'auto_care_team'::cs_source, 'attending'
      FROM encounters e
      WHERE e.status = 'in-progress'
        AND e.attending_practitioner_id IS NOT NULL
      ON CONFLICT (patient_id, user_id) DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>;
    steps.push(`BACKFILL attendings: ${attendingRes.length} rows`);

    // Active nurse assignments
    const nurseRes = (await sql`
      INSERT INTO chart_subscriptions (hospital_id, patient_id, user_id, source, role_snapshot)
      SELECT DISTINCT pa.hospital_id, pa.patient_id, pa.nurse_id, 'auto_care_team'::cs_source, 'nurse'
      FROM patient_assignments pa
      INNER JOIN encounters e ON e.id = pa.encounter_id
      WHERE pa.status = 'active'
        AND e.status = 'in-progress'
      ON CONFLICT (patient_id, user_id) DO NOTHING
      RETURNING id
    `) as Array<{ id: string }>;
    steps.push(`BACKFILL nurses: ${nurseRes.length} rows`);

    // ── 5. Verify ────────────────────────────────────────────────────
    const subsCols = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'chart_subscriptions'
      ORDER BY ordinal_position
    `) as Array<{ column_name: string }>;

    const evCols = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'chart_notification_events'
      ORDER BY ordinal_position
    `) as Array<{ column_name: string }>;

    const subsIdx = (await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'chart_subscriptions'
      ORDER BY indexname
    `) as Array<{ indexname: string }>;

    const evIdx = (await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'chart_notification_events'
      ORDER BY indexname
    `) as Array<{ indexname: string }>;

    const counts = (await sql`
      SELECT
        (SELECT COUNT(*) FROM chart_subscriptions) AS subs_total,
        (SELECT COUNT(*) FROM chart_subscriptions WHERE source = 'auto_care_team') AS subs_auto,
        (SELECT COUNT(*) FROM chart_subscriptions WHERE source = 'watch') AS subs_watch,
        (SELECT COUNT(*) FROM chart_notification_events) AS events_total
    `) as Array<{ subs_total: string; subs_auto: string; subs_watch: string; events_total: string }>;

    return NextResponse.json({
      ok: true,
      steps,
      chart_subscriptions_columns: subsCols.map((c) => c.column_name),
      chart_notification_events_columns: evCols.map((c) => c.column_name),
      chart_subscriptions_indexes: subsIdx.map((i) => i.indexname),
      chart_notification_events_indexes: evIdx.map((i) => i.indexname),
      counts: counts[0],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg, steps }, { status: 500 });
  }
}
