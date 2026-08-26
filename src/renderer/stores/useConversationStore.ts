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

  loadList: () => Promise<void>
  open: (id: string) => Promise<void>
  create: (modelId: string) => Promise<Conversation | null>
  reload: () => Promise<void>
  rename: (id: string, title: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useConversationStore = create<ConversationStoreState>((set, get) => ({
  summaries: [],
  active: null,
  loading: false,
  error: null,

  loadList: async () => {
    const result = await window.api.conversations.list()
    if (result.ok) set({ summaries: result.value, error: null })
    else set({ error: result.error })
  },

  open: async (id) => {
    set({ loading: true, error: null })
    const result = await window.api.conversations.get(id)
    if (result.ok) set({ active: result.value, loading: false })
    // A10: a conversation that failed to parse is absent rather than fatal, so
    // this is a normal "could not open" rather than a crash.
    else set({ error: result.error, loading: false, active: null })
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
    }))
  },
}))
