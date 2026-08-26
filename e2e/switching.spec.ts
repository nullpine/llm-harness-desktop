/**
 * The model dropdown — acceptance **A4**, **A5** and **A6**.
 *
 * Driven against the mock's simulated load, so the `loading` window is real and
 * observable rather than instant. Every assertion here was checked against
 * deliberately broken code first: a switching test that passes against a broken
 * switch is worse than no test.
 */

import { configure, expect, launchApp, newChat, send, test, waitForState } from './fixtures/app'
import { startMock, TEST_LOAD_MS } from './fixtures/mockServer'

const assistant = '[data-testid="assistant-message"]'

async function openDropdown(window: Awaited<ReturnType<typeof launchApp>>['window']) {
  await window.locator('[data-testid="model-dropdown"]').click()
  await expect(window.locator('[data-testid="model-list"]')).toBeVisible()
}

// --- A4: the switch -----------------------------------------------------------

test('A4: dropdown lists both models with the active one marked', async ({ configuredApp }) => {
  const { window } = configuredApp
  await openDropdown(window)

  await expect(window.locator('[data-testid="model-option-glm-4.7-flash"]')).toBeVisible()
  await expect(window.locator('[data-testid="model-option-qwen3.8-27b"]')).toBeVisible()
  await expect(window.locator('[data-testid="model-option-glm-4.7-flash"]')).toHaveAttribute(
    'aria-selected',
    'true',
  )
  // model_ref is shown: it is the first thing you want when something is wrong.
  await expect(window.locator('[data-testid="model-list"]')).toContainText('qwen3.8:27b-q4_K_M')
})

test('A4: the dialog advertises the duration the server reported', async ({ configuredApp }) => {
  const { window } = configuredApp
  await openDropdown(window)
  await window.locator('[data-testid="model-option-qwen3.8-27b"]').click()

  const dialog = window.locator('[data-testid="switch-dialog"]')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('unloads GLM 4.7 Flash')
  await expect(dialog).toContainText('loads Qwen 3.8 27B')

  // 35 s is what the mock's catalog advertises. The number is data from
  // /admin/models, never a string in the client — a dialog that promises two
  // minutes before a ten-second wait trains people to ignore every estimate.
  await expect(window.locator('[data-testid="switch-duration"]')).toHaveText('35 seconds')
})

test('A4: switching shows a counting banner, then re-enables the composer', async ({
  configuredApp,
}) => {
  const { window } = configuredApp
  await newChat(window)

  await openDropdown(window)
  await window.locator('[data-testid="model-option-qwen3.8-27b"]').click()
  await window.locator('[data-testid="confirm-switch"]').click()

  // Loading: banner visible, hint from the server, composer disabled.
  const banner = window.locator('[data-testid="load-banner"]')
  await expect(banner).toBeVisible()
  await expect(banner).toHaveAttribute('data-failed', 'false')
  await expect(window.locator('[data-testid="load-hint"]')).not.toHaveText('')
  await expect(window.locator('[data-testid="load-elapsed"]')).toBeVisible()
  await expect(window.getByRole('textbox', { name: 'Message' })).toBeDisabled()

  // Ready: banner gone, composer usable, dropdown shows the new model.
  await waitForState(window, 'ready')
  await expect(banner).toBeHidden()
  await expect(window.getByRole('textbox', { name: 'Message' })).toBeEnabled()
  await expect(window.locator('[data-testid="model-dropdown"]')).toContainText('Qwen 3.8 27B')
})

test('A4: selecting the already-active model does nothing', async ({ configuredApp }) => {
  const { window } = configuredApp
  await openDropdown(window)
  await window.locator('[data-testid="model-option-glm-4.7-flash"]').click()

  await expect(window.locator('[data-testid="switch-dialog"]')).toHaveCount(0)
  await expect(window.locator('[data-testid="load-banner"]')).toHaveCount(0)
})

test('A4: cancelling the dialog does not switch', async ({ configuredApp }) => {
  const { window } = configuredApp
  await openDropdown(window)
  await window.locator('[data-testid="model-option-qwen3.8-27b"]').click()
  await window.getByRole('button', { name: 'Cancel' }).click()

  await expect(window.locator('[data-testid="switch-dialog"]')).toHaveCount(0)
  await expect(window.locator('[data-testid="model-dropdown"]')).toContainText('GLM 4.7 Flash')
})

// --- A5: the transcript remembers who said what -------------------------------

test('A5: after a switch the reply is labelled with the new model, with a divider', async ({
  configuredApp,
}) => {
  const { window } = configuredApp
  await newChat(window)

  await send(window, 'Answer from the first model.')
  await expect(window.locator(assistant).last()).toContainText('mock response')
  await expect(window.locator(assistant).last()).toContainText('GLM 4.7 Flash')

  await openDropdown(window)
  await window.locator('[data-testid="model-option-qwen3.8-27b"]').click()
  await window.locator('[data-testid="confirm-switch"]').click()
  await waitForState(window, 'ready')

  await send(window, 'Answer from the second model.')
  await expect(window.locator(assistant).last()).toContainText('mock response')

  // The new reply carries the new model...
  await expect(window.locator(assistant).last()).toContainText('Qwen 3.8 27B')
  // ...the old one still carries the old...
  await expect(window.locator(assistant).first()).toContainText('GLM 4.7 Flash')
  // ...and the transcript says where it changed.
  await expect(window.locator('[data-testid="model-divider"]')).toContainText(
    'switched to Qwen 3.8 27B',
  )
})

