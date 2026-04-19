import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { getCurrentUser } from '@/lib/auth';
import { checkHealth as checkLlmHealth } from '@/lib/ai/llm-client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/health-summary
 *
 * Aggregated health check for the AdminShell HealthPills row.
 * Returns status + latency for DB, LLM, Blob, Queue, and Deploy components.
 *
 * Gated: logged-in users only. No admin-key required for the client — the
 * endpoint itself uses server-side env for the LLM probe.
 *
 * Response shape (stable — consumed by <HealthPills />):
 * {
 *   db:    { status: 'ok'|'degraded'|'down', latency_ms: number },
 *   llm:   { status: 'ok'|'degraded'|'down', latency_ms: number },
 *   blob:  { status: 'ok'|'unknown',         latency_ms: number },
 *   queue: { status: 'ok'|'unknown',         latency_ms: number },
 *   deploy:{ status: 'ok',                   sha: string, env: string, time: string },
 *   timestamp: string,
 * }
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const timestamp = new Date().toISOString();

  // DB probe
  const dbStart = Date.now();
  let dbStatus: 'ok' | 'degraded' | 'down' = 'down';
  let dbLatency = 0;
  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`SELECT 1 as ok`;
    dbLatency = Date.now() - dbStart;
    dbStatus = dbLatency < 500 ? 'ok' : 'degraded';
  } catch {
    dbLatency = Date.now() - dbStart;
    dbStatus = 'down';
  }

  // LLM probe — only runs for admins (expensive, ~1-3s)
  const llmStart = Date.now();
  let llmStatus: 'ok' | 'degraded' | 'down' | 'unknown' = 'unknown';
  let llmLatency = 0;
  const isAdmin = ['super_admin', 'hospital_admin'].includes(user.role);
  if (isAdmin) {
    try {
      const result = await checkLlmHealth();
      llmLatency = Date.now() - llmStart;
      // checkLlmHealth returns { status: 'online' | 'degraded' | 'offline' } | null
      if (result?.status === 'online') {
        llmStatus = llmLatency < 3000 ? 'ok' : 'degraded';
      } else if (result?.status === 'degraded') {
        llmStatus = 'degraded';
      } else {
        llmStatus = 'down';
      }
    } catch {
      llmLatency = Date.now() - llmStart;
      llmStatus = 'down';
    }
  }

  // Blob — token existence check (cheap). Real ping deferred to AD.4 Status page.
  const blobStatus: 'ok' | 'unknown' = process.env.BLOB_READ_WRITE_TOKEN ? 'ok' : 'unknown';

  // Queue — stub until we wire a real job-queue depth check (AD.4).
  const queueStatus: 'ok' | 'unknown' = 'unknown';

  // Deploy — pull from Vercel env
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'local';
  const env = process.env.VERCEL_ENV || 'development';

  return NextResponse.json({
    db: { status: dbStatus, latency_ms: dbLatency },
    llm: { status: llmStatus, latency_ms: llmLatency },
    blob: { status: blobStatus, latency_ms: 0 },
    queue: { status: queueStatus, latency_ms: 0 },
    deploy: { status: 'ok', sha, env, time: timestamp },
    timestamp,
  });
}
