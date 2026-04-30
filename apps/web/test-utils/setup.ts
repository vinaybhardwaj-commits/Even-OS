/**
 * Global Vitest setup — runs once before the test suite for each pool fork.
 *
 * Responsibilities:
 *   1. Load environment variables (.env.test then .env.local then .env).
 *   2. Validate critical envs are set.
 *   3. Wire up testing-library matchers (@testing-library/jest-dom).
 *   4. Set deterministic timezone (IST) so date-sensitive tests don't drift across CI hosts.
 *
 * NOTE: Per-test setup (DB savepoints, fake timers) lives in helpers under test-utils/
 *       and is opted-in via beforeEach in individual test files.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import '@testing-library/jest-dom/vitest';

// Load envs in priority order (later wins for unset keys; existing process.env wins)
loadEnv({ path: path.resolve(process.cwd(), '.env.test') });
loadEnv({ path: path.resolve(process.cwd(), '.env.local') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

// Deterministic IST for SLA / working-day calculations
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

// Validate critical envs only when running integration / e2e shaped tests.
// Pure unit tests don't need DATABASE_URL.
const REQUIRES_DB =
  process.env.VITEST_INTEGRATION === '1' ||
  process.env.VITEST_E2E === '1' ||
  process.argv.some((a) => a.includes('integration'));

if (REQUIRES_DB) {
  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL or DATABASE_URL must be set for integration tests. ' +
        'Set in apps/web/.env.test or pass via the shell.'
    );
  }
  if (databaseUrl.includes('prod') || databaseUrl.includes('production')) {
    throw new Error(
      'Refusing to run tests against a URL that mentions prod/production. ' +
        'Use a Neon ephemeral branch or a dedicated test database.'
    );
  }
}
