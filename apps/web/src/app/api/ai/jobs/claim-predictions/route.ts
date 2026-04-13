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

    // Get active encounters with billing and insurance
    let activeClaims: any[] = [];
    try {
      activeClaims = await sql`
        SELECT
          e.id as encounter_id, e.hospital_id, e.patient_id, e.primary_diagnosis,
          ba.id as billing_account_id, ba.insurance_provider_id,
          ic.insurance_company_id, ic.tpa_name
        FROM encounters e
        JOIN billing_accounts ba ON e.id = ba.encounter_id
        JOIN insurance_coverage ic ON ba.insurance_coverage_id = ic.id
        WHERE e.status = 'admitted'
        AND ba.status IN ('active', 'pending_approval')
        LIMIT 500
      `;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        const duration_ms = Date.now() - startTime;
        return NextResponse.json({
          job: 'claim-predictions',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms,
          details: 'encounters table not found',
        });
      }
      throw err;
    }

    // Process predictions for each claim
    for (const claim of activeClaims) {
      try {
        // Get rubric for TPA
        let rubricApprovalRate = 70; // Default
        try {
          const rubric = await sql`
            SELECT approval_rate
            FROM claim_rubrics
            WHERE hospital_id = ${claim.hospital_id}
            AND tpa_name = ${claim.tpa_name}
            ORDER BY updated_at DESC
            LIMIT 1
          `;
          if (rubric && rubric[0]?.approval_rate) {
            rubricApprovalRate = rubric[0].approval_rate;
          }
        } catch (e) {
          // Table may not exist yet
        }

        // Adjust based on diagnosis category
        let predictionScore = rubricApprovalRate;
        const diagnosis = claim.primary_diagnosis || '';

        // Heuristic adjustments for common patterns
        if (diagnosis.includes('emergency') || diagnosis.includes('trauma')) {
          predictionScore = Math.min(100, predictionScore + 10);
        }
        if (diagnosis.includes('elective')) {
          predictionScore = Math.max(50, predictionScore - 5);
        }

        // Ensure score is between 0 and 100
        predictionScore = Math.max(0, Math.min(100, predictionScore));

        // Upsert into claim_predictions
        try {
          await sql`
            INSERT INTO claim_predictions (
              encounter_id, billing_account_id, hospital_id, predicted_approval_rate,
              prediction_confidence, tpa_name, created_at, updated_at
            ) VALUES (
              ${claim.encounter_id}, ${claim.billing_account_id}, ${claim.hospital_id},
              ${predictionScore}, 0.75, ${claim.tpa_name}, NOW(), NOW()
            )
            ON CONFLICT (billing_account_id) DO UPDATE SET
              predicted_approval_rate = ${predictionScore},
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
        console.error(`Error predicting claim ${claim.billing_account_id}:`, error);
      }
    }

    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'claim-predictions',
      status: errors === 0 ? 'completed' : 'partial',
      cards_generated: cardsGenerated,
      errors,
      duration_ms,
      details: `Processed ${activeClaims.length} active claims`,
    });
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    console.error('Claim predictions job failed:', error);

    return NextResponse.json(
      {
        job: 'claim-predictions',
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
