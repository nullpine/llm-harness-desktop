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

interface SettingsState {
  settings: Settings
  loaded: boolean
  saving: boolean
  error: AppError | null
  load: () => Promise<void>
  save: (patch: Partial<Settings>) => Promise<boolean>
  setApiKey: (key: string) => Promise<{ ok: boolean; message?: string }>
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
      return { ok: true }
    }
    set({ error: result.error })
    return { ok: false, message: result.error.message }
  },
}))
