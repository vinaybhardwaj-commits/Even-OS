# Test Utilities — Phase 0

Phase 0 of the Even OS test infrastructure scaffold. This directory provides
the foundation that every PRD's tests will use as they ship.

## What's here

| File | Purpose |
|---|---|
| `setup.ts` | Global Vitest setup: loads envs, sets IST timezone, validates DB URL non-prod |
| `test-db.ts` | Neon SQL client lifecycle + ephemeral branch helpers (CI mode) |
| `db-snapshot.ts` | Per-test isolation via savepoints (`withDbSnapshot`) |
| `mock-clock.ts` | Fake timers + working-day arithmetic (`withMockClock`, `advanceClock`) |
| `factories.ts` | Test fixture factories (vendor / item / indent / PO / hospital / user) |
| `index.ts` | Barrel export — single import surface for tests |

## Quick start

```bash
# Install (run once after pulling)
pnpm install

# Unit + integration tests (Vitest)
pnpm --filter @even-os/web test          # one-shot run
pnpm --filter @even-os/web test:watch    # watch mode for TDD
pnpm --filter @even-os/web test:coverage # with coverage report
pnpm --filter @even-os/web test:ui       # Vitest UI (browser)

# DB-touching integration tests (gated)
VITEST_INTEGRATION=1 pnpm --filter @even-os/web test

# E2E tests (Playwright)
pnpm --filter @even-os/web test:e2e         # headless against TEST_E2E_BASE_URL
pnpm --filter @even-os/web test:e2e:headed  # headed (see browser)
pnpm --filter @even-os/web test:e2e:ui      # Playwright UI inspector
```

## Writing tests

### Unit test (no DB)

```typescript
// apps/web/src/lib/scm/some-helper.test.ts
import { describe, it, expect } from 'vitest';
import { someHelper } from './some-helper';

describe('someHelper', () => {
  it('returns the right value', () => {
    expect(someHelper(42)).toBe(43);
  });
});
```

### Integration test (DB-touching with isolation)

```typescript
// apps/web/tests/scm/vendors.test.ts
import { describe, it, expect } from 'vitest';
import { withDbSnapshot, makeVendor, getTestSql } from '@/test-utils';

describe('vendors', () => {
  withDbSnapshot();  // wires beforeEach/afterEach for savepoint isolation

  it('inserts a vendor', async () => {
    const sql = getTestSql();
    const v = makeVendor({ vendor_name: 'Acme Pharma' });
    await sql`
      INSERT INTO vendors (id, hospital_id, vendor_code, vendor_name, ...)
      VALUES (${v.id}, ${v.hospital_id}, ${v.vendor_code}, ${v.vendor_name}, ...)
    `;
    const rows = await sql`SELECT * FROM vendors WHERE id = ${v.id}`;
    expect(rows).toHaveLength(1);
  });
});
```

### Time-sensitive test

```typescript
import { describe, it, expect } from 'vitest';
import { withMockClock, advanceClock } from '@/test-utils';

describe('SLA', () => {
  withMockClock();  // pins time to 1 May 2026 09:00 IST

  it('breaches at 24h', () => {
    const startedAt = new Date();
    advanceClock({ hours: 25 });
    expect(Date.now() - startedAt.getTime()).toBeGreaterThan(24 * 3600 * 1000);
  });
});
```

### E2E test (Playwright)

```typescript
// apps/web/tests/e2e/login.spec.ts
import { test, expect } from '@playwright/test';

test('login flow', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name="email"]', 'demo@even.in');
  await page.fill('input[name="password"]', 'demo1234');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/care/);
});
```

## CI

`.github/workflows/test.yml` runs on every PR + push to `main`:

- **lint**: prettier + eslint + tsc
- **unit**: Vitest unit tests (no DB)
- **integration**: gated; runs only if `NEON_API_KEY` secret is set
- **e2e**: gated; runs only on `main` push + only if `TEST_E2E_BASE_URL` secret is set
- **build**: ensures Next.js builds cleanly

Required GitHub secrets to enable full pipeline:

| Secret | Purpose |
|---|---|
| `NEON_API_KEY` | Ephemeral branch creation for integration tests |
| `TEST_DATABASE_URL` | Local-mode test DB connection (alternative to NEON_API_KEY) |
| `TEST_E2E_BASE_URL` | Playwright target (e.g., Vercel preview URL) |

Until those secrets are set, integration + e2e jobs report "skipped" but don't fail the pipeline.

## Coverage thresholds (per PRD wave plan)

| Phase | Lines threshold |
|---|---|
| Phase 0 (now) | 0% (baseline; suite empty) |
| Phase 1 ship | 30% on touched paths |
| Phase 4 ship | 60% |
| Phase 8 (pre-launch) | 80% across the board |

Raise thresholds in `vitest.config.ts → coverage.thresholds`.

## Adding factories per PRD

When a new PRD lands, add its factories alongside `factories.ts` or in a
subdirectory:

```
apps/web/test-utils/
├── factories.ts            # foundation (vendor / item / indent / PO)
├── factories/
│   ├── billing.ts          # Phase 4 charge_items
│   ├── codes.ts            # Codes Layer 1 + standards
│   ├── chart.ts            # Patient Chart notes
│   └── ...
```

Re-export from `index.ts` to keep the single-import-surface convention.

## Phase 0 deliverables checklist

- [x] `vitest.config.ts` + `vitest.setup.ts` paths matching tsconfig
- [x] `playwright.config.ts` chromium-only v1
- [x] `test-utils/factories.ts` with foundation fixtures
- [x] `test-utils/db-snapshot.ts` savepoint helper
- [x] `test-utils/mock-clock.ts` fake timers + working-day arithmetic
- [x] `test-utils/test-db.ts` Neon ephemeral branch + local mode
- [x] `tests/smoke.test.ts` — Vitest infra smoke (no DB)
- [x] `tests/db-smoke.test.ts` — DB roundtrip (gated)
- [x] `tests/e2e/health.spec.ts` — Playwright `/api/health` smoke
- [x] `.github/workflows/test.yml` — CI pipeline
- [x] `.env.test.example` — local env template
- [x] `.gitignore` updates for coverage / playwright-report
- [x] turbo.json + package.json scripts
- [ ] **PENDING: `pnpm install` locally to verify deps resolve** (V to run on machine)
- [ ] **PENDING: First `pnpm test` run locally** (V to run on machine)
- [ ] **PENDING: GitHub secrets configured** (NEON_API_KEY, TEST_DATABASE_URL, TEST_E2E_BASE_URL)

## What Phase 1 adds

- Real Neon API integration in `test-db.ts` (createEphemeralBranch / destroyEphemeralBranch implementations)
- Drizzle migration runner that targets the ephemeral branch
- Per-PRD factories shipping alongside their schema migrations
- Coverage threshold raised to 30%
- Vercel preview URL → `TEST_E2E_BASE_URL` automation
