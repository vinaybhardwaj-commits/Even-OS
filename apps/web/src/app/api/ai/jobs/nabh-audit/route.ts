import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { runNabhAudit } from '@/lib/ai/quality/nabh-auditor';

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
    let hospitalId: string;
    try {
      const hospitals = await sql`SELECT id FROM hospitals LIMIT 1`;
      if (!hospitals || hospitals.length === 0) {
        return NextResponse.json({ job: 'nabh-audit', status: 'skipped', cards_generated: 0, errors: 0, duration_ms: Date.now() - startTime, details: 'No hospitals found' });
      }
      hospitalId = hospitals[0].id;
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        return NextResponse.json({ job: 'nabh-audit', status: 'skipped', cards_generated: 0, errors: 0, duration_ms: Date.now() - startTime, details: 'hospitals table not found' });
      }
      throw err;
    }
    const result = await runNabhAudit(hospitalId);
    return NextResponse.json({
      job: 'nabh-audit',
      status: 'completed',
      cards_generated: 1,
      overall_score: result.overall_score,
      chapters: result.chapter_scores.map((c: any) => ({ chapter: c.chapter, score: c.score, status: c.status })),
      top_gaps: result.top_gaps.slice(0, 3),
      action_items_count: result.action_items.length,
      errors: 0,
      duration_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[nabh-audit] Job failed:', error);
    return NextResponse.json({ job: 'nabh-audit', status: 'failed', cards_generated: 0, errors: 1, duration_ms: Date.now() - startTime, details: error?.message || 'Unknown error' }, { status: 500 });
  }
}
