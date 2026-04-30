/**
 * Phase 0 e2e smoke — Playwright hits the public health endpoint.
 *
 * Per credentials memory: GET /api/health is the public no-auth health check
 * that returns { status, timestamp, uptime_s, db: { status, latency_ms }, ... }.
 *
 * If this passes:
 *   - Playwright is wired
 *   - The target server is reachable
 *   - The Next.js app is rendering API routes
 */
import { test, expect } from '@playwright/test';

test.describe('Phase 0 e2e — health endpoint', () => {
  test('GET /api/health returns 200 with status payload', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('db');
    expect(body.db).toHaveProperty('status');
  });

  test('homepage renders without 5xx', async ({ page }) => {
    const response = await page.goto('/');
    // Login redirect is fine; we just need not-500
    expect(response?.status() ?? 0).toBeLessThan(500);
  });
});
