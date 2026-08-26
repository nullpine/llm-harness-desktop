/**
 * Wires the three chat events into `useChatStore`, and sends messages.
 *
 * Mounted once, high in the tree. The events are global — they are not scoped to
 * a component — so subscribing per bubble would multiply every chunk by the
 * number of rendered messages.
 */

import { useCallback } from 'react'

import type { ChatChunkEvent, ChatDoneEvent, ChatErrorEvent } from '@shared/ipc'

import { useChatStore } from '../stores/useChatStore'
import { useConversationStore } from '../stores/useConversationStore'
import { useIpcEvent } from './useIpcEvent'

export interface SendResult {
  ok: boolean
  error?: { code: string; message: string }
}

export function useChatEvents(): void {
  const { appendChunk, finish, fail } = useChatStore()
  const reload = useConversationStore((state) => state.reload)

  useIpcEvent<ChatChunkEvent>(window.api.chat.onChunk, (chunk) => {
    appendChunk(chunk.requestId, chunk.delta, chunk.kind)
  })

  useIpcEvent<ChatDoneEvent>(window.api.chat.onDone, (done) => {
    finish(done.requestId, done.finishReason, done.usage)
    // Main has persisted the assistant message by now; re-read it so the
    // transcript on screen is the transcript on disk.
    void reload()
  })

  useIpcEvent<ChatErrorEvent>(window.api.chat.onError, (error) => {
    fail(error.requestId, error.code, error.message)
    void reload()
  })
}

/** Send a message and register its stream. Returns the failure, never throws. */
export function useSendMessage(): (content: string) => Promise<SendResult> {
  const begin = useChatStore((state) => state.begin)
  const reload = useConversationStore((state) => state.reload)
  const activeId = useConversationStore((state) => state.active?.id ?? null)

  return useCallback(
    async (content: string): Promise<SendResult> => {
      if (!activeId) return { ok: false, error: { code: 'internal', message: 'no conversation' } }

      const result = await window.api.chat.send({ conversationId: activeId, content })
      if (!result.ok) {
        return {
          ok: false,
          error: { code: String(result.error.code), message: result.error.message },
        }
      }

      begin({ requestId: result.value.requestId, conversationId: activeId, prompt: content })
      // The user message is already on disk — main persisted it before opening
      // the request — so pull it in rather than optimistically duplicating it.
      void reload()
      return { ok: true }
    },
    [activeId, begin, reload],
  )
}

export function useAbort(): (requestId: string) => Promise<void> {
  return useCallback(async (requestId: string) => {
    await window.api.chat.abort(requestId)
  }, [])
}
