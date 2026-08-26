/**
 * The conversation list and the one on screen, hydrated through `conv:*`.
 *
 * Main owns the canonical transcript, so every mutation goes through IPC and the
 * result is read back rather than assumed. `reload()` is the "main wins" path
 * from ARCHITECTURE.md — after a stream finishes, the persisted message is the
 * truth, not the accumulated buffer.
 */

import { create } from 'zustand'

import type { AppError } from '@shared/errors'
import type { Conversation, ConversationSummary } from '@shared/types'

interface ConversationStoreState {
  summaries: ConversationSummary[]
  active: Conversation | null
  loading: boolean
  error: AppError | null
  /**
   * Ids whose file would not parse. They stay in the sidebar — the entry comes
   * from index.json, which is usually fine — but marked, so a damaged
   * conversation is not silently indistinguishable from an empty one.
   */
  damaged: string[]
  /** The one the user tried to open and could not. */
  damagedActiveId: string | null

  loadList: () => Promise<void>
  open: (id: string) => Promise<void>
  create: (modelId: string) => Promise<Conversation | null>
  reload: () => Promise<void>
  rename: (id: string, title: string) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Drop a damaged entry from the list, leaving its file on disk. */
  forget: (id: string) => Promise<void>
}

export const useConversationStore = create<ConversationStoreState>((set, get) => ({
  summaries: [],
  active: null,
  loading: false,
  error: null,
  damaged: [],
  damagedActiveId: null,

  loadList: async () => {
    const result = await window.api.conversations.list()
    if (result.ok) set({ summaries: result.value, error: null })
    else set({ error: result.error })
  },

  open: async (id) => {
    set({ loading: true, error: null })
    const result = await window.api.conversations.get(id)
    if (result.ok) {
      set((state) => ({
        active: result.value,
        loading: false,
        damagedActiveId: null,
        damaged: state.damaged.filter((entry) => entry !== id),
      }))
      return
    }
    // A10: the file would not parse. Remember which one, so the main pane can
    // say so instead of rendering the ordinary empty state.
    set((state) => ({
      error: result.error,
      loading: false,
      active: null,
      damagedActiveId: id,
      damaged: state.damaged.includes(id) ? state.damaged : [...state.damaged, id],
    }))
  },

  create: async (modelId) => {
    const result = await window.api.conversations.create({ modelId })
    if (!result.ok) {
      set({ error: result.error })
      return null
    }
    set((state) => ({
      active: result.value,
      summaries: [
        {
          id: result.value.id,
          title: result.value.title,
          updatedAt: result.value.updatedAt,
          modelId: result.value.modelId,
        },
        ...state.summaries,
      ],
    }))
    return result.value
  },

  reload: async () => {
    const id = get().active?.id
    if (!id) return
    const [conversation] = await Promise.all([window.api.conversations.get(id), get().loadList()])
    if (conversation.ok) set({ active: conversation.value })
  },

  rename: async (id, title) => {
    const result = await window.api.conversations.rename(id, title)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    await get().loadList()
    if (get().active?.id === id) await get().reload()
  },

  remove: async (id) => {
    const result = await window.api.conversations.delete(id)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    set((state) => ({
      summaries: state.summaries.filter((s) => s.id !== id),
      active: state.active?.id === id ? null : state.active,
      damaged: state.damaged.filter((entry) => entry !== id),
      damagedActiveId: state.damagedActiveId === id ? null : state.damagedActiveId,
    }))
  },

  forget: async (id) => {
    const result = await window.api.conversations.forget(id)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    set((state) => ({
      summaries: state.summaries.filter((s) => s.id !== id),
      damaged: state.damaged.filter((entry) => entry !== id),
      damagedActiveId: state.damagedActiveId === id ? null : state.damagedActiveId,
    }))
  },
}))
