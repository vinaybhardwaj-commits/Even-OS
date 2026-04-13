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

    // Get hospitals
    let hospitals: any[] = [];
    try {
      hospitals = await sql`
        SELECT DISTINCT hospital_id FROM encounters LIMIT 50
      `;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        const duration_ms = Date.now() - startTime;
        return NextResponse.json({
          job: 'nabh-audit',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms,
          details: 'encounters table not found',
        });
      }
      throw err;
    }

    // Process NABH audit for each hospital
    for (const hospital of hospitals) {
      try {
        const hospitalId = hospital.hospital_id;

        // Get compliance checklist items
        let complianceScore = 0;
        let complianceItems = 0;
        try {
          const result = await sql`
            SELECT
              COUNT(*) as total,
              SUM(CASE WHEN compliance_status = 'compliant' THEN 1 ELSE 0 END) as compliant
            FROM compliance_checklist_items
            WHERE hospital_id = ${hospitalId}
          `;
          complianceItems = result[0]?.total || 0;
          complianceScore = complianceItems > 0
            ? Math.round(((result[0]?.compliant || 0) / complianceItems) * 100)
            : 0;
        } catch (e) {
          // Table may not exist yet
        }

        // Get incident count
        let incidentScore = 100;
        try {
          const result = await sql`
            SELECT COUNT(*) as count
            FROM incident_reports
            WHERE hospital_id = ${hospitalId}
            AND created_at > NOW() - INTERVAL '30 days'
          `;
          const incidentCount = result[0]?.count || 0;
          // Deduct 5 points per incident (min 50)
          incidentScore = Math.max(50, 100 - (incidentCount * 5));
        } catch (e) {
          // Table may not exist yet
        }

        // Get quality indicators
        let qualityScore = 0;
        let qualityCount = 0;
        try {
          const result = await sql`
            SELECT
              COUNT(*) as total,
              SUM(CASE WHEN status = 'achieved' THEN 1 ELSE 0 END) as achieved
            FROM quality_indicators
            WHERE hospital_id = ${hospitalId}
          `;
          qualityCount = result[0]?.total || 0;
          qualityScore = qualityCount > 0
            ? Math.round(((result[0]?.achieved || 0) / qualityCount) * 100)
            : 0;
        } catch (e) {
          // Table may not exist yet
        }

        // Calculate overall NABH score (average of components)
        const scores = [complianceScore, incidentScore, qualityScore].filter(s => s > 0);
        const overallScore = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;

        // Insert into nabh_readiness_scores
        try {
          await sql`
            INSERT INTO nabh_readiness_scores (
              hospital_id, score, chapter, compliance_score, incident_score, quality_score, assessment_date, created_at
            ) VALUES (
              ${hospitalId}, ${overallScore}, 'OVERALL', ${complianceScore}, ${incidentScore}, ${qualityScore}, CURRENT_DATE, NOW()
            )
          `;
        } catch (e: any) {
          if (!e.message?.includes('does not exist')) {
            throw e;
          }
        }

        // Generate insight card
        const cards = await generateFromTemplate({
          hospital_id: hospitalId,
          module: 'quality',
          trigger_type: 'compliance_score_calculated',
          data: {
            overall_score: overallScore,
            compliance_score: complianceScore,
            incident_score: incidentScore,
            quality_score: qualityScore,
            compliance_pct: overallScore,
          },
        });

        if (cards && cards.length > 0) {
          cardsGenerated += cards.length;
        }
      } catch (error) {
        errors++;
        console.error(`Error auditing hospital ${hospital.hospital_id}:`, error);
      }
    }

    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'nabh-audit',
      status: errors === 0 ? 'completed' : 'partial',
      cards_generated: cardsGenerated,
      errors,
      duration_ms,
      details: `Audited ${hospitals.length} hospitals`,
    });
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    console.error('NABH audit job failed:', error);

    return NextResponse.json(
      {
        job: 'nabh-audit',
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
