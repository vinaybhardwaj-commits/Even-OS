/**
 * Playwright config for Even OS — Phase 0 test infra.
 *
 * v1: Chromium only (Linux CI).
 * v1.5: Add Firefox + WebKit when the visual-regression budget supports it.
 *
 * Local dev:  pnpm test:e2e         (runs against http://localhost:3000)
 * CI:         pnpm test:e2e         (runs against TEST_E2E_BASE_URL)
 * Headed UI:  pnpm test:e2e:headed
 * Inspector:  pnpm test:e2e:ui
 */
import { defineConfig, devices } from '@playwright/test';

const baseURL =
  process.env.TEST_E2E_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['github'],
      ]
    : [['list'], ['html', { open: 'on-failure', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Phase 1.5+ enable:
    // { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],
  webServer: process.env.CI
    ? undefined          // CI starts the server in a separate workflow step
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
