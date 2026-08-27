/**
 * One poller, in the main process (SPEC §9).
 *
 * The renderer never polls. It reads `useServerStore`, fed by `models:stateChanged`
 * — which means there is exactly one timer in the app rather than one per mounted
 * component, and the cadence can adapt without every caller agreeing.
 *
 * Cadence — fast to detect, slow to nag:
 *   - 30 s when settled (`ready` / `idle` / `error`)
 *   - 2 s while an activation is in flight (`loading` / `stopping`)
 *   - after the 1st failure retry in 5 s, after the 2nd in 15 s
 *   - three consecutive failures → `unreachable`, then 60 s until it recovers
 *   - immediately on window focus and immediately after an activation request
 *
 * The escalation exists because a flat 30 s took up to 90 s to surface a dead
 * control plane, outside A6's 60 s. Confirming quickly and *then* going quiet
 * gives ~50 s worst case without spending the afternoon retrying a server that
 * really is down.
 */

import {
  POLL_FAILURES_BEFORE_UNREACHABLE,
  POLL_INTERVAL_ACTIVE_MS,
  POLL_INTERVAL_IDLE_MS,
  POLL_INTERVAL_UNREACHABLE_MS,
  POLL_RETRY_BACKOFF_MS,
} from '@shared/constants'
import type { ServerState } from '@shared/types'

import type { Logger } from '../lib/logger'
import type { HarnessClient } from './harnessClient'

export const UNREACHABLE: ServerState = {
  reachable: false,
  state: 'unreachable',
  activeModelId: null,
  progressHint: null,
  lastError: null,
  gpu: [],
}

export interface ServerPollerOptions {
  client: HarnessClient
  logger: Logger
  /** Called on every *change*, not every tick — the renderer re-renders on this. */
  onChange: (state: ServerState) => void
}

export class ServerPoller {
  private timer: NodeJS.Timeout | null = null
  private current: ServerState = UNREACHABLE
  private consecutiveFailures = 0
  private running = false
  /** Guards against a focus event landing on top of an in-flight poll. */
  private polling = false

  constructor(private readonly options: ServerPollerOptions) {}

  get state(): ServerState {
    return this.current
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.poll()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Poll now — window focus, or just after an activation was accepted. */
  refresh(): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    void this.poll()
  }

  private async poll(): Promise<void> {
    if (!this.running || this.polling) return
    this.polling = true

    try {
      const result = await this.options.client.getState()

      if (result.ok) {
        this.consecutiveFailures = 0
        this.publish(result.value)
      } else {
        this.consecutiveFailures += 1
        if (this.consecutiveFailures >= POLL_FAILURES_BEFORE_UNREACHABLE) {
          // Only now: a single blip during a model load should not make the whole
          // UI say "unreachable" and disable the composer.
          this.publish({ ...UNREACHABLE, lastError: result.error.message })
        }
      }
    } finally {
      this.polling = false
      this.schedule()
    }
  }

  private schedule(): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.poll(), this.interval())
    // Never hold the process open just to poll.
    this.timer.unref?.()
  }

  private interval(): number {
    // Given up: quiet, but never silent.
    if (this.consecutiveFailures >= POLL_FAILURES_BEFORE_UNREACHABLE) {
      return POLL_INTERVAL_UNREACHABLE_MS
    }

    // Failing but not yet given up: confirm quickly rather than waiting out a
    // full settled interval per attempt.
    if (this.consecutiveFailures > 0) {
      const step = POLL_RETRY_BACKOFF_MS[this.consecutiveFailures - 1]
      if (step !== undefined) return step
    }

    return this.current.state === 'loading' || this.current.state === 'stopping'
      ? POLL_INTERVAL_ACTIVE_MS
      : POLL_INTERVAL_IDLE_MS
  }

  /** The interval that would be used next. Exposed so a test can assert the sequence. */
  get nextIntervalMs(): number {
    return this.interval()
  }

  /** Force the reported state. Tests only — the poller otherwise owns this. */
  setStateForTest(state: ServerState): void {
    this.current = state
  }

  private publish(next: ServerState): void {
    if (sameState(this.current, next)) return
    this.options.logger.info('server state changed', {
      from: this.current.state,
      to: next.state,
      activeModelId: next.activeModelId,
    })
    this.current = next
    this.options.onChange(next)
  }
}

/**
 * Whether two states are the same for the renderer's purposes.
 *
 * `progressHint` counts: it is the only thing that moves during a long load, and
 * suppressing it would freeze the load banner.
 */
function sameState(a: ServerState, b: ServerState): boolean {
  return (
    a.state === b.state &&
    a.activeModelId === b.activeModelId &&
    a.progressHint === b.progressHint &&
    a.lastError === b.lastError &&
    a.reachable === b.reachable &&
    sameGpus(a.gpu, b.gpu)
  )
}

/**
 * GPU readouts compared by value, not by count.
 *
 * Comparing only `length` meant a change in memory or utilisation never reached
 * the renderer — invisible on Ollama, which always reports `[]`, and a readout
 * frozen at its first sample the moment this runs against vLLM.
 */
function sameGpus(a: ServerState['gpu'], b: ServerState['gpu']): boolean {
  if (a.length !== b.length) return false
  return a.every((gpu, index) => {
    const other = b[index]
    return (
      other !== undefined &&
      gpu.index === other.index &&
      gpu.name === other.name &&
      gpu.memoryUsedMb === other.memoryUsedMb &&
      gpu.memoryTotalMb === other.memoryTotalMb &&
      gpu.utilizationPct === other.utilizationPct
    )
  })
}
