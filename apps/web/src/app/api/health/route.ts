import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const start = Date.now();

  try {
    // Check database connectivity
    const sql = neon(process.env.DATABASE_URL!);
    const dbStart = Date.now();
    await sql`SELECT 1 as ok`;
    const dbLatency = Date.now() - dbStart;

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime_s: Math.floor(process.uptime()),
      db: {
        status: 'connected',
        latency_ms: dbLatency,
      },
      version: process.env.npm_package_version || '0.1.0',
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        db: {
          status: 'disconnected',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      },
      { status: 503 }
    );
  }
}
