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
    let cardsExpired = 0;
    let errors = 0;

    try {
      // Update expired cards
      const result = await sql`
        UPDATE ai_insight_cards
        SET status = 'expired', updated_at = NOW()
        WHERE expires_at < NOW()
        AND status = 'active'
      `;

      // Get count of affected rows
      if (Array.isArray(result)) {
        cardsExpired = result.length;
      } else if (result && typeof result === 'object' && 'count' in result) {
        cardsExpired = result.count;
      } else {
        // Fallback: query to count expired cards
        try {
          const countResult = await sql`
            SELECT COUNT(*) as count
            FROM ai_insight_cards
            WHERE expires_at < NOW()
            AND status = 'expired'
            AND updated_at > NOW() - INTERVAL '1 minute'
          `;
          cardsExpired = countResult[0]?.count || 0;
        } catch (e) {
          // Table may not exist yet
        }
      }
    } catch (err: any) {
      if (err.message?.includes('does not exist')) {
        const duration_ms = Date.now() - startTime;
        return NextResponse.json({
          job: 'expire-cards',
          status: 'skipped',
          cards_generated: 0,
          errors: 0,
          duration_ms,
          details: 'ai_insight_cards table not found',
        });
      }
      errors++;
      throw err;
    }

    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      job: 'expire-cards',
      status: 'completed',
      cards_generated: cardsExpired,
      errors,
      duration_ms,
      details: `Expired ${cardsExpired} stale cards`,
    });
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    console.error('Expire cards job failed:', error);

    return NextResponse.json(
      {
        job: 'expire-cards',
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
