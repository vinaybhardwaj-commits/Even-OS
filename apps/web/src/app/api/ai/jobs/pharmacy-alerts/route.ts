import { NextRequest, NextResponse } from 'next/server';
import { runPharmacyAlerts } from '@/lib/ai/operations/pharmacy-alerts';

let _sql: any = null;
function getSql() {
  if (!_sql) {
    _sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const adminKey = req.headers.get('x-admin-key');
    if (adminKey !== process.env.ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get hospital_id
    const sql = getSql();
    let hospitalId: string | null = null;
    try {
      const result = await sql`SELECT id FROM hospitals LIMIT 1`;
      hospitalId = result[0]?.id;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        const duration_ms = Date.now() - startTime;
        return NextResponse.json({
          job: 'pharmacy-alerts',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms,
          details: 'hospitals table not found',
        });
      }
      throw err;
    }

    if (!hospitalId) {
      const duration_ms = Date.now() - startTime;
      return NextResponse.json({
        job: 'pharmacy-alerts',
        status: 'skipped',
        cards_generated: 0,
        errors: 0,
        duration_ms,
        details: 'No hospitals found',
      });
    }

    const result = await runPharmacyAlerts(hospitalId);
    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'pharmacy-alerts',
      status: result.errors.length === 0 ? 'completed' : 'partial',
      cards_generated: result.total_alerts,
      checks_run: result.checks_run,
      errors: result.errors.length,
      duration_ms,
      details: `${result.checks_run} checks run, ${result.total_alerts} alerts generated`,
    });
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    console.error('Pharmacy alerts job failed:', error);

    return NextResponse.json(
      {
        job: 'pharmacy-alerts',
        status: 'skipped',
        cards_generated: 0,
        errors: 1,
        duration_ms,
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
