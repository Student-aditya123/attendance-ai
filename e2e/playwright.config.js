// e2e/playwright.config.js
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration.
 *
 * Local dev:   BASE_URL defaults to http://localhost:5173
 * CI:          BASE_URL is set to the staging environment URL
 *
 * Strategy:
 *   - chromium only for CI (fast, standard)
 *   - chromium + firefox + mobile Safari for full regression runs
 *   - Screenshots and video captured on first retry so failures are diagnosable
 *   - 2 retries in CI to handle flakiness from network timing
 */

export default defineConfig({
  testDir:   './tests',
  timeout:   30_000,          // 30s per test
  retries:   process.env.CI ? 2 : 0,
  workers:   process.env.CI ? 2 : 4,
  reporter:  process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report' }]],

  use: {
    baseURL:           process.env.BASE_URL || 'http://localhost:5173',
    trace:             'on-first-retry',
    screenshot:        'only-on-failure',
    video:             'on-first-retry',
    actionTimeout:     8_000,
    navigationTimeout: 15_000,
  },

  projects: [
    // ── Smoke suite (CI — fast) ─────────────────────────────────────────────
    {
      name:    'chromium',
      use:     { ...devices['Desktop Chrome'] },
      grep:    process.env.CI ? undefined : undefined,   // run all tests
    },

    // ── Full cross-browser regression (local / scheduled CI) ──────────────
    ...(process.env.FULL_REGRESSION ? [
      {
        name: 'firefox',
        use:  { ...devices['Desktop Firefox'] },
      },
      {
        name: 'webkit',
        use:  { ...devices['Desktop Safari'] },
      },
      {
        name: 'Mobile Chrome',
        use:  { ...devices['Pixel 5'] },
      },
      {
        name: 'Mobile Safari',
        use:  { ...devices['iPhone 13'] },
      },
    ] : []),
  ],

  // Start the dev server before running tests if it's not already running
  webServer: process.env.CI ? undefined : {
    command:           'cd ../frontend && npm run dev',
    url:               'http://localhost:5173',
    reuseExistingServer: true,
    timeout:           30_000,
  },
});
