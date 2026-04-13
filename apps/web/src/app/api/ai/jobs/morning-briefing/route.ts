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

    // Get hospital_id
    let hospitalId: string | null = null;
    try {
      const result = await sql`
        SELECT DISTINCT hospital_id FROM encounters LIMIT 1
      `;
      hospitalId = result[0]?.hospital_id;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        const duration_ms = Date.now() - startTime;
        return NextResponse.json({
          job: 'morning-briefing',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms,
          details: 'encounters table not found',
        });
      }
      throw err;
    }

    if (!hospitalId) {
      const duration_ms = Date.now() - startTime;
      return NextResponse.json({
        job: 'morning-briefing',
        status: 'skipped',
        cards_generated: 0,
        errors: 0,
        duration_ms,
        details: 'No hospitals found',
      });
    }

    try {
      // Get overnight admissions (last 12 hours)
      const overnightAdmissions = await sql`
        SELECT COUNT(*) as count
        FROM encounters
        WHERE hospital_id = ${hospitalId}
        AND admission_date > NOW() - INTERVAL '12 hours'
        AND status = 'admitted'
      `;

      // Get incidents from last 24 hours
      const incidents = await sql`
        SELECT COUNT(*) as count
        FROM incident_reports
        WHERE hospital_id = ${hospitalId}
        AND created_at > NOW() - INTERVAL '24 hours'
      `;

      // Get OT schedule for today
      const otSchedule = await sql`
        SELECT COUNT(*) as count
        FROM ot_schedules
        WHERE hospital_id = ${hospitalId}
        AND scheduled_date = CURRENT_DATE
        AND status IN ('scheduled', 'in-progress')
      `;

      // Get pending billing
      const pendingBilling = await sql`
        SELECT COUNT(*) as count
        FROM billing_accounts
        WHERE hospital_id = ${hospitalId}
        AND status = 'pending_payment'
      `;

      // Get bed occupancy
      const bedOccupancy = await sql`
        SELECT
          COUNT(*) as total_beds,
          SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied_beds
        FROM beds
        WHERE hospital_id = ${hospitalId}
      `;

      // Get NABH scores
      const nabhScores = await sql`
        SELECT score, chapter
        FROM nabh_readiness_scores
        WHERE hospital_id = ${hospitalId}
        ORDER BY assessment_date DESC
        LIMIT 1
      `;

      const briefingData = {
        hospital_id: hospitalId,
        date: new Date().toISOString().split('T')[0],
        overnight_admissions: overnightAdmissions[0]?.count || 0,
        incidents: incidents[0]?.count || 0,
        ot_procedures: otSchedule[0]?.count || 0,
        pending_billing: pendingBilling[0]?.count || 0,
        bed_occupancy: `${bedOccupancy[0]?.occupied_beds || 0}/${bedOccupancy[0]?.total_beds || 0}`,
        nabh_score: nabhScores[0]?.score || 0,
      };

      // Generate morning briefing card
      const cards = await generateFromTemplate({
        hospital_id: hospitalId,
        module: 'operations',
        trigger_type: 'morning_briefing',
        data: briefingData,
      });

      if (cards && cards.length > 0) {
        cardsGenerated = cards.length;
      }
    } catch (error) {
      errors++;
      console.error('Error generating morning briefing:', error);
    }

    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'morning-briefing',
      status: errors === 0 ? 'completed' : 'partial',
      cards_generated: cardsGenerated,
      errors,
      duration_ms,
    });
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    console.error('Morning briefing job failed:', error);

    return NextResponse.json(
      {
        job: 'morning-briefing',
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
