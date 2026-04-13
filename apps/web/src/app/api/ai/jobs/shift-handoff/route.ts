import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { generateAllWardHandoffs } from '@/lib/ai/clinical/shift-handoff';

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

    // Get default hospital ID
    let hospitalId: string;
    try {
      const hospitals = await sql`SELECT id FROM hospitals LIMIT 1`;
      if (!hospitals || hospitals.length === 0) {
        return NextResponse.json({
          job: 'shift-handoff',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms: Date.now() - startTime,
          details: 'No hospitals found',
        });
      }
      hospitalId = hospitals[0].id;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        return NextResponse.json({
          job: 'shift-handoff',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms: Date.now() - startTime,
          details: 'hospitals table not found',
        });
      }
      throw err;
    }

    // Generate handoffs for all wards
    const handoffs = await generateAllWardHandoffs(hospitalId);

    const totalCards = handoffs.length;
    const totalPatients = handoffs.reduce((sum, h) => sum + h.patient_count, 0);
    const criticalAlerts = handoffs.reduce((sum, h) => sum + h.critical_alerts.length, 0);

    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'shift-handoff',
      status: 'completed',
      cards_generated: totalCards,
      wards_processed: handoffs.length,
      total_patients: totalPatients,
      critical_alerts: criticalAlerts,
      errors: 0,
      duration_ms,
      details: `Generated handoffs for ${handoffs.length} wards covering ${totalPatients} patients`,
    });
  } catch (error: any) {
    console.error('[shift-handoff] Job failed:', error);
    return NextResponse.json(
      {
        job: 'shift-handoff',
        status: 'failed',
        cards_generated: 0,
        errors: 1,
        duration_ms: Date.now() - startTime,
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
