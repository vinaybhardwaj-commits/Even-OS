import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { runTemplateEvolution } from '@/lib/ai/template-evolution';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const adminKey = req.headers.get('x-admin-key');
    if (adminKey !== process.env.ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL!);
    const hospitals = await sql`SELECT hospital_id FROM hospitals LIMIT 1`;
    if (!hospitals || (hospitals as any[]).length === 0) {
      return NextResponse.json({
        job: 'template-evolution', status: 'skipped',
        duration_ms: Date.now() - startTime, details: 'No hospitals found',
      });
    }

    const hospitalId = (hospitals as any[])[0].hospital_id;
    const result = await runTemplateEvolution(hospitalId);

    return NextResponse.json({
      job: 'template-evolution',
      status: result.errors > 0 ? 'partial' : 'ok',
      ...result,
      duration_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    return NextResponse.json({
      job: 'template-evolution', status: 'error',
      error: error.message, duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
