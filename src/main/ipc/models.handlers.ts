/** `models:*` and `server:test` — everything that talks to the harness server. */

import { IPC, type ActivateResult, type ServerTestResult } from '@shared/ipc'
import { serverTestError as errorCopy } from '@shared/testConnectionCopy'
import type { ModelCatalog, ServerState } from '@shared/types'

import type { Logger } from '../lib/logger'
import type { HarnessClient } from '../services/harnessClient'
import { failWith, handle } from './index'

export interface ModelHandlerDeps {
  client: HarnessClient
  logger: Logger
  /** Poll now rather than on the next tick — an activation just happened. */
  refreshState?: () => void
}

export function registerModelHandlers(deps: ModelHandlerDeps): void {
  const { client, logger } = deps

  /**
   * `server:test` never rejects. The Settings modal renders whatever comes back,
   * and "could not connect" is a normal answer for a button whose whole purpose
   * is finding out whether you can connect.
   *
   * **Two calls, not one.** `/healthz` is unauthenticated by design (contract
   * §3), so testing only that reports "✓ Connected" for a wrong API key — which
   * is exactly the case the user is trying to diagnose. The authenticated call
   * after it is what makes the answer mean anything.
   */
  handle<void, ServerTestResult>(IPC.serverTest, logger, async () => {
    const health = await client.getHealth()
    if (!health.ok) {
      return { ok: false, error: errorCopy(health.error) }
    }

    const authenticated = await client.getState()
    if (!authenticated.ok) {
      return { ok: false, error: errorCopy(authenticated.error) }
    }

    return {
      ok: true,
      version: health.value.version,
      serviceVersion: health.value.serviceVersion,
      latencyMs: health.value.latencyMs,
    }
  })

  handle<void, ModelCatalog>(IPC.modelsList, logger, async () => {
    const result = await client.getModels()
    if (!result.ok) throw failWith(result.error)
    return result.value
  })

  handle<void, ServerState>(IPC.modelsState, logger, async () => {
    const result = await client.getState()
    if (!result.ok) throw failWith(result.error)
    return result.value
  })

  handle<{ modelId: string }, ActivateResult>(IPC.modelsActivate, logger, async ({ modelId }) => {
    const result = await client.activateModel(modelId)
    if (!result.ok) throw failWith(result.error)
    // The 202 says nothing about progress; the poller reports the rest.
    deps.refreshState?.()
    return result.value
  })
}
