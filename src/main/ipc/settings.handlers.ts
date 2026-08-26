/** `settings:*` — the renderer's only view of configuration. */

import { appError } from '@shared/errors'
import { IPC, type SetApiKeyResult } from '@shared/ipc'
import type { Settings } from '@shared/types'

import type { Logger } from '../lib/logger'
import type { SecretStore } from '../services/secretStore'
import type { SettingsStore } from '../services/settingsStore'
import { failWith, handle } from './index'

export interface SettingsHandlerDeps {
  settings: SettingsStore
  secrets: SecretStore
  logger: Logger
  /** Called after a change so the poller picks up a new URL immediately. */
  onSettingsChanged?: () => void
}

export function registerSettingsHandlers(deps: SettingsHandlerDeps): void {
  const { settings, secrets, logger } = deps

  handle<void, Settings>(IPC.settingsGet, logger, async () =>
    settings.get(await secrets.hasApiKey(), secrets.encryptionAvailable),
  )

  handle<Partial<Settings>, Settings>(IPC.settingsSet, logger, async (patch) => {
    // `hasApiKey` is derived from the secret store, never set by the renderer.
    const { hasApiKey: _ignored, ...safe } = patch
    const next = await settings.set(safe, await secrets.hasApiKey(), secrets.encryptionAvailable)
    deps.onSettingsChanged?.()
    return next
  })

  handle<{ key: string }, SetApiKeyResult>(IPC.settingsSetApiKey, logger, async ({ key }) => {
    const result = await secrets.setApiKey(key)

    if (!result.ok && result.reason === 'write_failed') {
      // The disk refused it. Nothing works, so this is a real failure.
      throw failWith(appError(result.reason, result.message))
    }

    // Every subsequent log line scrubs it, including ones written by other modules.
    logger.redactor.add(key)
    deps.onSettingsChanged?.()

    if (!result.ok) {
      // No keyring on this machine. The key is held in memory and the app works
      // until quit, so the user is told — and let through. Blocking here left
      // them unable to leave Settings on a perfectly usable system.
      return { ok: true, persisted: false, warning: result.message }
    }
    return { ok: true, persisted: true }
  })
}
