import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { predictClaimOutcome } from '@/lib/ai/billing/claim-predictor';

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

    // Get active encounters with insurance billing accounts
    let activeClaims: any[] = [];
    try {
      activeClaims = await sql`
        SELECT DISTINCT
          e.id as encounter_id,
          e.hospital_id,
          ba.tpa_name,
          ba.insurer_name
        FROM encounters e
        JOIN billing_accounts ba ON e.id = ba.encounter_id
        WHERE e.status = 'admitted'
          AND ba.account_type = 'insurance'
          AND ba.tpa_name IS NOT NULL
        LIMIT 200
      `;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        return NextResponse.json({
          job: 'claim-predictions',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms: Date.now() - startTime,
          details: 'Required tables not found — run billing migrations first',
        });
      }
      throw err;
    }

    if (activeClaims.length === 0) {
      return NextResponse.json({
        job: 'claim-predictions',
        status: 'completed',
        cards_generated: 0,
        errors: 0,
        duration_ms: Date.now() - startTime,
        details: 'No active insurance encounters found',
      });
    }

    // Run predictions for each encounter using the full billing engine
    for (const claim of activeClaims) {
      try {
        const result = await predictClaimOutcome({
          hospital_id: claim.hospital_id,
          encounter_id: claim.encounter_id,
        });

        if (result?.card) {
          cardsGenerated++;
        }
      } catch (error: any) {
        errors++;
        console.error(`[claim-predictions] Error for encounter ${claim.encounter_id}:`, error?.message || error);
      }
    }

    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'claim-predictions',
      status: errors === 0 ? 'completed' : 'partial',
      cards_generated: cardsGenerated,
      errors,
      duration_ms,
      details: `Processed ${activeClaims.length} encounters, generated ${cardsGenerated} prediction cards`,
    });
  } catch (error: any) {
    console.error('[claim-predictions] Job failed:', error);
    return NextResponse.json(
      {
        job: 'claim-predictions',
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
