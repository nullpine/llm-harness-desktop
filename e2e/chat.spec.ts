/**
 * Chat — acceptance **A2**, **A3**, **A7**, plus the two regressions that
 * shipped through three manual checks each: the Thinking timer and truncation.
 *
 * The A2 assertion is the one most at risk of being written badly. Asserting the
 * final text alone passes even when the whole response is buffered and appears at
 * once, which is the failure this milestone's server work exists to prevent — so
 * it asserts on *intermediate* states instead.
 */

import {
  configure,
  expect,
  launchApp,
  newChat,
  openConversation,
  send,
  test,
  waitForState,
} from './fixtures/app'
import { startMock } from './fixtures/mockServer'

const assistant = '[data-testid="assistant-message"]'

test('A2: tokens appear incrementally, not all at once', async ({ configuredApp }) => {
  const { window } = configuredApp
  await newChat(window)
  await send(window, 'Say something reasonably long back to me.')

  const bubble = window.locator(assistant).last()
  await expect(bubble).toBeVisible()

  // Sample the text while it is still streaming. A buffered response yields one
  // distinct length; a streamed one yields many.
  const lengths = new Set<number>()
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const streaming = await bubble.getAttribute('data-streaming')
    lengths.add(((await bubble.innerText()) ?? '').length)
    if (streaming !== 'true' && lengths.size > 1) break
  }

  expect(
    lengths.size,
    `saw only ${lengths.size} distinct length(s) — the response arrived in one piece`,
  ).toBeGreaterThan(2)
})

test('A2: the reply completes and is persisted', async ({ configuredApp }) => {
  const { window } = configuredApp
  await newChat(window)
  await send(window, 'Hello there.')

  const bubble = window.locator(assistant).last()
  await expect(bubble).toContainText('mock response')
  await expect(bubble).toHaveAttribute('data-streaming', 'false')
})

test('A3: Stop halts the stream, keeps the partial text, and marks it stopped', async ({
  configuredApp,
}) => {
  const { window } = configuredApp
  await newChat(window)
  await send(window, 'Count slowly for me.')

  const bubble = window.locator(assistant).last()
  await expect(bubble).toBeVisible()

  // Wait for *answer* text, not just any text: the mock (like GLM) streams a
  // Thinking block first, and stopping during that would leave no partial answer
  // to assert on — which is a different scenario from the one A3 describes.
  const answer = bubble.locator('[data-testid="assistant-content"]')
  await expect(answer).not.toHaveText('')

  await window.getByRole('button', { name: 'Stop' }).click()

  await expect(bubble).toHaveAttribute('data-streaming', 'false')
  await expect(bubble).toHaveAttribute('data-stopped', 'true')

  // Compare the answer itself, not the bubble: the header gains a "stopped"
  // marker, so whole-bubble text legitimately changes after stopping.
  const afterStop = await answer.innerText()
  expect(afterStop.length, 'no partial text was kept').toBeGreaterThan(0)

  // Nothing more arrives once it has stopped.
  await expect(answer).toHaveText(afterStop)
})

test('A7: the conversation and its transcript survive a restart', async () => {
  const mock = await startMock()
  const first = await launchApp()
  let transcript = ''

  try {
    await configure(first.window, mock.url, mock.apiKey)
    await waitForState(first.window, 'ready')
    await newChat(first.window)
    await send(first.window, 'Remember this exact sentence.')
    // Wait for the stream to *finish*, not merely for text to appear. Rendered
    // text comes from chat:chunk mid-stream, whereas main persists the assistant
    // message just before chat:done — which is what flips this attribute. Closing
    // on the text alone raced the write, and that is what made this flake.
    await expect(first.window.locator(assistant).last()).toContainText('mock response')
    await expect(first.window.locator(assistant).last()).toHaveAttribute('data-streaming', 'false')
    transcript = await first.window.locator('main').innerText()
  } finally {
    await first.close()
  }

  const second = await launchApp({ userDataDir: first.userDataDir })
  try {
    await waitForState(second.window, 'ready')
    // The sidebar remembers it...
    await expect(
      second.window.locator('[data-testid="conversation-select"]', {
        hasText: /Remember this exact/,
      }),
    ).toBeVisible()
    await openConversation(second.window, /Remember this exact/)

    // ...and so does the transcript.
    await expect(second.window.locator('[data-testid="user-message"]')).toContainText(
      'Remember this exact sentence.',
    )
    await expect(second.window.locator(assistant).last()).toContainText('mock response')
    expect(transcript).toContain('Remember this exact sentence.')
  } finally {
    await second.close()
    await mock.server.close()
  }
})

test('the Thinking block populates for Ollama-style delta.reasoning', async ({ configuredApp }) => {
  // glm-4.7-flash is the mock's Ollama-flavoured model.
  const { window } = configuredApp
  await newChat(window)
  await send(window, 'Think about this.')

  const block = window.locator('[data-testid="reasoning-block"]').last()
  await expect(block).toBeVisible()
  await expect(window.locator(assistant).last()).toHaveAttribute('data-streaming', 'false')

  await expect(block.locator('[data-testid="reasoning-label"]')).toContainText('Thinking (')
  // The 0.0s bug shipped through three manual checks, because nobody expanded
  // the block to notice the number was wrong.
  const seconds = Number(await block.getAttribute('data-seconds'))
  expect(seconds, 'Thinking duration is zero').toBeGreaterThan(0)

  await block.getByRole('button').click()
  await expect(block.locator('[data-testid="reasoning-text"]')).toContainText('think')
})

test('the Thinking block populates for vLLM-style delta.reasoning_content', async () => {
  // qwen3.8-27b is the mock's vLLM-flavoured model, emitting the other spelling.
  const mock = await startMock({ activeModelId: 'qwen3.8-27b' })
  const app = await launchApp()
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'ready')
    await newChat(app.window)
    await send(app.window, 'Think about this too.')

    const block = app.window.locator('[data-testid="reasoning-block"]').last()
    await expect(block).toBeVisible()
    await expect(app.window.locator(assistant).last()).toHaveAttribute('data-streaming', 'false')
    expect(Number(await block.getAttribute('data-seconds'))).toBeGreaterThan(0)
  } finally {
    await app.close()
    await mock.server.close()
  }
})

test('truncation is explained, and the note survives a restart', async () => {
  // finish_reason "length" with no content: a reasoning model that spent its
  // whole budget thinking. The note is driven by persisted state, so a restart
  // is the real test of it.
  const mock = await startMock({ finishReason: 'length', emptyContent: true })
  const first = await launchApp()

  try {
    await configure(first.window, mock.url, mock.apiKey)
    await waitForState(first.window, 'ready')
    await newChat(first.window)
    await send(first.window, 'Answer at length.')

    await expect(first.window.locator('[data-testid="truncation-note"]')).toContainText(
      'whole token budget',
    )
  } finally {
    await first.close()
  }

  const second = await launchApp({ userDataDir: first.userDataDir })
  try {
    await waitForState(second.window, 'ready')
    await openConversation(second.window, /Answer at length/)
    await expect(second.window.locator('[data-testid="truncation-note"]')).toContainText(
      'whole token budget',
    )
  } finally {
    await second.close()
    await mock.server.close()
  }
})
