/**
 * `harnessClient` against the real mock server — the same one `npm run dev:mock`
 * runs, not a hand-rolled stub.
 *
 * One fake, used by both. A stub written to match the client's expectations can
 * only ever confirm that the client agrees with itself; the mock is an
 * independent reading of `docs/API-CONTRACT.md`, so a disagreement between them
 * is a real finding.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createMockServer } from '../../../scripts/dev-mock-server.mjs'
import { HarnessClient } from '../services/harnessClient'
import { readSseStream, type SseEvent } from '../services/sseStream'

let mock: ReturnType<typeof createMockServer>
let baseUrl: string

const clientFor = (overrides: { serverUrl?: string; apiKey?: string } = {}) =>
  new HarnessClient(
    () => ({ serverUrl: overrides.serverUrl ?? baseUrl, apiKey: overrides.apiKey ?? mock.apiKey }),
    '0.0.0-test',
  )

beforeAll(async () => {
  // Short load so the state machine can be driven without waiting 8 real seconds.
  mock = createMockServer({ loadMs: 40, tokenDelayMs: 1 })
  baseUrl = await mock.listen()
})

afterAll(async () => {
  await mock.close()
})

async function activateAndWait(modelId: string): Promise<void> {
  const client = clientFor()
  await client.activateModel(modelId)
  for (let i = 0; i < 100; i += 1) {
    const state = await client.getState()
    if (state.ok && state.value.state === 'ready') return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`${modelId} never became ready`)
}

// --- health -----------------------------------------------------------------

describe('getHealth', () => {
  it('reads both versions and works without a key', async () => {
    // /healthz is unauthenticated, so an unconfigured app can still test a URL.
    const result = await clientFor({ apiKey: '' }).getHealth()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('ok')
    expect(result.value.version).toBe('1.1')
    expect(result.value.serviceVersion).toBe('0.0.0-mock')
    expect(result.value.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('keeps the two versions distinct', async () => {
    const result = await clientFor().getHealth()
    if (!result.ok) throw new Error('expected ok')
    // The v1 bug this split fixed: one field doing two jobs.
    expect(result.value.version).not.toBe(result.value.serviceVersion)
  })

  it('reports an unreachable server as network_error, not an exception', async () => {
    const result = await clientFor({ serverUrl: 'http://127.0.0.1:1' }).getHealth()
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'network_error' }) })
  })

  it('reports an unconfigured URL rather than guessing one', async () => {
    const result = await clientFor({ serverUrl: '' }).getHealth()
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'not_configured' }),
    })
  })
})

// --- auth -------------------------------------------------------------------

describe('auth', () => {
  it('maps a rejected key to unauthorized', async () => {
    const result = await clientFor({ apiKey: 'wrong-key' }).getState()
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'unauthorized', retryable: false }),
    })
  })

  it('refuses to call an authenticated route with no key', async () => {
    const result = await clientFor({ apiKey: '' }).getModels()
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'not_configured' }),
    })
  })

  it('never puts the key in an error', async () => {
    const key = 'super-secret-key-value'
    const result = await clientFor({ apiKey: key }).getState()
    expect(JSON.stringify(result)).not.toContain(key)
  })

  it('sends the key as a bearer token and identifies the client', async () => {
    const seen: Record<string, string> = {}
    const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      Object.assign(seen, init?.headers as Record<string, string>)
      return globalThis.fetch(url as string, init)
    })
    const client = new HarnessClient(
      () => ({ serverUrl: baseUrl, apiKey: mock.apiKey }),
      '1.2.3',
      spy as unknown as typeof fetch,
    )
    await client.getState()

    expect(seen.Authorization).toBe(`Bearer ${mock.apiKey}`)
    expect(seen['X-Harness-Client']).toBe('llm-harness-desktop/1.2.3')
  })
})

// --- catalog ----------------------------------------------------------------

describe('getModels', () => {
  it('reads the v1.1 field names', async () => {
    const result = await clientFor().getModels()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const glm = result.value.models.find((m) => m.id === 'glm-4.7-flash')
    expect(glm).toBeDefined()
    expect(glm?.modelRef).toBe('glm-4.7-flash:q4_K_M')
    expect(glm?.available).toBe(true)
    expect(glm?.displayName).toBe('GLM 4.7 Flash')
    expect(glm?.contextLength).toBe(32768)
  })

  it('does not read the retired v1 `downloaded` field', async () => {
    // A server still sending `downloaded` is a version mismatch to surface, not
    // something to quietly accept — so `available` must come out false.
    const stub = vi.fn(async () =>
      Response.json({
        active_model_id: null,
        state: 'idle',
        models: [{ id: 'old', display_name: 'Old', downloaded: true }],
      }),
    )
    const client = new HarnessClient(
      () => ({ serverUrl: baseUrl, apiKey: 'k' }),
      '0.0.0',
      stub as unknown as typeof fetch,
    )
    const result = await client.getModels()
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.models[0]?.available).toBe(false)
  })
})

// --- state and activation ---------------------------------------------------

describe('state and activation', () => {
  it('reports gpu as an empty array without choking', async () => {
    const result = await clientFor().getState()
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.gpu).toEqual([])
    expect(result.value.reachable).toBe(true)
  })

  it('activates a model and reaches ready', async () => {
    const client = clientFor()
    const result = await client.activateModel('glm-4.7-flash')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.jobId).toMatch(/^act_/)
    expect(result.value.estimatedSeconds).toBe(25)

    await activateAndWait('glm-4.7-flash')
    const state = await client.getState()
    if (!state.ok) throw new Error('expected ok')
    expect(state.value.state).toBe('ready')
    expect(state.value.activeModelId).toBe('glm-4.7-flash')
  })

  it('reports already_active rather than reloading', async () => {
    await activateAndWait('glm-4.7-flash')
    const result = await clientFor().activateModel('glm-4.7-flash')
    if (!result.ok) throw new Error('expected ok')
    expect(result.value).toEqual({ jobId: null, alreadyActive: true })
  })

  it('maps an unknown model id to not_found', async () => {
    const result = await clientFor().activateModel('no-such-model')
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'not_found' }) })
  })
})

// --- the state guards -------------------------------------------------------

describe('chat state guards', () => {
  const body = (model: string) => ({
    model,
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  })

  it('maps a mid-load request to model_loading with the retry hint', async () => {
    mock.setState({ state: 'loading', activeModelId: 'glm-4.7-flash' })
    const result = await clientFor().chatCompletions(
      body('glm-4.7-flash'),
      new AbortController().signal,
    )
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'model_loading', retryable: true }),
    })
    if (!result.ok) {
      expect(result.error.details?.retryAfterSeconds).toBeGreaterThan(0)
    }
  })

  it('maps no active model to model_not_active', async () => {
    mock.setState({ state: 'idle', activeModelId: null })
    const result = await clientFor().chatCompletions(
      body('glm-4.7-flash'),
      new AbortController().signal,
    )
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'model_not_active' }),
    })
  })

  it('maps a stale model id to model_not_active carrying both ids', async () => {
    await activateAndWait('glm-4.7-flash')
    const result = await clientFor().chatCompletions(
      body('qwen3.8-27b'),
      new AbortController().signal,
    )
    if (result.ok) throw new Error('expected a 409')
    expect(result.error.code).toBe('model_not_active')
    expect(result.error.details).toMatchObject({
      active: 'glm-4.7-flash',
      requested: 'qwen3.8-27b',
    })
  })
})

// --- streaming --------------------------------------------------------------

describe('chatCompletions', () => {
  async function collect(modelId: string): Promise<SseEvent[]> {
    await activateAndWait(modelId)
    const result = await clientFor().chatCompletions(
      { model: modelId, stream: true, messages: [{ role: 'user', content: 'hello' }] },
      new AbortController().signal,
    )
    if (!result.ok) throw new Error(`expected a stream, got ${result.error.code}`)

    const events: SseEvent[] = []
    for await (const event of readSseStream(result.value.body)) events.push(event)
    return events
  }

  const textOf = (events: SseEvent[], kind: 'content' | 'reasoning') =>
    events
      .filter(
        (e): e is Extract<SseEvent, { type: 'delta' }> => e.type === 'delta' && e.kind === kind,
      )
      .map((e) => e.text)
      .join('')

  it('streams content and finishes', async () => {
    const events = await collect('glm-4.7-flash')
    expect(textOf(events, 'content')).toContain('mock response')
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' })
  })

  it('surfaces delta.reasoning from the Ollama-flavoured model', async () => {
    expect(textOf(await collect('glm-4.7-flash'), 'reasoning')).toBe('Let me think. ')
  })

  it('surfaces delta.reasoning_content from the vLLM-flavoured model', async () => {
    expect(textOf(await collect('qwen3.8-27b'), 'reasoning')).toBe('Let me think. ')
  })

  it('reports usage on done', async () => {
    const done = (await collect('glm-4.7-flash')).at(-1)
    expect(done).toMatchObject({ usage: { promptTokens: 12 } })
  })

  it('aborts the request, not just the read', async () => {
    await activateAndWait('glm-4.7-flash')
    const controller = new AbortController()
    const result = await clientFor().chatCompletions(
      { model: 'glm-4.7-flash', stream: true, messages: [{ role: 'user', content: 'hello' }] },
      controller.signal,
    )
    if (!result.ok) throw new Error('expected a stream')

    const events: SseEvent[] = []
    await expect(async () => {
      for await (const event of readSseStream(result.value.body)) {
        events.push(event)
        // Abort mid-stream: the fetch must tear down, so the read then rejects
        // rather than quietly running to completion.
        controller.abort()
      }
    }).rejects.toThrow()
    expect(events.length).toBeGreaterThan(0)
  })

  it('reports an abort before the response as `aborted`', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await clientFor().chatCompletions(
      { model: 'glm-4.7-flash', stream: true, messages: [] },
      controller.signal,
    )
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'aborted' }) })
  })
})

// --- malformed responses ----------------------------------------------------

describe('robustness', () => {
  it('turns a non-JSON 200 into malformed_response', async () => {
    const stub = vi.fn(async () => new Response('<html>hello</html>', { status: 200 }))
    const client = new HarnessClient(
      () => ({ serverUrl: 'https://example.test', apiKey: 'k' }),
      '0.0.0',
      stub as unknown as typeof fetch,
    )
    expect(await client.getState()).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'malformed_response' }),
    })
  })

  it('turns a non-envelope 502 into upstream_unavailable', async () => {
    // A reverse proxy's HTML error page never sees the contract.
    const stub = vi.fn(async () => new Response('<html>502</html>', { status: 502 }))
    const client = new HarnessClient(
      () => ({ serverUrl: 'https://example.test', apiKey: 'k' }),
      '0.0.0',
      stub as unknown as typeof fetch,
    )
    expect(await client.getState()).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'upstream_unavailable', retryable: true }),
    })
  })

  it('never throws, whatever fetch does', async () => {
    const stub = vi.fn(async () => {
      throw new TypeError('socket hang up')
    })
    const client = new HarnessClient(
      () => ({ serverUrl: 'https://example.test', apiKey: 'k' }),
      '0.0.0',
      stub as unknown as typeof fetch,
    )
    await expect(client.getModels()).resolves.toMatchObject({ ok: false })
    await expect(client.getState()).resolves.toMatchObject({ ok: false })
    await expect(client.activateModel('x')).resolves.toMatchObject({ ok: false })
  })
})
