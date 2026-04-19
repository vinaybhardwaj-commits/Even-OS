import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { checkHealth as checkLlmHealth } from '@/lib/ai/llm-client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/system-status
 *
 * Deep-dive system status for the /admin/status page. Unlike /api/admin/live-ops
 * (which polls every 30s for the Command Center strip), this is a once-per-60s
 * probe with the expensive stuff: table row counts, DB size, error rollups,
 * LLM tunnel check, active session count.
 *
 * Gated: super_admin only. The page itself also gates; the endpoint re-checks
 * so curl calls from lower-privileged users can't leak internals.
 *
 * Response shape (stable — consumed by /admin/status):
 * {
 *   deploy: { sha, short_sha, branch, env, commit_message, author, repo, deploy_url, time },
 *   database: {
 *     status: 'ok'|'degraded'|'down',
 *     latency_ms: number,
 *     size_bytes: number,
 *     size_pretty: string,
 *     connection_count: number,
 *     longest_query_seconds: number | null,
 *     version: string,
 *   },
 *   row_counts: Array<{ table: string, rows: number }>,     // top 20 by rows, estimated via pg_class.reltuples
 *   llm: {
 *     status: 'online'|'offline'|'degraded'|'error',
 *     latency_ms: number | null,
 *     model: string,
 *     base_url_host: string,
 *   },
 *   errors: {
 *     last_1h: number,
 *     last_24h: number,
 *     top_types_24h: Array<{ error_type: string, count: number, last_seen: string }>,
 *   },
 *   activity: {
 *     active_sessions: number,       // not expired, not revoked
 *     logins_24h: number,             // sessions created in last 24h
 *     unique_users_24h: number,
 *     recent_logins: Array<{ user_id: string, email: string | null, full_name: string | null, role: string | null, created_at: string }>,
 *   },
 *   timestamp: string,
 * }
 *
 * Performance: all 8 DB probes run in parallel. LLM probe is serial (slow, 1-3s).
 * Target p95 < 3000ms including LLM; DB-only p95 < 800ms.
 * Any failed probe returns zeroed defaults — shape stays stable so the UI
 * never has to branch on missing sections.
 */

