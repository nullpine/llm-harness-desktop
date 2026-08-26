/**
 * Playwright, driving the real Electron app.
 *
 * No browser projects: every test launches the built app through `_electron`, so
 * there is nothing for Playwright's browser downloads to do.
 *
 * Tests run against `out/` — the **built** app, not the Vite dev server. The dev
 * CSP carve-out (`'unsafe-inline'` in `script-src`) exists only in dev, so testing
 * against dev would mean the strict packaged policy is never exercised end to
 * end. That is exactly the gap the packaged-app check caught during M2.
 */

import { defineConfig } from '@playwright/test'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  // The mock's simulated activation is the slowest thing here, and Electron
  // takes a moment to boot on a cold CI runner.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // A flaky e2e suite is worse than none: locally a failure is a failure. CI
  // gets one retry, purely for runner-level noise.
  retries: isCI ? 1 : 0,
  // Electron apps bind ports and profiles; running them in parallel invites
  // interference that looks like flakiness.
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    // A red CI run you cannot see is worse than none.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
