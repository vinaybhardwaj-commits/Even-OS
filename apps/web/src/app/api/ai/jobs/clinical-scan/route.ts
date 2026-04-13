import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { generateFromAllRules } from '@/lib/ai/template-engine';

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

    // Get active encounters
    let encounters: any[] = [];
    try {
      encounters = await sql`
        SELECT id, patient_id, hospital_id, admission_date, primary_diagnosis
        FROM encounters
        WHERE status = 'admitted'
        LIMIT 500
      `;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        const duration_ms = Date.now() - startTime;
        return NextResponse.json({
          job: 'clinical-scan',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms,
          details: 'encounters table not found',
        });
      }
      throw err;
    }

    // Check clinical alerts for each encounter
    for (const encounter of encounters) {
      try {
        // Fetch NEWS2 score
        const news2Data = await sql`
          SELECT score, assessed_at
          FROM observations
          WHERE encounter_id = ${encounter.id}
          AND observation_type = 'NEWS2'
          ORDER BY assessed_at DESC
          LIMIT 1
        `;

        // Fetch overdue labs
        const overdueLabsData = await sql`
          SELECT COUNT(*) as count
          FROM service_requests
          WHERE encounter_id = ${encounter.id}
          AND service_type = 'LAB'
          AND ordered_at < NOW() - INTERVAL '24 hours'
          AND status IN ('ordered', 'pending')
        `;

        // Fetch medications without allergy check
        const medsData = await sql`
          SELECT COUNT(*) as count
          FROM medication_orders
          WHERE encounter_id = ${encounter.id}
          AND status IN ('active', 'pending')
          AND verified_for_allergies = false
        `;

        const alertData = {
          encounter_id: encounter.id,
          patient_id: encounter.patient_id,
          hospital_id: encounter.hospital_id,
          news2_score: news2Data[0]?.score || 0,
          overdue_labs: overdueLabsData[0]?.count || 0,
          unverified_meds: medsData[0]?.count || 0,
        };

        // Generate alert cards using template engine
        const result = await generateFromAllRules({
          hospital_id: encounter.hospital_id,
          module: 'clinical',
          data: alertData,
        });

        if (result && result.length > 0) {
          cardsGenerated += result.length;
        }
      } catch (error) {
        errors++;
        console.error(`Error processing encounter ${encounter.id}:`, error);
      }
    }

    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'clinical-scan',
      status: errors === 0 ? 'completed' : 'partial',
      cards_generated: cardsGenerated,
      errors,
      duration_ms,
      details: `Scanned ${encounters.length} encounters`,
    });
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    console.error('Clinical scan job failed:', error);

    return NextResponse.json(
      {
        job: 'clinical-scan',
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
