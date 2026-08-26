/**
 * `server:test` and the poller.
 *
 * A successful authenticated test is proof of reachability, and the poller is
 * told so. Before that the header could read `unreachable` for up to 60 s while
 * the modal said "✓ Connected" — and the disagreement was the confusing part.
 *
 * This is a unit test rather than an e2e one on purpose. On the real UI path
 * `runTest` persists the draft server URL first, and `settings:set` refreshes
 * the poller as a side effect — so an end-to-end assertion passes whether or not
 * `server:test` does its own refresh, and would prove nothing about this wiring.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IPC, type Result, type ServerTestResult } from '@shared/ipc'
import { appError } from '@shared/errors'

type Handler = (event: unknown, request: unknown) => Promise<Result<unknown>>

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  },
}))

const { registerModelHandlers } = await import('../ipc/models.handlers')

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<typeof registerModelHandlers>[0]['logger']

const health = {
  status: 'ok',
  version: '1.1',
  serviceVersion: '0.1.0',
  uptimeS: 5,
  latencyMs: 3,
}

const serverState = {
  reachable: true,
  state: 'ready' as const,
  activeModelId: 'glm-4.7-flash',
  progressHint: null,
  lastError: null,
  gpu: [],
}

function register(client: Record<string, unknown>, refreshState: () => void) {
  handlers.clear()
  registerModelHandlers({
    client: client as unknown as Parameters<typeof registerModelHandlers>[0]['client'],
    logger,
    refreshState,
  })
}

async function runServerTest(): Promise<ServerTestResult> {
  const handler = handlers.get(IPC.serverTest)
  if (!handler) throw new Error('server:test was not registered')
  const result = (await handler({}, undefined)) as Result<ServerTestResult>
  if (!result.ok) throw new Error(`server:test returned an error: ${result.error.code}`)
  return result.value
}

let refreshState: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  refreshState = vi.fn<() => void>()
})

describe('a successful test', () => {
  it('refreshes the poller, so the header cannot disagree with the result', async () => {
    register(
      {
        getHealth: async () => ({ ok: true, value: health }),
        getState: async () => ({ ok: true, value: serverState }),
      },
      refreshState,
    )

    const result = await runServerTest()

    expect(result.ok).toBe(true)
    expect(refreshState, 'a successful test did not refresh the poller').toHaveBeenCalledOnce()
  })

  it('reports the contract version and the build separately', async () => {
    register(
      {
        getHealth: async () => ({ ok: true, value: health }),
        getState: async () => ({ ok: true, value: serverState }),
      },
      refreshState,
    )

    const result = await runServerTest()
    expect(result.version).toBe('1.1')
    expect(result.serviceVersion).toBe('0.1.0')
  })
})

describe('an unsuccessful test', () => {
  it('does not refresh the poller when the server is unreachable', async () => {
    register(
      {
        getHealth: async () => ({ ok: false, error: appError('network_error', 'no route') }),
        getState: async () => ({ ok: true, value: serverState }),
      },
      refreshState,
    )

    const result = await runServerTest()

    expect(result.ok).toBe(false)
    expect(refreshState).not.toHaveBeenCalled()
  })

  it('does not refresh the poller when the key is rejected', async () => {
    // /healthz is unauthenticated, so health passes and the authenticated call
    // is what catches this. Reachable, but not usable — the poller learns nothing.
    register(
      {
        getHealth: async () => ({ ok: true, value: health }),
        getState: async () => ({ ok: false, error: appError('unauthorized', 'invalid API key') }),
      },
      refreshState,
    )

    const result = await runServerTest()

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/key was rejected/i)
    expect(refreshState).not.toHaveBeenCalled()
  })

  it('never reports success on health alone', async () => {
    // The bug this guards: /healthz needs no key, so testing only that told the
    // user "✓ Connected" with a wrong key — the one case they are diagnosing.
    register(
      {
        getHealth: async () => ({ ok: true, value: health }),
        getState: async () => ({ ok: false, error: appError('unauthorized', 'invalid API key') }),
      },
      refreshState,
    )

    expect((await runServerTest()).ok).toBe(false)
  })

  it('surfaces friendly copy, never a raw code', async () => {
    for (const code of ['unauthorized', 'network_error', 'upstream_unavailable', 'timeout']) {
      register(
        {
          getHealth: async () => ({ ok: false, error: appError(code, 'raw server text') }),
          getState: async () => ({ ok: true, value: serverState }),
        },
        refreshState,
      )
      const result = await runServerTest()
      expect(result.error).not.toContain(code)
      expect(result.error).not.toBe('raw server text')
    }
  })
})
