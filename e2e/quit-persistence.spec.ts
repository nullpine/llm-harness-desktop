/**
 * Quitting mid-reply keeps what the user watched arrive.
 *
 * A7 waits for the stream to *finish* before closing, which is correct for A7
 * and leaves this case uncovered. This covers the behaviour end to end: the
 * partial reply is on disk after a restart, marked the way Stop marks one.
 *
 * **It is not the regression guard for the bug it describes, and it was checked.**
 * Deleting the `before-quit` handler leaves this test passing, because
 * Playwright's `close()` shuts the app down gracefully and the Node event loop
 * survives long enough for the pending write to land regardless. The race needs
 * the process to die promptly after quit, which this harness cannot produce.
 *
 * `src/main/__tests__/quitPersistence.test.ts` is the guard — it drives
 * `shutdown()` directly and fails with "the reply was lost" when the wait is
 * removed. This file's job is to prove the wiring reaches the UI at all.
 */

import { configure, expect, launchApp, newChat, test, waitForState } from './fixtures/app'
import { startMock } from './fixtures/mockServer'

const assistant = '[data-testid="assistant-message"]'

test('quitting mid-stream keeps the partial reply, marked stopped', async () => {
  test.setTimeout(120_000)
  // Slow tokens, so the reply is unambiguously still arriving when we quit.
  const mock = await startMock({ tokenDelayMs: 120 })
  const first = await launchApp()

  try {
    await configure(first.window, mock.url, mock.apiKey)
    await waitForState(first.window, 'ready')
    await newChat(first.window)

    const composer = first.window.getByRole('textbox', { name: 'Message' })
    await composer.fill('Say something reasonably long back to me.')
    await composer.press('Enter')

    // Wait for text to appear, then quit *while it is still streaming* — the
    // exact thing that used to lose the whole message.
    const bubble = first.window.locator(assistant).last()
    await expect(bubble.locator('[data-testid="assistant-content"]')).not.toHaveText('')
    await expect(bubble).toHaveAttribute('data-streaming', 'true')
  } finally {
    await first.close()
  }

  const second = await launchApp({ userDataDir: first.userDataDir })
  try {
    await waitForState(second.window, 'ready')
    await second.window.locator('[data-testid="conversation-select"]').first().click()

    // The user's message survived — it was always persisted before the request.
    await expect(second.window.locator('[data-testid="user-message"]')).toContainText(
      'Say something reasonably long back to me.',
    )

    // And so did the partial reply, marked the way Stop marks one.
    const restored = second.window.locator(assistant).last()
    await expect(restored, 'the in-flight reply was lost on quit').toBeVisible()
    await expect(restored.locator('[data-testid="assistant-content"]')).not.toHaveText('')
    await expect(restored).toHaveAttribute('data-stopped', 'true')
  } finally {
    await second.close()
    await mock.server.close()
  }
})

test('quitting with nothing in flight is not delayed', async () => {
  test.setTimeout(120_000)
  const mock = await startMock()
  const app = await launchApp()
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'ready')
  } finally {
    const startedAt = Date.now()
    await app.close()
    // The deadline is 2 s; an idle quit must not pay it.
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    await mock.server.close()
  }
})
