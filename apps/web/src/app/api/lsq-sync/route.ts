import { NextRequest, NextResponse } from 'next/server';
import { runLsqSync } from '@/lib/lsq/sync-engine';

// Env: ADMIN_KEY (auth), CRON_SECRET (Vercel cron)
let _sql: any = null;
function getSql() {
  if (!_sql) {
    _sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

/**
 * LSQ Sync Cron Job
 *
 * Triggered by Vercel Cron (every hour) or manually via POST with x-admin-key.
 * Fetches leads from LeadSquared, upserts patients, logs per-event granular records.
 *
 * Auth: x-admin-key header OR Vercel cron authorization header
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Auth: accept admin key or Vercel cron authorization
    const adminKey = req.headers.get('x-admin-key');
    const cronAuth = req.headers.get('authorization');
    const isCron = cronAuth === `Bearer ${process.env.CRON_SECRET}`;

    if (adminKey !== process.env.ADMIN_KEY && !isCron) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get hospital_id (first hospital — single-site for now)
    const sql = getSql();
    let hospitalId: string | null = null;
    try {
      const result = await sql`SELECT id FROM hospitals LIMIT 1`;
      hospitalId = result[0]?.id;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        return NextResponse.json({
          status: 'skipped',
          reason: 'hospitals table not yet created',
          duration_ms: Date.now() - startTime,
        });
      }
      throw err;
    }

    if (!hospitalId) {
      return NextResponse.json({
        status: 'skipped',
        reason: 'No hospital found',
        duration_ms: Date.now() - startTime,
      });
    }

    // Use a system user ID for cron-triggered syncs
    const systemUserId = '00000000-0000-0000-0000-000000000000';

    const result = await runLsqSync(hospitalId, systemUserId);

    return NextResponse.json({
      status: result.status,
      sync_id: result.sync_id,
      total: result.total,
      new_count: result.new_count,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      error_message: result.error_message,
      duration_ms: Date.now() - startTime,
    });
  } catch (err: any) {
    return NextResponse.json({
      status: 'error',
      error: err.message || 'Unknown error',
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}

// Also support GET for Vercel Cron (cron jobs use GET by default)
export async function GET(req: NextRequest) {
  // Re-route GET to POST handler for cron compatibility
  return POST(req);
}
