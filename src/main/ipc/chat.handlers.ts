/**
 * `chat:send` and `chat:abort` — the streaming path (ARCHITECTURE.md).
 *
 * The order of operations matters more than anything else here:
 *
 *  1. **Persist the user message before opening the request.** A crash mid-stream
 *     must not lose what the user typed.
 *  2. Return `{ requestId }` immediately; everything after arrives as events keyed
 *     by that id. Correlation is by `requestId` and nothing else — never by
 *     anything inside a frame, which carries the engine's name for the model
 *     rather than the catalog id (API-CONTRACT §2).
 *  3. On the way out, persist the assistant message with its full text.
 *
 * Abort must abort the underlying fetch, not merely stop reading. Stopping the
 * read leaves the model generating tokens nobody will see, which on the Azure
 * path is a real bill and on the local path holds the only GPU you have.
 */

import type { WebContents } from 'electron'

import { appError, type AppError } from '@shared/errors'
import { IPC, type ChatChunkEvent, type ChatDoneEvent, type ChatErrorEvent } from '@shared/ipc'
import type { ChatSendRequest, FinishReason, Message, MessageUsage, Settings } from '@shared/types'

import type { Logger } from '../lib/logger'
import { ulid } from '../lib/ulid'
import type { ConversationRepository } from '../services/conversationStore'
import type { HarnessClient } from '../services/harnessClient'
import { readSseStream } from '../services/sseStream'
import { failWith, handle } from './index'

export interface ChatHandlerDeps {
  client: HarnessClient
  conversations: ConversationRepository
  logger: Logger
  settings: () => Promise<Settings>
  activeModelId: () => string | null
  /** Where events go. A closed window must not be sent to. */
  webContents: () => WebContents | null
}

/** In-flight streams, so `chat:abort` — and quitting — can reach them. */
interface InFlight {
  controller: AbortController
  conversationId: string
  messageId: string
  /**
   * The stream's own task. Held so shutdown can wait for the *persist* rather
   * than merely for the abort to be requested: aborting stops the model, but
   * the partial reply is written a few lines later.
   */
  task: Promise<void>
}

export interface ChatLifecycle {
  /**
   * Stop every in-flight reply and wait for what arrived to reach disk.
   *
   * Deliberately does not wait for replies to *finish* — that could take
   * minutes, and on a metered backend it would keep generating after the user
   * asked to quit. Aborting is also what stops the model.
   *
   * Returns once every stream has settled or `deadlineMs` elapses, whichever is
   * first. `settled: false` means the deadline won and something may be lost.
   */
  shutdown(deadlineMs: number): Promise<{ aborted: number; settled: boolean }>
}

export function registerChatHandlers(deps: ChatHandlerDeps): ChatLifecycle {
  const { logger } = deps
  const inFlight = new Map<string, InFlight>()

  handle<ChatSendRequest, { requestId: string }>(IPC.chatSend, logger, async (request) => {
    const conversation = await deps.conversations.get(request.conversationId)
    if (!conversation) {
      throw failWith(appError('not_found', 'That conversation could not be opened.'))
    }

    const modelId = deps.activeModelId()
    if (!modelId) {
      // A12: the friendly version of a 409, decided here rather than after a
      // pointless round trip to a server we already know has nothing loaded.
      throw failWith(
        appError('model_not_active', 'No model is loaded — start the server or pick a model'),
      )
    }

    const settings = await deps.settings()
    const now = new Date().toISOString()

    // 1. Persist before anything can fail.
    const userMessage: Message = {
      id: ulid(),
      role: 'user',
      content: request.content,
      createdAt: now,
    }
    await deps.conversations.appendMessage(conversation.id, userMessage)

    const requestId = ulid()
    const controller = new AbortController()
    const assistantMessageId = ulid()

    // 2. Everything past here is events. The invoke has already returned — but
    // the task is *tracked*, not fire-and-forget: an untracked `void` here is
    // what let quitting kill a reply mid-write.
    const task = streamReply({
      deps,
      requestId,
      assistantMessageId,
      conversationId: conversation.id,
      modelId,
      body: buildRequestBody({
        modelId,
        settings,
        systemPrompt: conversation.systemPrompt ?? settings.systemPrompt,
        history: conversation.messages,
        userMessage,
      }),
      controller,
      onSettled: () => inFlight.delete(requestId),
    })
    void task

    inFlight.set(requestId, {
      controller,
      conversationId: conversation.id,
      messageId: assistantMessageId,
      task,
    })

    return { requestId }
  })

  handle<{ requestId: string }, { ok: true }>(IPC.chatAbort, logger, ({ requestId }) => {
    const entry = inFlight.get(requestId)
    if (entry) {
      // Aborting the controller tears down the fetch, which is what actually
      // stops the model. The stream loop persists the partial text.
      entry.controller.abort()
      logger.info('aborted a stream', { requestId })
    }
    return { ok: true }
  })

  return {
    async shutdown(deadlineMs) {
      const entries = [...inFlight.values()]
      if (entries.length === 0) return { aborted: 0, settled: true }

      logger.info('quitting with replies in flight; stopping and saving them', {
        count: entries.length,
      })

      // Exactly what the Stop button does. Reusing it rather than writing a
      // second save path is the point: two paths drift, and the one that only
      // runs at quit is the one nobody notices has drifted.
      for (const entry of entries) entry.controller.abort()

      const settled = await Promise.race([
        Promise.allSettled(entries.map((entry) => entry.task)).then(() => true),
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), deadlineMs)
          // Never hold the process open for the deadline itself.
          timer.unref?.()
        }),
      ])

      if (!settled) {
        logger.error('quit deadline expired with replies still saving', {
          deadlineMs,
          remaining: inFlight.size,
        })
      }
      return { aborted: entries.length, settled }
    },
  }
}

