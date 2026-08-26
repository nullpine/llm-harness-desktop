/**
 * Settings, mirrored from the main process.
 *
 * The store never holds an API key — `Settings` has no field for one. `hasApiKey`
 * is the whole of what the renderer knows (`.claude/rules/network-boundary.md`).
 */

import { create } from 'zustand'

import { DEFAULT_SETTINGS } from '@shared/constants'
import type { AppError } from '@shared/errors'
import type { Settings } from '@shared/types'

/**
 * `ok` means the key is usable now. `persisted` says whether it will survive a
 * restart — false on a machine with no secure credential store, which is a
 * warning rather than a reason to block the user.
 */
export interface SetApiKeyOutcome {
  ok: boolean
  persisted: boolean
  message?: string | undefined
}

interface SettingsState {
  settings: Settings
  loaded: boolean
  saving: boolean
  error: AppError | null
  load: () => Promise<void>
  save: (patch: Partial<Settings>) => Promise<boolean>
  setApiKey: (key: string) => Promise<SetApiKeyOutcome>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  saving: false,
  error: null,

  load: async () => {
    const result = await window.api.settings.get()
    if (result.ok) {
      set({ settings: result.value, loaded: true, error: null })
    } else {
      set({ loaded: true, error: result.error })
    }
  },

  save: async (patch) => {
    set({ saving: true, error: null })
    const result = await window.api.settings.set(patch)
    if (result.ok) {
      set({ settings: result.value, saving: false })
      return true
    }
    set({ saving: false, error: result.error })
    return false
  },

  setApiKey: async (key) => {
    const result = await window.api.settings.setApiKey(key)
    if (result.ok) {
      // hasApiKey is derived in main, so re-read rather than assume.
      const refreshed = await window.api.settings.get()
      if (refreshed.ok) set({ settings: refreshed.value })
      return result.value.persisted
        ? { ok: true, persisted: true }
        : { ok: true, persisted: false, message: result.value.warning }
    }
    set({ error: result.error })
    return { ok: false, persisted: false, message: result.error.message }
  },
}))
