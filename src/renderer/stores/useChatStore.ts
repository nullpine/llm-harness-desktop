/**
 * In-flight streams, keyed by `requestId`.
 *
 * **Correlation is by `requestId` only.** Never by anything in a frame: relayed
 * frames carry the engine's name for the model, not the catalog id (API-CONTRACT
 * §2), so matching on `model` would break the moment the tag and the id differ —
 * which on the Ollama path they always do.
 *
 * This is a view. The main process owns the canonical transcript; if the two ever
 * disagree, reload the conversation from disk (ARCHITECTURE.md).
 */

import { create } from 'zustand'

import type { FinishReason, MessageUsage } from '@shared/types'

export type StreamStatus = 'streaming' | 'done' | 'error' | 'stopped'

export interface StreamBuffer {
  requestId: string
  conversationId: string
  content: string
  reasoning: string
  status: StreamStatus
  error: { code: string; message: string } | null
  finishReason: FinishReason
  usage: MessageUsage | undefined
  startedAt: number
  endedAt: number | null
  /** The text that produced it, so Retry can re-send exactly this. */
  prompt: string
}

interface ChatStoreState {
  streams: Record<string, StreamBuffer>
  /** The stream for the conversation on screen, if any. */
  activeRequestId: string | null

  begin: (init: { requestId: string; conversationId: string; prompt: string }) => void
  appendChunk: (requestId: string, delta: string, kind: 'content' | 'reasoning') => void
  finish: (requestId: string, finishReason: FinishReason, usage?: MessageUsage) => void
  fail: (requestId: string, code: string, message: string) => void
  clear: (requestId: string) => void
}

export const useChatStore = create<ChatStoreState>((set) => ({
  streams: {},
  activeRequestId: null,

  begin: ({ requestId, conversationId, prompt }) =>
    set((state) => ({
      activeRequestId: requestId,
      streams: {
        ...state.streams,
        [requestId]: {
          requestId,
          conversationId,
          content: '',
          reasoning: '',
          status: 'streaming',
          error: null,
          finishReason: null,
          usage: undefined,
          startedAt: Date.now(),
          endedAt: null,
          prompt,
        },
      },
    })),

  appendChunk: (requestId, delta, kind) =>
    set((state) => {
      const stream = state.streams[requestId]
      // A chunk for a stream we never started is not an error — it can arrive
      // after a reload — but there is nothing to append it to.
      if (!stream) return state
      return {
        streams: {
          ...state.streams,
          [requestId]: {
            ...stream,
            content: kind === 'content' ? stream.content + delta : stream.content,
            reasoning: kind === 'reasoning' ? stream.reasoning + delta : stream.reasoning,
          },
        },
      }
    }),

  finish: (requestId, finishReason, usage) =>
    set((state) => {
      const stream = state.streams[requestId]
      if (!stream) return state
      return {
        activeRequestId: state.activeRequestId === requestId ? null : state.activeRequestId,
        streams: {
          ...state.streams,
          [requestId]: {
            ...stream,
            // `abort` is the finish reason main reports when the user pressed Stop.
            status: finishReason === 'abort' ? 'stopped' : 'done',
            finishReason,
            usage,
            endedAt: Date.now(),
          },
        },
      }
    }),

  fail: (requestId, code, message) =>
    set((state) => {
      const stream = state.streams[requestId]
      if (!stream) return state
      return {
        activeRequestId: state.activeRequestId === requestId ? null : state.activeRequestId,
        streams: {
          ...state.streams,
          [requestId]: {
            ...stream,
            status: 'error',
            error: { code, message },
            endedAt: Date.now(),
          },
        },
      }
    }),

  clear: (requestId) =>
    set((state) => {
      const { [requestId]: _removed, ...rest } = state.streams
      return {
        streams: rest,
        activeRequestId: state.activeRequestId === requestId ? null : state.activeRequestId,
      }
    }),
}))

/** How long the reasoning phase took, for the `Thinking (Ns)` label. */
export function thinkingSeconds(stream: StreamBuffer): number {
  const end = stream.endedAt ?? Date.now()
  return Math.max(0, (end - stream.startedAt) / 1000)
}
