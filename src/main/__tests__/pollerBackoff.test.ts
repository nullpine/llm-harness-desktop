/**
 * The poller's escalating backoff (SPEC §9).
 *
 * A flat 30 s meant a dead control plane took up to 90 s to surface — three
 * consecutive failures, a full settled interval apart — which is outside A6's
 * 60 s. Shortening the interval outright would have traded away the quiet period
 * the 30 s exists to provide, so it escalates instead: confirm quickly, then go
 * quiet once there is nothing left to confirm.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  POLL_INTERVAL_ACTIVE_MS,
  POLL_INTERVAL_IDLE_MS,
  POLL_INTERVAL_UNREACHABLE_MS,
  POLL_RETRY_BACKOFF_MS,
} from '@shared/constants'
import { appError } from '@shared/errors'
import type { ServerState } from '@shared/types'

import { ServerPoller } from '../services/serverPoller'

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as ConstructorParameters<typeof ServerPoller>[0]['logger']

const ready: ServerState = {
  reachable: true,
  state: 'ready',
  activeModelId: 'glm-4.7-flash',
  progressHint: null,
  lastError: null,
  gpu: [],
}

/** A poller whose client succeeds or fails on demand, without any timers running. */
function makePoller(behaviour: { failing: boolean }) {
  const client = {
    getState: async () =>
      behaviour.failing
        ? { ok: false as const, error: appError('network_error', 'no route to host') }
        : { ok: true as const, value: ready },
  }
  const poller = new ServerPoller({
    client: client as never,
    logger,
    onChange: () => {},
  })
  return poller
}

/** Drive one poll at a time, so the sequence can be read off deterministically. */
async function pollOnce(poller: ServerPoller): Promise<void> {
  poller.start()
  poller.refresh()
  // Let the in-flight poll resolve.
  await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('the interval sequence', () => {
  it('escalates 5 s, 15 s, then 60 s across consecutive failures', async () => {
    const behaviour = { failing: true }
    const poller = makePoller(behaviour)
    const sequence: number[] = []

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await pollOnce(poller)
        sequence.push(poller.nextIntervalMs)
      }
    } finally {
      poller.stop()
    }

    expect(sequence).toEqual([
      POLL_RETRY_BACKOFF_MS[0],
      POLL_RETRY_BACKOFF_MS[1],
      POLL_INTERVAL_UNREACHABLE_MS,
    ])
  })

  it('confirms a dead server inside A6 s 60 s', async () => {
    // 30 s to notice (worst case, the settled interval) + 5 s + 15 s = 50 s.
    const worstCase = POLL_INTERVAL_IDLE_MS + POLL_RETRY_BACKOFF_MS[0] + POLL_RETRY_BACKOFF_MS[1]
    expect(worstCase).toBeLessThan(60_000)
  })

  it('polls a settled server at the unchanged 30 s', async () => {
    const poller = makePoller({ failing: false })
    try {
      await pollOnce(poller)
      expect(poller.nextIntervalMs).toBe(POLL_INTERVAL_IDLE_MS)
    } finally {
      poller.stop()
    }
  })

  it('stays quiet at 60 s once unreachable, rather than nagging', async () => {
    // A laptop that closed its lid on a dead server should not spend the
    // afternoon retrying every five seconds.
    const behaviour = { failing: true }
    const poller = makePoller(behaviour)
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) await pollOnce(poller)
      expect(poller.state.state).toBe('unreachable')
      expect(poller.nextIntervalMs).toBe(POLL_INTERVAL_UNREACHABLE_MS)
    } finally {
      poller.stop()
    }
  })

  it('returns to the settled interval as soon as a poll succeeds', async () => {
    const behaviour = { failing: true }
    const poller = makePoller(behaviour)
    try {
      await pollOnce(poller)
      await pollOnce(poller)
      expect(poller.nextIntervalMs).toBe(POLL_RETRY_BACKOFF_MS[1])

      behaviour.failing = false
      await pollOnce(poller)

      expect(poller.state.state).toBe('ready')
      expect(poller.nextIntervalMs).toBe(POLL_INTERVAL_IDLE_MS)
    } finally {
      poller.stop()
    }
  })
})

describe('what the escalation must not disturb', () => {
  it('leaves the 2 s activation cadence alone', async () => {
    const poller = makePoller({ failing: false })
    try {
      await pollOnce(poller)
      // A switch is under way: the fast cadence is about progress, not failure.
      poller.setStateForTest({ ...ready, state: 'loading' })
      expect(poller.nextIntervalMs).toBe(POLL_INTERVAL_ACTIVE_MS)
    } finally {
      poller.stop()
    }
  })

  it('does not treat a single blip as unreachable', async () => {
    // From a *known good* state — a fresh poller starts unreachable, so failing
    // one poll on a new one would prove nothing.
    const behaviour = { failing: false }
    const poller = makePoller(behaviour)
    try {
      await pollOnce(poller)
      expect(poller.state.state).toBe('ready')

      behaviour.failing = true
      await pollOnce(poller)

      // The cadence escalates, but what the UI says must not change on one blip.
      expect(poller.state.state).toBe('ready')
      expect(poller.nextIntervalMs).toBe(POLL_RETRY_BACKOFF_MS[0])
    } finally {
      poller.stop()
    }
  })
})
