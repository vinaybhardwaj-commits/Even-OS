import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { runActiveMonitoring } from '@/lib/ai/quality/active-monitor';

let _sql: any = null;
function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const adminKey = req.headers.get('x-admin-key');
    if (adminKey !== process.env.ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const sql = getSql();
    let hospitalId: string;
    try {
      const hospitals = await sql`SELECT id FROM hospitals LIMIT 1`;
      if (!hospitals || hospitals.length === 0) {
        return NextResponse.json({ job: 'quality-monitor', status: 'skipped', cards_generated: 0, errors: 0, duration_ms: Date.now() - startTime, details: 'No hospitals found' });
      }
      hospitalId = hospitals[0].id;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        return NextResponse.json({ job: 'quality-monitor', status: 'skipped', cards_generated: 0, errors: 0, duration_ms: Date.now() - startTime, details: 'hospitals table not found' });
      }
      throw err;
    }
    const result = await runActiveMonitoring(hospitalId);
    return NextResponse.json({
      job: 'quality-monitor',
      status: result.errors.length === 0 ? 'completed' : 'partial',
      cards_generated: result.alerts_generated,
      checks_run: result.checks_run,
      errors: result.errors.length,
      error_details: result.errors.slice(0, 5),
      duration_ms: Date.now() - startTime,
      details: `Ran ${result.checks_run} quality checks, generated ${result.alerts_generated} alerts`,
    });
  } catch (error: any) {
    console.error('[quality-monitor] Job failed:', error);
    return NextResponse.json({ job: 'quality-monitor', status: 'failed', cards_generated: 0, errors: 1, duration_ms: Date.now() - startTime, details: error?.message || 'Unknown error' }, { status: 500 });
  }
}