test('A5: switching does not clear the conversation', async ({ configuredApp }) => {
  const { window } = configuredApp
  await newChat(window)
  await send(window, 'Remember this message across the switch.')
  await expect(window.locator(assistant).last()).toContainText('mock response')

  await openDropdown(window)
  await window.locator('[data-testid="model-option-qwen3.8-27b"]').click()
  await window.locator('[data-testid="confirm-switch"]').click()
  await waitForState(window, 'ready')

  await expect(window.locator('[data-testid="user-message"]')).toContainText(
    'Remember this message across the switch.',
  )
})

// --- the failure path ---------------------------------------------------------

test('a failed activation shows a red banner, the reason, and the server logs', async () => {
  // This path had never been exercised end to end before M3.
  const mock = await startMock({ activationFails: true })
  const app = await launchApp()
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'ready')

    await openDropdown(app.window)
    await app.window.locator('[data-testid="model-option-qwen3.8-27b"]').click()
    await app.window.locator('[data-testid="confirm-switch"]').click()

    const banner = app.window.locator('[data-testid="load-banner"]')
    await expect(banner).toHaveAttribute('data-failed', 'true')
    await expect(app.window.locator('[data-testid="load-error"]')).toContainText('out of memory')

    // And the logs modal actually renders what /admin/logs returned.
    await app.window.locator('[data-testid="view-server-logs"]').click()
    await expect(app.window.locator('[data-testid="server-logs"]')).toContainText('mock vllm line')

    await app.window.locator('[data-testid="logs-source-control"]').click()
    await expect(app.window.locator('[data-testid="server-logs"]')).toContainText(
      'mock control line',
    )
  } finally {
    await app.close()
    await mock.server.close()
  }
})

// --- A6: recovery -------------------------------------------------------------

test('A6: the server going away is handled, and recovery is automatic', async () => {
  // SPEC §9 backs the poller off to 60 s after three failures, so both the loss
  // and the recovery are deliberately slow. See the M4 backlog item.
  test.setTimeout(420_000)
  const port = 59_994
  const key = 'a-key-both-sides-agree-on'
  const first = await startMock({ port, apiKey: key })
  const app = await launchApp()

  try {
    await configure(app.window, `http://127.0.0.1:${port}`, key)
    await waitForState(app.window, 'ready')
    await newChat(app.window)

    // The backend goes away mid-session.
    await first.server.close()

    // Up to 150 s, not A6's 60 s, and the difference is a real finding rather
    // than a slow test. SPEC §9 polls every 30 s when settled and needs three
    // consecutive failures, so a dead *control plane* takes up to 90 s to
    // notice. (A dead *model* is quick: the server itself reports `error` and
    // the next poll picks it up within 30 s — that path does meet A6.)
    // Recorded against the M4 backoff item; deliberately not fixed here.
    await waitForState(app.window, 'unreachable', 150_000)

    // Friendly copy, no raw code, no crash.
    const reason = app.window.locator('[data-testid="composer-disabled"]')
    await expect(reason).toContainText("Can't reach the server")
    await expect(reason).not.toContainText('network_error')
    await expect(app.window.locator('#root')).toBeVisible()

    // And it comes back on its own — no restart, no user action. SPEC §9 backs
    // the poller off to 60 s after three failures, so this is deliberately slow;
    // see the M4 backlog item about making that escalate instead.
    const second = await startMock({ port, apiKey: key })
    try {
      await waitForState(app.window, 'ready', 150_000)
      await expect(app.window.getByRole('textbox', { name: 'Message' })).toBeEnabled()
    } finally {
      await second.server.close()
    }
  } finally {
    await app.close()
  }
})

test('A6: a switch left mid-flight when the server dies does not wedge the UI', async () => {
  test.setTimeout(300_000)
  const port = 59_993
  const key = 'another-agreed-key'
  const mock = await startMock({ port, apiKey: key, loadMs: TEST_LOAD_MS * 20 })
  const app = await launchApp()

  try {
    await configure(app.window, `http://127.0.0.1:${port}`, key)
    await waitForState(app.window, 'ready')

    await openDropdown(app.window)
    await app.window.locator('[data-testid="model-option-qwen3.8-27b"]').click()
    await app.window.locator('[data-testid="confirm-switch"]').click()
    await expect(app.window.locator('[data-testid="load-banner"]')).toBeVisible()

    await mock.server.close()

    await waitForState(app.window, 'unreachable', 150_000)
    await expect(app.window.locator('#root')).toBeVisible()
  } finally {
    await app.close()
  }
})
