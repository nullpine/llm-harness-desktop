/**
 * Sweeping the temp `userData` profiles the suite creates.
 *
 * `launchApp()` mints a fresh profile per launch with `mkdtempSync`, and every
 * spec calls it directly rather than through the `appHandle` fixture — which is
 * the only thing that was removing them. The result was 321 `harness-e2e-*`
 * directories, ~550 MB, accumulated under `/var/folders` across runs.
 *
 * Deliberately a global sweep rather than a delete inside `close()`: the restart
 * specs (A1, A7) close one app and relaunch against the *same* profile, which is
 * the whole point of the test. Ownership therefore belongs to the run, not to a
 * handle.
 *
 * The setup sweep matters as much as the teardown one: an interrupted run — Ctrl-C,
 * a killed CI job — never reaches teardown at all.
 */

import { readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PREFIX = 'harness-e2e-'

/** Remove every `harness-e2e-*` profile in the system temp directory. */
export function sweepProfiles(): number {
  const root = tmpdir()
  let removed = 0

  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return 0 // an unreadable tmpdir is not worth failing a test run over
  }

  for (const entry of entries) {
    if (!entry.startsWith(PREFIX)) continue
    const path = join(root, entry)
    try {
      if (!statSync(path).isDirectory()) continue
      rmSync(path, { recursive: true, force: true })
      removed += 1
    } catch {
      // Racing another run, or a file held open. Leaving one behind is the
      // failure this module exists to reduce, not one it needs to be perfect at.
    }
  }
  return removed
}

/**
 * Wired as **both** `globalSetup` and `globalTeardown`. Playwright calls the
 * default export for each, so one function serves both — the work is identical,
 * and doing it at both ends is what makes an interrupted run self-healing.
 */
export default function sweep(): void {
  const removed = sweepProfiles()
  if (removed > 0) console.log(`swept ${removed} leftover e2e profile(s) from ${tmpdir()}`)
}
