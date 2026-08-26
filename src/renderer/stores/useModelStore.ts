/**
 * The catalog, and switching between its models.
 *
 * Separate from `useServerStore`, which holds the *live* state pushed by the
 * poller. The catalog changes when the server's `models.yaml` changes — which is
 * to say almost never — so it is fetched, not polled.
 */

import { create } from 'zustand'

import type { AppError } from '@shared/errors'
import type { ModelCatalog, ModelInfo } from '@shared/types'

interface ModelStoreState {
  models: ModelInfo[]
  loaded: boolean
  error: AppError | null
  /** The model the user picked but has not yet confirmed switching to. */
  pending: ModelInfo | null
  /** When the current switch was requested, for the banner's elapsed clock. */
  switchStartedAt: number | null

  load: () => Promise<void>
  propose: (model: ModelInfo | null) => void
  confirm: () => Promise<boolean>
  finishSwitch: () => void
}

export const useModelStore = create<ModelStoreState>((set, get) => ({
  models: [],
  loaded: false,
  error: null,
  pending: null,
  switchStartedAt: null,

  load: async () => {
    const result = await window.api.models.list()
    if (result.ok) {
      const catalog: ModelCatalog = result.value
      set({ models: catalog.models, loaded: true, error: null })
    } else {
      set({ loaded: true, error: result.error })
    }
  },

  /** Open the confirmation dialog. Selecting the active model is a no-op. */
  propose: (model) => set({ pending: model }),

  confirm: async () => {
    const model = get().pending
    if (!model) return false

    const result = await window.api.models.activate(model.id)
    if (!result.ok) {
      set({ pending: null, error: result.error })
      return false
    }
    // `already_active` comes back with no job — nothing is loading, so there is
    // nothing for the banner to count.
    set({
      pending: null,
      switchStartedAt: result.value.jobId === null ? null : Date.now(),
    })
    return true
  },

  finishSwitch: () => set({ switchStartedAt: null }),
}))

/** The catalog entry for an id, if the catalog has been loaded. */
export function findModel(models: ModelInfo[], id: string | null): ModelInfo | null {
  if (!id) return null
  return models.find((model) => model.id === id) ?? null
}
