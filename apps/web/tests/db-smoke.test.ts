/**
 * DB smoke — verifies a Postgres connection round-trips.
 *
 * Gated behind VITEST_INTEGRATION=1 to keep the unit test suite hermetic.
 * Run with: pnpm test:integration  (added in Phase 1)
 *           or: VITEST_INTEGRATION=1 pnpm test
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { pingTestDb, resetTestSqlCache } from '../test-utils/test-db';

const RUN = process.env.VITEST_INTEGRATION === '1';

describe.runIf(RUN)('Phase 0 db smoke', () => {
  beforeAll(() => {
    resetTestSqlCache();
  });

  it('pings the test database successfully', async () => {
    const ok = await pingTestDb();
    expect(ok).toBe(true);
  });
});

// Reminder for engineers when integration tests are skipped
describe.skipIf(RUN)('Phase 0 db smoke (skipped)', () => {
  it('runs only with VITEST_INTEGRATION=1', () => {
    expect(RUN).toBe(false);
  });
});