const ADMIN_ROLES_ALLOWED = ['super_admin'];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ADMIN_ROLES_ALLOWED.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const timestamp = new Date().toISOString();
  const sql = neon(process.env.DATABASE_URL!);

  // ─── DATABASE & ROW-COUNT PROBES (parallel) ─────────────────────────────
  const dbStart = Date.now();
  let dbStatus: 'ok' | 'degraded' | 'down' = 'down';
  let dbLatency = 0;
  let dbSize = 0;
  let dbSizePretty = '—';
  let dbConnCount = 0;
  let dbLongestQuerySec: number | null = null;
  let dbVersion = '';
  let rowCounts: Array<{ table: string; rows: number }> = [];
  let errorsLast1h = 0;
  let errorsLast24h = 0;
  let topErrorTypes24h: Array<{ error_type: string; count: number; last_seen: string }> = [];
  let activeSessions = 0;
  let logins24h = 0;
  let uniqueUsers24h = 0;
  let recentLogins: Array<{
    user_id: string;
    email: string | null;
    full_name: string | null;
    role: string | null;
    created_at: string;
  }> = [];

  try {
    const [
      pingRes,
      sizeRes,
      connRes,
      longestRes,
      versionRes,
      rowsRes,
      errors1hRes,
      errors24hRes,
      topErrTypesRes,
      activeSessRes,
      logins24hRes,
      uniqueUsers24hRes,
      recentLoginsRes,
    ] = await Promise.all([
      sql`SELECT 1 AS ok`,
      sql`SELECT
            pg_database_size(current_database())::bigint AS size_bytes,
            pg_size_pretty(pg_database_size(current_database())) AS size_pretty`,
      sql`SELECT COUNT(*)::int AS n
          FROM pg_stat_activity
          WHERE datname = current_database()`,
      // Longest running non-idle query (exclude our own meta query)
      sql`SELECT EXTRACT(EPOCH FROM (now() - query_start))::numeric AS sec
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'active'
            AND query NOT LIKE '%pg_stat_activity%'
          ORDER BY query_start ASC NULLS LAST
          LIMIT 1`,
      sql`SELECT version() AS v`,
      // Top 20 user tables by estimated row count (cheap — uses pg_class stats).
      // reltuples becomes stale after bulk ops but is ~accurate enough for an
      // operator glance. Exact COUNT(*) across 170+ tables would blow the p95.
      sql`SELECT
            relname AS table_name,
            reltuples::bigint AS rows
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r'
            AND n.nspname = 'public'
          ORDER BY c.reltuples DESC
          LIMIT 20`,
      sql`SELECT COUNT(*)::int AS n
          FROM error_log
          WHERE timestamp >= now() - interval '1 hour'`,
      sql`SELECT COUNT(*)::int AS n
          FROM error_log
          WHERE timestamp >= now() - interval '24 hours'`,
      sql`SELECT
            error_type,
            COUNT(*)::int AS count,
            MAX(timestamp)::text AS last_seen
          FROM error_log
          WHERE timestamp >= now() - interval '24 hours'
          GROUP BY error_type
          ORDER BY count DESC
          LIMIT 5`,
      sql`SELECT COUNT(*)::int AS n
          FROM sessions
          WHERE expires_at > now()
            AND revoked_at IS NULL`,
      sql`SELECT COUNT(*)::int AS n
          FROM sessions
          WHERE created_at >= now() - interval '24 hours'`,
      sql`SELECT COUNT(DISTINCT user_id)::int AS n
          FROM sessions
          WHERE created_at >= now() - interval '24 hours'`,
      // Recent logins — join to users for email + full_name + role display.
      // users.roles is a text[] — show the first entry; NULL-safe via array
      // element access (returns NULL if array is NULL or empty).
      sql`SELECT
            s.user_id::text AS user_id,
            u.email,
            u.full_name,
            u.roles[1] AS role,
            s.created_at::text AS created_at
          FROM sessions s
          LEFT JOIN users u ON u.id = s.user_id
          ORDER BY s.created_at DESC
          LIMIT 10`,
    ]);

    dbLatency = Date.now() - dbStart;
    dbStatus = dbLatency < 800 ? 'ok' : 'degraded';
    // If the ping itself didn't return 1, that's a real degradation signal.
    if (!pingRes[0] || Number(pingRes[0].ok) !== 1) {
      dbStatus = 'degraded';
    }

    dbSize = Number(sizeRes[0]?.size_bytes ?? 0);
    dbSizePretty = String(sizeRes[0]?.size_pretty ?? '—');
    dbConnCount = Number(connRes[0]?.n ?? 0);
    dbLongestQuerySec = longestRes[0]?.sec != null ? Number(longestRes[0].sec) : null;
    dbVersion = String(versionRes[0]?.v ?? '').split(' on ')[0] || String(versionRes[0]?.v ?? '');

    rowCounts = (rowsRes as Array<{ table_name: string; rows: number | string }>).map(r => ({
      table: String(r.table_name),
      // reltuples can be -1 if ANALYZE never ran — clamp to 0.
      rows: Math.max(0, Number(r.rows ?? 0)),
    }));

    errorsLast1h = Number(errors1hRes[0]?.n ?? 0);
    errorsLast24h = Number(errors24hRes[0]?.n ?? 0);
    topErrorTypes24h = (topErrTypesRes as Array<{ error_type: string; count: number; last_seen: string }>).map(r => ({
      error_type: String(r.error_type),
      count: Number(r.count),
      last_seen: String(r.last_seen),
    }));

    activeSessions = Number(activeSessRes[0]?.n ?? 0);
    logins24h = Number(logins24hRes[0]?.n ?? 0);
    uniqueUsers24h = Number(uniqueUsers24hRes[0]?.n ?? 0);
    recentLogins = (recentLoginsRes as Array<{
      user_id: string;
      email: string | null;
      full_name: string | null;
      role: string | null;
      created_at: string;
    }>).map(r => ({
      user_id: String(r.user_id),
      email: r.email ?? null,
      full_name: r.full_name ?? null,
      role: r.role ?? null,
      created_at: String(r.created_at),
    }));
  } catch (err) {
    // Leave defaults. Record latency up to the failure point so the UI can
    // at least show "DB took N ms before failing".
    dbLatency = Date.now() - dbStart;
    dbStatus = 'down';
    console.error('[system-status] DB probe error:', err);
  }

  // ─── LLM PROBE (serial, expensive — 1-3s) ────────────────────────────────
  const llmStart = Date.now();
  let llmStatus: 'online' | 'offline' | 'degraded' | 'error' = 'offline';
  let llmLatency: number | null = null;
  try {
    const result = await checkLlmHealth();
    if (result) {
      llmStatus = result.status;
      llmLatency = result.latency_ms;
    } else {
      llmStatus = 'offline';
      llmLatency = Date.now() - llmStart;
    }
  } catch (err) {
    llmStatus = 'error';
    llmLatency = Date.now() - llmStart;
    console.error('[system-status] LLM probe error:', err);
  }

  const llmModel = process.env.LLM_MODEL || 'qwen2.5:14b';
  const llmBase = process.env.LLM_API_BASE || process.env.OPENAI_API_BASE || '';
  let llmBaseHost = '';
  try {
    llmBaseHost = llmBase ? new URL(llmBase).host : '';
  } catch {
    llmBaseHost = llmBase;
  }

  // ─── DEPLOY ──────────────────────────────────────────────────────────────
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || 'local';
  const shortSha = sha.substring(0, 7);
  const branch = process.env.VERCEL_GIT_COMMIT_REF || 'unknown';
  const env = process.env.VERCEL_ENV || 'development';
  const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || '';
  const author = process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME || process.env.VERCEL_GIT_COMMIT_AUTHOR_LOGIN || '';
  const repo = process.env.VERCEL_GIT_REPO_SLUG
    ? `${process.env.VERCEL_GIT_REPO_OWNER ?? ''}/${process.env.VERCEL_GIT_REPO_SLUG}`.replace(/^\//, '')
    : '';
  const deployUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  // VERCEL_DEPLOYMENT_ID is set at runtime — approximates the deploy time if
  // we don't have it directly. For a precise timestamp, we'd need to hit
  // the Vercel API; the runtime value is good enough for an operator glance.

  return NextResponse.json({
    deploy: {
      sha,
      short_sha: shortSha,
      branch,
      env,
      commit_message: commitMessage.split('\n')[0], // first line only
      author,
      repo,
      deploy_url: deployUrl,
      time: timestamp, // request time == close to "last checked"
    },
    database: {
      status: dbStatus,
      latency_ms: dbLatency,
      size_bytes: dbSize,
      size_pretty: dbSizePretty,
      connection_count: dbConnCount,
      longest_query_seconds: dbLongestQuerySec,
      version: dbVersion,
    },
    row_counts: rowCounts,
    llm: {
      status: llmStatus,
      latency_ms: llmLatency,
      model: llmModel,
      base_url_host: llmBaseHost,
    },
    errors: {
      last_1h: errorsLast1h,
      last_24h: errorsLast24h,
      top_types_24h: topErrorTypes24h,
    },
    activity: {
      active_sessions: activeSessions,
      logins_24h: logins24h,
      unique_users_24h: uniqueUsers24h,
      recent_logins: recentLogins,
    },
    timestamp,
  });
}
