import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/live-ops
 *
 * Single aggregated probe for the Command Center LiveOpsStrip.
 * Returns four groups: ops / alerts / revenue / health.
 *
 * Gated: logged-in users only. Admin-tier detail (alerts/revenue) is
 * returned for all logged-in users — the UI hides cells for non-admin
 * roles so we keep the shape stable for caching.
 *
 * Response shape (stable — consumed by <LiveOpsStrip />):
 * {
 *   ops:     { beds_occupied, beds_total, admissions_today, discharges_today, active_inpatients },
 *   alerts:  { open_incidents, unack_critical },
 *   revenue: { collections_today_inr, pending_claims, draft_invoices },
 *   health:  { db: { status: 'ok'|'degraded'|'down', latency_ms }, sha, env },
 *   timestamp: string,
 * }
 *
 * BUG.1 (19 Apr 2026): Previously all 9 aggregates + the DB health probe
 * shared one try/catch. If any single aggregate threw (schema drift on a
 * less-used table), the catch flipped dbStatus to 'down' — which is how
 * the Command Center strip showed SYSTEM=DOWN while /admin/status reported
 * DB=OK. Fixed by:
 *   1. Running a dedicated `SELECT 1` probe for dbStatus/dbLatency. Only
 *      this probe's success/failure controls the health cell.
 *   2. Wrapping each aggregate query in its own safeCount/safeSum helper so
 *      one broken table defaults that one metric to 0 and logs the error,
 *      instead of nuking the whole response.
 *   3. Logging via console.error so next time we actually see the cause
 *      in Vercel runtime logs (previously the catch was silent).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const timestamp = new Date().toISOString();
  const sql = neon(process.env.DATABASE_URL!);

  // ── 1. Dedicated DB health probe ────────────────────────────────────────
  // This is the ONLY query that controls dbStatus. A slow/failing aggregate
  // query no longer taints the health signal.
  let dbStatus: 'ok' | 'degraded' | 'down' = 'down';
  let dbLatency = 0;
  const dbStart = Date.now();
  try {
    await sql`SELECT 1`;
    dbLatency = Date.now() - dbStart;
    dbStatus = dbLatency < 500 ? 'ok' : 'degraded';
  } catch (err) {
    dbLatency = Date.now() - dbStart;
    dbStatus = 'down';
    console.error('[live-ops] DB health probe failed', err);
  }

  // ── 2. Per-query helpers ────────────────────────────────────────────────
  // Each aggregate is isolated so one failure defaults that one metric to 0
  // and emits a log line — the other metrics + the health cell survive.
  const safeCount = async (
    label: string,
    q: Promise<Array<Record<string, unknown>>>
  ): Promise<number> => {
    try {
      const rows = await q;
      return Number(rows[0]?.n ?? 0);
    } catch (err) {
      console.error(`[live-ops] aggregate "${label}" failed`, err);
      return 0;
    }
  };

  const safeBedStats = async (): Promise<{ occupied: number; total: number }> => {
    try {
      const rows = await sql`SELECT
            COUNT(*) FILTER (WHERE bed_status = 'occupied')::int AS occupied,
            COUNT(*)::int AS total
          FROM locations
          WHERE location_type = 'bed'`;
      return {
        occupied: Number(rows[0]?.occupied ?? 0),
        total: Number(rows[0]?.total ?? 0),
      };
    } catch (err) {
      console.error('[live-ops] aggregate "bed_stats" failed', err);
      return { occupied: 0, total: 0 };
    }
  };

  const safeCollections = async (): Promise<number> => {
    try {
      const rows = await sql`SELECT COALESCE(SUM(amount), 0)::numeric AS total
          FROM payments
          WHERE payment_date >= CURRENT_DATE
            AND payment_date < CURRENT_DATE + INTERVAL '1 day'`;
      return Math.round(Number(rows[0]?.total ?? 0));
    } catch (err) {
      console.error('[live-ops] aggregate "collections_today" failed', err);
      return 0;
    }
  };

  // ── 3. Parallel aggregate probes ────────────────────────────────────────
  const [
    bedStats,
    admissions_today,
    discharges_today,
    active_inpatients,
    open_incidents,
    unack_critical,
    collections_today_inr,
    pending_claims,
    draft_invoices,
  ] = await Promise.all([
    safeBedStats(),
    safeCount(
      'admissions_today',
      sql`SELECT COUNT(*)::int AS n
          FROM encounters
          WHERE admission_at >= CURRENT_DATE
            AND admission_at < CURRENT_DATE + INTERVAL '1 day'`
    ),
    safeCount(
      'discharges_today',
      sql`SELECT COUNT(*)::int AS n
          FROM encounters
          WHERE discharge_at >= CURRENT_DATE
            AND discharge_at < CURRENT_DATE + INTERVAL '1 day'`
    ),
    safeCount(
      'active_inpatients',
      sql`SELECT COUNT(*)::int AS n
          FROM encounters
          WHERE status = 'in-progress'
            AND encounter_class = 'IMP'`
    ),
    safeCount(
      'open_incidents',
      sql`SELECT COUNT(*)::int AS n
          FROM adverse_events
          WHERE ae_status IN ('open', 'investigating')`
    ),
    safeCount(
      'unack_critical',
      sql`SELECT COUNT(*)::int AS n
          FROM critical_value_alerts
          WHERE cva_status IN ('pending', 'sent', 'escalated_l1', 'escalated_l2', 'escalated_l3')`
    ),
    safeCollections(),
    safeCount(
      'pending_claims',
      sql`SELECT COUNT(*)::int AS n
          FROM tpa_claims
          WHERE claim_status IN ('submitted', 'query_raised')`
    ),
    safeCount(
      'draft_invoices',
      sql`SELECT COUNT(*)::int AS n
          FROM invoices
          WHERE invoice_status = 'draft'`
    ),
  ]);

  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'local';
  const env = process.env.VERCEL_ENV || 'development';

  return NextResponse.json({
    ops: {
      beds_occupied: bedStats.occupied,
      beds_total: bedStats.total,
      admissions_today,
      discharges_today,
      active_inpatients,
    },
    alerts: {
      open_incidents,
      unack_critical,
    },
    revenue: {
      collections_today_inr,
      pending_claims,
      draft_invoices,
    },
    health: {
      db: { status: dbStatus, latency_ms: dbLatency },
      sha,
      env,
    },
    timestamp,
  });
}
