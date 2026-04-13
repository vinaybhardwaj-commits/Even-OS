import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

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

    // Get occupied beds
    let occupiedBeds: any[] = [];
    try {
      occupiedBeds = await sql`
        SELECT
          b.id, b.hospital_id, b.ward, b.bed_number,
          e.id as encounter_id, e.admission_date, e.primary_diagnosis
        FROM beds b
        JOIN encounters e ON b.id = e.current_bed_id
        WHERE b.status = 'occupied'
        LIMIT 500
      `;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        const duration_ms = Date.now() - startTime;
        return NextResponse.json({
          job: 'bed-intelligence',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms,
          details: 'beds table not found',
        });
      }
      throw err;
    }

    // Process each occupied bed
    for (const bed of occupiedBeds) {
      try {
        // Get average LOS for this diagnosis category
        const avgLosResult = await sql`
          SELECT
            AVG(EXTRACT(DAY FROM (discharge_date - admission_date))::int) as avg_los
          FROM encounters
          WHERE hospital_id = ${bed.hospital_id}
          AND primary_diagnosis = ${bed.primary_diagnosis}
          AND status = 'discharged'
          AND discharge_date > NOW() - INTERVAL '90 days'
        `;

        const avgLos = Math.ceil(avgLosResult[0]?.avg_los || 5);

        // Calculate predicted discharge date
        const admissionDate = new Date(bed.admission_date);
        const predictedDischargeDate = new Date(
          admissionDate.getTime() + avgLos * 24 * 60 * 60 * 1000
        );

        const daysUntilDischarge = Math.ceil(
          (predictedDischargeDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
        );

        // Determine alert level
        let alertLevel = 'normal';
        if (daysUntilDischarge <= 1) alertLevel = 'critical';
        else if (daysUntilDischarge <= 3) alertLevel = 'warning';

        // Insert or update prediction
        try {
          await sql`
            INSERT INTO bed_predictions (
              bed_id, hospital_id, encounter_id, avg_los_days, predicted_discharge_date,
              days_until_discharge, alert_level, created_at, updated_at
            ) VALUES (
              ${bed.id}, ${bed.hospital_id}, ${bed.encounter_id}, ${avgLos},
              ${predictedDischargeDate.toISOString()}, ${daysUntilDischarge}, ${alertLevel}, NOW(), NOW()
            )
            ON CONFLICT (bed_id) DO UPDATE SET
              avg_los_days = ${avgLos},
              predicted_discharge_date = ${predictedDischargeDate.toISOString()},
              days_until_discharge = ${daysUntilDischarge},
              alert_level = ${alertLevel},
              updated_at = NOW()
          `;
          cardsGenerated++;
        } catch (e: any) {
          if (!e.message?.includes('does not exist')) {
            throw e;
          }
        }
      } catch (error) {
        errors++;
        console.error(`Error processing bed ${bed.id}:`, error);
      }
    }

    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'bed-intelligence',
      status: errors === 0 ? 'completed' : 'partial',
      cards_generated: cardsGenerated,
      errors,
      duration_ms,
      details: `Processed ${occupiedBeds.length} occupied beds`,
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
