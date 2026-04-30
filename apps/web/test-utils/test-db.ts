/**
 * Test-database lifecycle helper.
 *
 * Two modes:
 *   1. **CI mode** (NEON_API_KEY set + CI=1):
 *      Creates a Neon branch off main per worker, runs migrations,
 *      tears down at end. Branches are throwaway; ~5 s create.
 *
 *   2. **Local mode** (TEST_DATABASE_URL set):
 *      Uses a long-lived test database. Per-test isolation achieved
 *      via savepoints (see db-snapshot.ts). Faster turnaround for TDD.
 *
 * Both modes return a `neon()` client identical in shape to the prod runtime,
 * so tests don't care which mode they're in.
 *
 * Phase 0 ships the local-mode helper. CI-mode Neon branch creation is
 * stubbed and logged; wire NEON_API_KEY in Phase 1 once the GitHub Actions
 * workflow is exercising it.
 */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let _client: NeonQueryFunction<false, false> | null = null;
let _branchId: string | null = null;

export function getTestDbUrl(): string {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL or DATABASE_URL not set');
  }
  return url;
}

export function getTestSql(): NeonQueryFunction<false, false> {
  if (!_client) {
    _client = neon(getTestDbUrl());
  }
  return _client;
}

/**
 * Create an ephemeral Neon branch for this test run. CI-only.
 * Phase 0 stub — logs intent; full implementation arrives with Phase 1 CI wiring.
 */
export async function createEphemeralBranch(opts?: {
  parentBranchId?: string;
  name?: string;
}): Promise<{ branchId: string; connectionUrl: string }> {
  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) {
    throw new Error(
      'NEON_API_KEY not set; ephemeral branch creation only works in CI. ' +
        'For local dev set TEST_DATABASE_URL to a dedicated test DB.'
    );
  }
  // Stub. Full implementation: POST /projects/{id}/branches via Neon API.
  // Returns branch id + new connection string targeting the branch.
  // See https://api-docs.neon.tech/reference/createprojectbranch
  console.warn(
    '[test-db] createEphemeralBranch stub — Phase 1 will wire the real Neon API call'
  );
  return {
    branchId: 'stub-' + Date.now(),
    connectionUrl: getTestDbUrl(),
  };
}

/**
 * Tear down the ephemeral branch. CI-only.
 */
export async function destroyEphemeralBranch(_branchId: string): Promise<void> {
  console.warn(
    '[test-db] destroyEphemeralBranch stub — Phase 1 will wire the real Neon API call'
  );
}

/**
 * Reset the cached SQL client. Useful between test files when the connection
 * URL might change (e.g., per-worker ephemeral branches).
 */
export function resetTestSqlCache(): void {
  _client = null;
  _branchId = null;
}

/**
 * Health check — returns true if the test DB is reachable.
 * Used by tests/smoke.test.ts to verify Phase 0 wiring.
 */
export async function pingTestDb(): Promise<boolean> {
  try {
    const sql = getTestSql();
    const result = await sql`SELECT 1 as ping`;
    return Array.isArray(result) && result.length === 1 && result[0].ping === 1;
  } catch (err) {
    console.error('[test-db] ping failed:', err);
    return false;
  }
}
