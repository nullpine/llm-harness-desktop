/**
 * One poller, in the main process (SPEC §9).
 *
 * The renderer never polls. It reads `useServerStore`, fed by `models:stateChanged`
 * — which means there is exactly one timer in the app rather than one per mounted
 * component, and the cadence can adapt without every caller agreeing.
 *
 * Cadence:
 *   - 30 s when settled (`ready` / `idle` / `error`)
 *   - 2 s while an activation is in flight (`loading` / `stopping`)
 *   - immediately on window focus and immediately after an activation request
 *   - three consecutive failures → `unreachable`, back off to 60 s, keep trying
 *
 * The back-off matters: a laptop that closed its lid on a dead server should not
 * spend the afternoon retrying every two seconds.
 */

import {
  POLL_FAILURES_BEFORE_UNREACHABLE,
  POLL_INTERVAL_ACTIVE_MS,
  POLL_INTERVAL_IDLE_MS,
  POLL_INTERVAL_UNREACHABLE_MS,
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
    if (this.consecutiveFailures >= POLL_FAILURES_BEFORE_UNREACHABLE) {
      return POLL_INTERVAL_UNREACHABLE_MS
    }
    return this.current.state === 'loading' || this.current.state === 'stopping'
      ? POLL_INTERVAL_ACTIVE_MS
      : POLL_INTERVAL_IDLE_MS
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
