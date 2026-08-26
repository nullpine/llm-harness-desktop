/**
 * The paths that only show up when something is wrong — acceptance **A10** and
 * **A12**, plus recovery from an unreachable server.
 *
 * A10 shipped "passing" through two milestones while actually failing in the UI:
 * the app started and logged a warning, but the damaged conversation rendered as
 * an ordinary empty chat. Log-only assertions would not have caught that, so
 * these assert what the user sees.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  UNREACHABLE_RECOVERY_MS,
  configure,
  expect,
  fillApiKey,
  launchApp,
  openSettings,
  openConversation,
  test,
  waitForState,
} from './fixtures/app'
import { startMock } from './fixtures/mockServer'

/** Seed a profile with one healthy conversation and one damaged one. */
function seedProfile(userDataDir: string): { healthyId: string; damagedId: string } {
  const dir = join(userDataDir, 'conversations')
  mkdirSync(dir, { recursive: true })

  const healthyId = '01HEALTHY0000000000000000A'
  const damagedId = '01DAMAGED0000000000000000B'
  const now = new Date().toISOString()

  writeFileSync(
    join(dir, `${healthyId}.json`),
    JSON.stringify({
      id: healthyId,
      title: 'A healthy conversation',
      createdAt: now,
      updatedAt: now,
      modelId: 'glm-4.7-flash',
      systemPrompt: null,
      messages: [{ id: 'm1', role: 'user', content: 'still readable', createdAt: now }],
    }),
  )

  // Truncated mid-array — what a crash during a write leaves behind.
  writeFileSync(join(dir, `${damagedId}.json`), '{"id":"01DAMAGED","title":"Broken","messages":[')

  // index.json is intact, which is the whole point: the entry survives, so the
  // app has no way to know it is damaged until someone opens it.
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify([
      { id: healthyId, title: 'A healthy conversation', updatedAt: now, modelId: 'glm-4.7-flash' },
      { id: damagedId, title: 'Broken', updatedAt: now, modelId: 'glm-4.7-flash' },
    ]),
  )

  return { healthyId, damagedId }
}

test('A10: a damaged conversation is explained, removable, and its file is left alone', async () => {
  const mock = await startMock()
  const first = await launchApp()
  const { damagedId } = seedProfile(first.userDataDir)
  const damagedFile = join(first.userDataDir, 'conversations', `${damagedId}.json`)
  await first.close()

  const app = await launchApp({ userDataDir: first.userDataDir })
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'ready')

    // The app started at all.
    await expect(app.window.locator('#root')).toBeVisible()

    // A healthy conversation still opens.
    await openConversation(app.window, 'A healthy conversation')
    await expect(app.window.locator('[data-testid="user-message"]')).toContainText('still readable')

    // The damaged one explains itself rather than showing an empty chat.
    await openConversation(app.window, 'Broken')
    const damaged = app.window.locator('[data-testid="damaged-conversation"]')
    await expect(damaged).toBeVisible()
    await expect(damaged).toContainText('damaged')

    // ...and is marked in the sidebar.
    await expect(app.window.locator('nav [aria-label="damaged"]')).toBeVisible()

    // Remove from list drops it.
    await app.window.getByRole('button', { name: 'Remove from list' }).click()
    await expect(
      app.window.locator('[data-testid="conversation-select"]', { hasText: 'Broken' }),
    ).toHaveCount(0)

    // But the bytes are still there — they may be recoverable by hand.
    expect(existsSync(damagedFile), 'Remove from list deleted the file').toBe(true)
  } finally {
    await app.close()
  }

  // And it does not come back on the next launch.
  const relaunched = await launchApp({ userDataDir: first.userDataDir })
  try {
    await expect(
      relaunched.window.locator('[data-testid="conversation-select"]', { hasText: 'Broken' }),
    ).toHaveCount(0)
    await expect(
      relaunched.window.locator('[data-testid="conversation-select"]', { hasText: 'healthy' }),
    ).toBeVisible()
  } finally {
    await relaunched.close()
    await mock.server.close()
  }
})

test('A12: with no model active the composer explains itself and Send does nothing', async () => {
  const mock = await startMock()
  // Hold the server in idle: reachable, authenticated, but nothing loaded.
  mock.server.setState({ state: 'idle', activeModelId: null })

  const app = await launchApp()
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'idle')

    const reason = app.window.locator('[data-testid="composer-disabled"]')
    await expect(reason).toBeVisible()
    await expect(reason).toContainText('No model is loaded')
    // Never a raw code or status.
    await expect(reason).not.toContainText('model_not_active')
    await expect(reason).not.toContainText('409')

    await expect(app.window.getByRole('textbox', { name: 'Message' })).toBeDisabled()
    // Nothing was sent, because nothing could be.
    await expect(app.window.locator('[data-testid="user-message"]')).toHaveCount(0)
  } finally {
    await app.close()
    await mock.server.close()
  }
})

test('unreachable: friendly copy, and automatic recovery once the server returns', async () => {
  // SPEC §9 backs the poller off to 60 s after three failures, so recovery is
  // specified to be slow. See the note in the PR: spec-conformant, but it reads
  // as broken to someone who has just fixed their own config.
  test.setTimeout(UNREACHABLE_RECOVERY_MS + 30_000)
  // Point at a port nothing is listening on.
  const deadPort = 59_997
  const key = 'a-key-the-server-will-accept'
  const app = await launchApp()

  try {
    await configure(app.window, `http://127.0.0.1:${deadPort}`, key)
    await waitForState(app.window, 'unreachable')

    const reason = app.window.locator('[data-testid="composer-disabled"]')
    await expect(reason).toContainText("Can't reach the server")
    await expect(reason).not.toContainText('network_error')

    // Now bring a server up on that exact port and wait for the poller to notice
    // on its own — no user action, no restart.
    // Same key, so recovery is not blocked by a 401 pretending to be a backoff.
    const mock = await startMock({ port: deadPort, apiKey: key })
    try {
      await waitForState(app.window, 'ready', UNREACHABLE_RECOVERY_MS)
    } finally {
      await mock.server.close()
    }
  } finally {
    await app.close()
  }
})

test('Test connection and the header agree after a server comes back', async () => {
  test.setTimeout(UNREACHABLE_RECOVERY_MS + 30_000)
  // The open question from M2 finding 5: does a successful Test connection leave
  // the header stale, or do the two agree?
  const deadPort = 59_996
  const app = await launchApp()

  try {
    await configure(app.window, `http://127.0.0.1:${deadPort}`, 'any-key')
    await waitForState(app.window, 'unreachable')

    const mock = await startMock({ port: deadPort })
    try {
      await openSettings(app.window)
      await fillApiKey(app.window, mock.apiKey)
      await app.window.getByRole('button', { name: 'Test connection' }).click()
      await expect(app.window.locator('[data-testid="test-outcome"]')).toContainText('Connected')

      await app.window.getByRole('button', { name: 'Save' }).click()
      // Saving settings *does* refresh the poller (settings:set calls
      // poller.refresh()), so this should be prompt — unlike recovery with no
      // user action at all. `server:test` alone does not, which is the open
      // finding from M2.
      await waitForState(app.window, 'ready', UNREACHABLE_RECOVERY_MS)
    } finally {
      await mock.server.close()
    }
  } finally {
    await app.close()
  }
})
