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
  // Keep everything from every attempt, including attempts that a retry later
  // masked. `retries: 1` in CI means a flake reports as "flaky" rather than
  // "failed", and with failure-only artifacts the evidence for the attempt that
  // actually broke would be discarded — leaving a known-intermittent test with
  // nothing to diagnose it from. That happened once already, to A7.
  preserveOutput: 'always',
  use: {
    // `retain-on-first-failure`, not `retain-on-failure`: the latter keeps a
    // trace only when the test *ends* failed, so a passing retry discards the
    // trace of the attempt that broke — the only one worth having. And not
    // `on-first-retry`, which traces the retry: that is the attempt that
    // usually passes.
    trace: 'retain-on-first-failure',
    screenshot: 'on-first-failure',
  },
})