interface StreamArgs {
  deps: ChatHandlerDeps
  requestId: string
  assistantMessageId: string
  conversationId: string
  modelId: string
  body: Record<string, unknown>
  controller: AbortController
  onSettled: () => void
}

async function streamReply(args: StreamArgs): Promise<void> {
  const { deps, requestId, controller } = args
  let content = ''
  let reasoning = ''
  let usage: MessageUsage | undefined
  let finishReason: FinishReason = null
  // Reasoning time is the gap between the first reasoning token and the first
  // content token — not the whole stream, which would count the answer too.
  let firstReasoningAt: number | null = null
  let firstContentAt: number | null = null

  const send = <T>(channel: string, payload: T): void => {
    const contents = deps.webContents()
    if (contents && !contents.isDestroyed()) contents.send(channel, payload)
  }

  const persist = async (extra: Partial<Message>): Promise<void> => {
    const message: Message = {
      id: args.assistantMessageId,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
      modelId: args.modelId,
      ...(reasoning !== '' ? { reasoning, reasoningMs: reasoningMs() } : {}),
      ...(usage ? { usage } : {}),
      ...extra,
    }
    try {
      await deps.conversations.appendMessage(args.conversationId, message)
    } catch (cause) {
      deps.logger.error('could not persist the assistant message', cause)
    }
  }

  /** Elapsed reasoning time, ending at the first content token or at now. */
  const reasoningMs = (): number => {
    if (firstReasoningAt === null) return 0
    return Math.max(0, (firstContentAt ?? Date.now()) - firstReasoningAt)
  }

  const fail = async (error: AppError): Promise<void> => {
    // Persist whatever arrived before the failure — a half-answer the user can
    // read beats an empty bubble and a toast.
    if (content !== '' || reasoning !== '') await persist({ error: toStoredError(error) })
    send<ChatErrorEvent>(IPC.chatError, {
      requestId,
      code: String(error.code),
      message: error.message,
    })
  }

  try {
    const response = await deps.client.chatCompletions(args.body, controller.signal)
    if (!response.ok) {
      await fail(response.error)
      return
    }

    for await (const event of readSseStream(response.value.body, {
      // The idle timeout aborts the request rather than only ending the read,
      // for the same reason `chat:abort` does.
      onIdleTimeout: () => controller.abort(),
    })) {
      if (event.type === 'delta') {
        if (event.kind === 'content') {
          content += event.text
          firstContentAt ??= Date.now()
        } else {
          reasoning += event.text
          firstReasoningAt ??= Date.now()
        }
        send<ChatChunkEvent>(IPC.chatChunk, {
          requestId,
          delta: event.text,
          kind: event.kind,
        })
        continue
      }

      if (event.type === 'error') {
        await fail(event.error)
        return
      }

      finishReason = event.finishReason
      usage = event.usage
    }

    await persist({ finishReason })
    send<ChatDoneEvent>(IPC.chatDone, {
      requestId,
      finishReason,
      ...(usage ? { usage } : {}),
    })
  } catch (cause) {
    if (controller.signal.aborted) {
      // The user pressed Stop, or the idle timeout fired. Keep the partial text.
      await persist({ stopped: true, finishReason: 'abort' })
      send<ChatDoneEvent>(IPC.chatDone, { requestId, finishReason: 'abort' })
      return
    }
    deps.logger.error('unexpected failure while streaming', cause)
    await fail(appError('internal', 'The reply stopped unexpectedly.'))
  } finally {
    args.onSettled()
  }
}

/**
 * Assemble `messages[]` per SPEC §8.3.
 *
 * No token counting and no truncation — deliberately. A context-length error is
 * surfaced verbatim and the user starts a new chat; token-aware trimming is
 * tracked as post-MVP rather than half-built here.
 */
export function buildRequestBody(args: {
  modelId: string
  settings: Settings
  systemPrompt: string
  history: Message[]
  userMessage: Message
}): Record<string, unknown> {
  const messages: { role: string; content: string }[] = []

  const system = args.systemPrompt.trim()
  if (system !== '') messages.push({ role: 'system', content: system })

  for (const message of args.history) {
    // Errored and empty messages would teach the model to produce more of the
    // same, and an errored turn never got a real reply to learn from.
    if (message.error) continue
    if (message.content.trim() === '') continue
    if (message.role === 'system') continue
    if (message.id === args.userMessage.id) continue
    messages.push({ role: message.role, content: message.content })
  }

  messages.push({ role: 'user', content: args.userMessage.content })

  return {
    model: args.modelId,
    messages,
    stream: args.settings.streamingEnabled,
    temperature: args.settings.temperature,
    top_p: args.settings.topP,
    max_tokens: args.settings.maxTokens,
  }
}

function toStoredError(error: AppError): { code: string; message: string } {
  return { code: String(error.code), message: error.message }
}
