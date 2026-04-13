import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { generateFromTemplate } from '@/lib/ai/template-engine';

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
    let cardsGenerated = 0;
    let errors = 0;

    // Get wards from bed board
    let wards: any[] = [];
    try {
      wards = await sql`
        SELECT DISTINCT ward
        FROM beds
        WHERE hospital_id = (
          SELECT hospital_id FROM beds LIMIT 1
        )
        ORDER BY ward
      `;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        const duration_ms = Date.now() - startTime;
        return NextResponse.json({
          job: 'shift-handoff',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms,
          details: 'beds table not found',
        });
      }
      throw err;
    }

    const hospitalId = await sql`SELECT DISTINCT hospital_id FROM beds LIMIT 1`.then(
      (rows: any[]) => rows[0]?.hospital_id
    );

    // Generate handoff for each ward
    for (const ward of wards) {
      try {
        // Get active encounters in ward
        const activeEncounters = await sql`
          SELECT COUNT(*) as count
          FROM encounters
          WHERE hospital_id = ${hospitalId}
          AND ward = ${ward.ward}
          AND status = 'admitted'
        `;

        // Get recent observations
        const recentObs = await sql`
          SELECT COUNT(*) as count
          FROM observations
          WHERE hospital_id = ${hospitalId}
          AND created_at > NOW() - INTERVAL '1 hour'
          AND observation_type IN ('NEWS2', 'VITALS')
        `;

        // Get pending orders
        const pendingOrders = await sql`
          SELECT COUNT(*) as count
          FROM service_requests
          WHERE hospital_id = ${hospitalId}
          AND ward = ${ward.ward}
          AND status IN ('ordered', 'pending')
        `;

        const handoffData = {
          ward: ward.ward,
          hospital_id: hospitalId,
          active_patients: activeEncounters[0]?.count || 0,
          recent_observations: recentObs[0]?.count || 0,
          pending_orders: pendingOrders[0]?.count || 0,
        };

        // Generate handoff card
        const cards = await generateFromTemplate({
          hospital_id: hospitalId,
          module: 'clinical',
          trigger_type: 'shift_handoff',
          data: handoffData,
        });

        if (cards && cards.length > 0) {
          cardsGenerated += cards.length;
        }
      } catch (error) {
        errors++;
        console.error(`Error generating handoff for ward ${ward.ward}:`, error);
      }
    }

    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'shift-handoff',
      status: errors === 0 ? 'completed' : 'partial',
      cards_generated: cardsGenerated,
      errors,
      duration_ms,
      details: `Generated handoffs for ${wards.length} wards`,
    });
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    console.error('Shift handoff job failed:', error);

    return NextResponse.json(
      {
        job: 'shift-handoff',
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
