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
 *   ops: {
 *     beds_occupied: number,
 *     beds_total: number,
 *     admissions_today: number,
 *     discharges_today: number,
 *     active_inpatients: number,
 *   },
 *   alerts: {
 *     open_incidents: number,
 *     unack_critical: number,
 *   },
 *   revenue: {
 *     collections_today_inr: number,
 *     pending_claims: number,
 *     draft_invoices: number,
 *   },
 *   health: {
 *     db:    { status: 'ok'|'degraded'|'down', latency_ms: number },
 *     sha:   string,
 *     env:   string,
 *   },
 *   timestamp: string,
 * }
 *
 * Performance: all queries run in parallel via Promise.all. Target p95 < 500ms.
 * If any sub-query fails, that metric returns 0 (or 'down' for health) so
 * the strip always renders — we never fail the whole endpoint on a single
 * probe error.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const timestamp = new Date().toISOString();
  const sql = neon(process.env.DATABASE_URL!);

  // DB probe timing — wrap around the parallel aggregate to get a realistic
  // end-to-end latency number.
  const dbStart = Date.now();
  let dbStatus: 'ok' | 'degraded' | 'down' = 'down';
  let dbLatency = 0;

  // Default zeroed response — if any probe errors we still return a valid
  // shape so the UI can render without conditional guards.
  let beds_occupied = 0;
  let beds_total = 0;
  let admissions_today = 0;
  let discharges_today = 0;
  let active_inpatients = 0;
  let open_incidents = 0;
  let unack_critical = 0;
  let collections_today_inr = 0;
  let pending_claims = 0;
  let draft_invoices = 0;

  try {
    // All queries run in parallel. Each returns an array with a single row.
    const [
      bedStatsRes,
      admissionsRes,
      dischargesRes,
      activeRes,
      incidentsRes,
      criticalRes,
      collectionsRes,
      pendingClaimsRes,
      draftInvoicesRes,
    ] = await Promise.all([
      // Beds: total + occupied, scoped to location_type='bed'.
      sql`SELECT
            COUNT(*) FILTER (WHERE bed_status = 'occupied')::int AS occupied,
            COUNT(*)::int AS total
          FROM locations
          WHERE location_type = 'bed'`,
      // Admissions today: encounters admitted today.
      sql`SELECT COUNT(*)::int AS n
          FROM encounters
          WHERE admission_at >= CURRENT_DATE
            AND admission_at < CURRENT_DATE + INTERVAL '1 day'`,
      // Discharges today: encounters discharged today.
      sql`SELECT COUNT(*)::int AS n
          FROM encounters
          WHERE discharge_at >= CURRENT_DATE
            AND discharge_at < CURRENT_DATE + INTERVAL '1 day'`,
      // Active inpatients: status='in-progress' and class='IMP'.
      sql`SELECT COUNT(*)::int AS n
          FROM encounters
          WHERE status = 'in-progress'
            AND encounter_class = 'IMP'`,
      // Open incidents: adverse_events with non-terminal status.
      sql`SELECT COUNT(*)::int AS n
          FROM adverse_events
          WHERE ae_status IN ('open', 'investigating')`,
      // Unack critical values: awaiting clinician response.
      sql`SELECT COUNT(*)::int AS n
          FROM critical_value_alerts
          WHERE cva_status IN ('pending', 'sent', 'escalated_l1', 'escalated_l2', 'escalated_l3')`,
      // Collections today: sum of payments received today.
      sql`SELECT COALESCE(SUM(amount), 0)::numeric AS total
          FROM payments
          WHERE payment_date >= CURRENT_DATE
            AND payment_date < CURRENT_DATE + INTERVAL '1 day'`,
      // Pending claims: submitted or query_raised.
      sql`SELECT COUNT(*)::int AS n
          FROM tpa_claims
          WHERE claim_status IN ('submitted', 'query_raised')`,
      // Draft invoices: proxy for unbilled work.
      sql`SELECT COUNT(*)::int AS n
          FROM invoices
          WHERE invoice_status = 'draft'`,
    ]);

    dbLatency = Date.now() - dbStart;
    dbStatus = dbLatency < 500 ? 'ok' : 'degraded';

    beds_occupied = Number(bedStatsRes[0]?.occupied ?? 0);
    beds_total = Number(bedStatsRes[0]?.total ?? 0);
    admissions_today = Number(admissionsRes[0]?.n ?? 0);
    discharges_today = Number(dischargesRes[0]?.n ?? 0);
    active_inpatients = Number(activeRes[0]?.n ?? 0);
    open_incidents = Number(incidentsRes[0]?.n ?? 0);
    unack_critical = Number(criticalRes[0]?.n ?? 0);
    collections_today_inr = Math.round(Number(collectionsRes[0]?.total ?? 0));
    pending_claims = Number(pendingClaimsRes[0]?.n ?? 0);
    draft_invoices = Number(draftInvoicesRes[0]?.n ?? 0);
  } catch {
    dbLatency = Date.now() - dbStart;
    dbStatus = 'down';
    // Zeroed defaults already in place.
  }

  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'local';
  const env = process.env.VERCEL_ENV || 'development';

  return NextResponse.json({
    ops: {
      beds_occupied,
      beds_total,
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
