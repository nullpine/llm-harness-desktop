/**
 * Two contract-valid states the local backend can never produce.
 *
 * Ollama on a Mac reports `gpu: []` always (`docs/BACKENDS.md` §2.1 — no
 * `nvidia-smi`, unified memory not worth modelling), and its `/admin/logs` ring
 * buffer is empty because nothing feeds it on that path. A vLLM deployment
 * produces both on the first poll.
 *
 * So these are exercised against mock fixtures rather than discovered during an
 * Azure migration, which is the one moment nobody wants to be debugging layout.
 */

import { configure, expect, launchApp, test, waitForState } from './fixtures/app'
import { GPU_FIXTURE, startMock } from './fixtures/mockServer'

// --- a populated gpu array ----------------------------------------------------

test('gpu: a populated array renders name, memory and utilisation', async () => {
  const mock = await startMock({ gpu: GPU_FIXTURE })
  const app = await launchApp()
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'ready')

    const indicator = app.window.locator('[data-testid="gpu-indicator"]')
    await expect(indicator).toBeVisible()

    // Megabytes on the wire, gigabytes on screen: nobody reads "41210 MB".
    await expect(app.window.locator('[data-testid="gpu-0-memory"]')).toHaveText('40.2 GB/93.6 GB')
    await expect(app.window.locator('[data-testid="gpu-0-util"]')).toHaveText('73%')

    // Both cards, not just the first — a single-GPU fixture would not catch a
    // layout that assumes exactly one.
    await expect(app.window.locator('[data-testid="gpu-1-memory"]')).toHaveText('0.0 GB/93.6 GB')
    await expect(app.window.locator('[data-testid="gpu-1-util"]')).toHaveText('0%')

    // The card's full name is available without cluttering the header.
    await expect(app.window.locator('[data-testid="gpu-0"]')).toHaveAttribute(
      'title',
      /NVIDIA H100 NVL/,
    )
  } finally {
    await app.close()
    await mock.server.close()
  }
})

test('gpu: an empty array renders nothing at all', async ({ configuredApp }) => {
  // The Ollama path. Not an empty shell, not a separator, not a gap — nothing.
  await expect(configuredApp.window.locator('[data-testid="gpu-indicator"]')).toHaveCount(0)
})

test('gpu: appearing and disappearing does not disturb the header', async () => {
  // Two mid-session changes, each waiting on the 30 s settled poll (SPEC §9).
  test.setTimeout(240_000)
  const mock = await startMock()
  const app = await launchApp()
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'ready')

    const dropdown = app.window.locator('[data-testid="model-dropdown"]')
    const before = await dropdown.boundingBox()
    expect(before).not.toBeNull()

    // The server starts reporting accelerators — a control plane that just
    // migrated from Ollama to vLLM, or one whose nvidia-smi came back.
    mock.server.setGpu(GPU_FIXTURE)
    await expect(app.window.locator('[data-testid="gpu-indicator"]')).toBeVisible({
      timeout: 60_000,
    })

    const during = await dropdown.boundingBox()
    expect(during?.y, 'the header shifted vertically when GPUs appeared').toBe(before?.y)
    expect(during?.height).toBe(before?.height)

    // ...and stops again.
    mock.server.setGpu([])
    await expect(app.window.locator('[data-testid="gpu-indicator"]')).toHaveCount(0, {
      timeout: 60_000,
    })

    const after = await dropdown.boundingBox()
    expect(after?.y).toBe(before?.y)
    expect(after?.x, 'the header shifted horizontally when GPUs went away').toBe(before?.x)
  } finally {
    await app.close()
    await mock.server.close()
  }
})

test('gpu: a changing readout reaches the UI, rather than freezing at the first sample', async () => {
  test.setTimeout(180_000)
  // The poller used to compare `gpu.length` only, so memory and utilisation
  // changes never published. Invisible on Ollama, where the array is always
  // empty; a frozen readout the moment it runs against vLLM.
  const mock = await startMock({ gpu: GPU_FIXTURE })
  const app = await launchApp()
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'ready')
    await expect(app.window.locator('[data-testid="gpu-0-util"]')).toHaveText('73%')

    // Same number of cards, different numbers on them.
    mock.server.setGpu([
      { ...GPU_FIXTURE[0]!, memory_used_mb: 90_000, utilization_pct: 99 },
      GPU_FIXTURE[1]!,
    ])

    await expect(app.window.locator('[data-testid="gpu-0-util"]')).toHaveText('99%', {
      timeout: 60_000,
    })
    await expect(app.window.locator('[data-testid="gpu-0-memory"]')).toHaveText('87.9 GB/93.6 GB')
  } finally {
    await app.close()
    await mock.server.close()
  }
})

// --- a long log tail ----------------------------------------------------------

test('logs: a long tail renders, scrolls, and keeps the newest lines reachable', async () => {
  // The real ring buffer holds 2000 lines and the contract caps a request at
  // 1000. Locally the buffer is empty, so the modal has only ever been seen
  // rendering "no log lines".
  const mock = await startMock({ logLines: 400, activationFails: true })
  const app = await launchApp()
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'ready')

    // Reach the modal the way a user does: a failed switch.
    await app.window.locator('[data-testid="model-dropdown"]').click()
    await app.window.locator('[data-testid="model-option-qwen3.8-27b"]').click()
    await app.window.locator('[data-testid="confirm-switch"]').click()
    await expect(app.window.locator('[data-testid="load-banner"]')).toHaveAttribute(
      'data-failed',
      'true',
    )
    await app.window.locator('[data-testid="view-server-logs"]').click()

    const logs = app.window.locator('[data-testid="server-logs"]')
    await expect(logs).toBeVisible()

    // Everything the server sent is present, not a truncated sample.
    const text = await logs.innerText()
    expect(text.split('\n').length).toBeGreaterThan(150)
    expect(text).toContain('line 1 —')

    // It scrolls rather than growing the dialog off-screen.
    const box = await logs.boundingBox()
    const metrics = await logs.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }))
    expect(metrics.scrollHeight, 'the log pane is not scrollable').toBeGreaterThan(
      metrics.clientHeight,
    )
    expect(box!.height).toBeLessThan(600)

    // And the far end is reachable.
    await logs.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
    const scrolled = await logs.evaluate((element) => element.scrollTop)
    expect(scrolled).toBeGreaterThan(0)
  } finally {
    await app.close()
    await mock.server.close()
  }
})

test('logs: an empty buffer says so instead of rendering a blank box', async () => {
  // The Ollama path today: the server's ring buffer is fed only by the vLLM
  // stdout pump, so /admin/logs comes back empty. Tracked in the backlog as a
  // server-side gap; the client must still be honest about it.
  const mock = await startMock({ logLines: 0, activationFails: true })
  const app = await launchApp()
  try {
    await configure(app.window, mock.url, mock.apiKey)
    await waitForState(app.window, 'ready')

    await app.window.locator('[data-testid="model-dropdown"]').click()
    await app.window.locator('[data-testid="model-option-qwen3.8-27b"]').click()
    await app.window.locator('[data-testid="confirm-switch"]').click()
    await expect(app.window.locator('[data-testid="load-banner"]')).toHaveAttribute(
      'data-failed',
      'true',
    )
    await app.window.locator('[data-testid="view-server-logs"]').click()

    await expect(app.window.locator('[data-testid="server-logs"]')).toContainText('no log lines')
  } finally {
    await app.close()
    await mock.server.close()
  }
})
