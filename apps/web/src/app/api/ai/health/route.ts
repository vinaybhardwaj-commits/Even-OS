import { NextRequest, NextResponse } from 'next/server';
import { checkHealth } from '@/lib/ai/llm-client';

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const adminKey = req.headers.get('x-admin-key');
    if (adminKey !== process.env.ADMIN_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const healthStatus = await checkHealth();
    const duration_ms = Date.now() - startTime;

    return NextResponse.json({
      ...healthStatus,
      duration_ms,
    });
  } catch (error) {
    const duration_ms = Date.now() - startTime;
    console.error('Health check failed:', error);

    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms,
      },
      { status: 500 }
    );
  }
}
