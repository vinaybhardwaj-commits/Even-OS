import { NextRequest, NextResponse } from 'next/server';
import { predictBedDischarges } from '@/lib/ai/operations/bed-intelligence';

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
          job: 'bed-intelligence',
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
        job: 'bed-intelligence',
        status: 'skipped',
        cards_generated: 0,
        errors: 0,
        duration_ms,
        details: 'No hospitals found',
      });
    }

    const result = await predictBedDischarges(hospitalId);
    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'bed-intelligence',
      status: result.errors.length === 0 ? 'completed' : 'partial',
      cards_generated: result.cards_generated,
      predictions_updated: result.predictions_updated,
      errors: result.errors.length,
      duration_ms,
      details: `Processed predictions, generated ${result.cards_generated} alert cards`,
    });
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    console.error('Bed intelligence job failed:', error);

    return NextResponse.json(
      {
        job: 'bed-intelligence',
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
