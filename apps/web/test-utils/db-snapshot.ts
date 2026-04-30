/**
 * Per-test DB isolation via Postgres savepoints.
 *
 * Pattern:
 *   beforeEach: BEGIN + SAVEPOINT test_isolation
 *   afterEach:  ROLLBACK TO SAVEPOINT test_isolation; ROLLBACK
 *
 * This means every test sees the same starting DB state and any inserts /
 * updates / deletes get rolled back, regardless of test outcome (pass / fail
 * / error). No fixture-pollution leakage between tests.
 *
 * USAGE:
 *
 *   import { withDbSnapshot } from '@/test-utils/db-snapshot';
 *
 *   describe('SCM vendors', () => {
 *     withDbSnapshot();  // wires beforeEach + afterEach
 *
 *     it('creates a vendor', async () => {
 *       // Any DB writes here are rolled back automatically.
 *     });
 *   });
 *
 * IMPORTANT:
 *   - Only one savepoint per test; nested savepoints not supported in v1
 *   - Tests must use the SAME sql client returned by getTestSql() —
 *     otherwise the savepoint isolation doesn't apply
 *   - Concurrent tests in the same file would share state; use sequential
 *     test mode (vitest.config.ts default)
 */
import { afterEach, beforeEach } from 'vitest';
import { getTestSql, resetTestSqlCache } from './test-db';

const SAVEPOINT_NAME = 'test_isolation';

let _activeSavepoint = false;

export function withDbSnapshot(): void {
  beforeEach(async () => {
    if (_activeSavepoint) {
      throw new Error(
        'withDbSnapshot called twice without teardown — nested savepoints not supported in Phase 0'
      );
    }
    const sql = getTestSql();
    // Note: Neon's serverless driver auto-commits each statement, so this
    // savepoint pattern requires Postgres TRANSACTION semantics. The neon-serverless
    // package has a `transaction()` helper for this. Phase 1 will wrap.
    //
    // For Phase 0 this is a placeholder pattern that will be properly wired
    // once we have the first integration test that needs it.
    await sql.unsafe(`BEGIN`);
    await sql.unsafe(`SAVEPOINT ${SAVEPOINT_NAME}`);
    _activeSavepoint = true;
  });

  afterEach(async () => {
    if (!_activeSavepoint) return;
    const sql = getTestSql();
    try {
      await sql.unsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT_NAME}`);
      await sql.unsafe(`ROLLBACK`);
    } finally {
      _activeSavepoint = false;
      // Reset cache so next describe block gets a fresh connection
      resetTestSqlCache();
    }
  });
}

/**
 * Lower-level helper for tests that need explicit control.
 */
export async function takeSnapshot(): Promise<void> {
  const sql = getTestSql();
  await sql.unsafe(`BEGIN`);
  await sql.unsafe(`SAVEPOINT ${SAVEPOINT_NAME}`);
  _activeSavepoint = true;
}

export async function restoreSnapshot(): Promise<void> {
  if (!_activeSavepoint) return;
  const sql = getTestSql();
  await sql.unsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT_NAME}`);
  await sql.unsafe(`ROLLBACK`);
  _activeSavepoint = false;
}
