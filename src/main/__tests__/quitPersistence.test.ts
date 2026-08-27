/**
 * Quitting must not lose a reply the user watched arrive.
 *
 * Electron does not wait for async work on quit, and `chat:send` used to launch
 * its stream untracked, so the process could exit before the assistant message
 * was written. Because `atomicWrite` is tmp → fsync → rename the result was not a
 * corrupt file — the damaged-conversation path would at least have surfaced that
 * — but an intact, valid conversation silently missing its last reply.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '@shared/constants'
import { IPC, type Result } from '@shared/ipc'
import type { Settings } from '@shared/types'

type Handler = (event: unknown, request: unknown) => Promise<Result<unknown>>
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  },
}))

const { registerChatHandlers } = await import('../ipc/chat.handlers')
const { ConversationStore } = await import('../services/conversationStore')
const { Logger } = await import('../lib/logger')

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  hasApiKey: true,
  serverUrl: 'https://harness.test',
}

let directory: string
let conversations: InstanceType<typeof ConversationStore>

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'harness-quit-'))
  conversations = new ConversationStore({ directory })
  handlers.clear()
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

/**
 * A stream that emits a couple of frames and then hangs, like a real reply still
 * being generated when the user presses Cmd-Q.
 *
 * Aborting the signal errors the stream, which is what a real `fetch` body does
 * when its request is aborted. Without that fidelity the reader would simply
 * hang and the test would be measuring the deadline rather than the save.
 */
function endlessStream(signal: AbortSignal, onAbort: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let sent = 0
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener('abort', () => {
        onAbort()
        controller.error(new DOMException('aborted', 'AbortError'))
      })
    },
    async pull(controller) {
      if (sent < 2) {
        const word = sent === 0 ? 'partial ' : 'answer '
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`,
          ),
        )
        sent += 1
        return
      }
      // ...and then nothing, until the abort above ends it.
      await new Promise(() => {})
    },
  })
}

function register(options: { slowPersist?: number } = {}) {
  const logger = new Logger({ directory: join(directory, 'logs'), level: 'error' })
  let aborted = false

  const client = {
    chatCompletions: async (_body: unknown, signal: AbortSignal) => ({
      ok: true as const,
      value: { body: endlessStream(signal, () => (aborted = true)), status: 200 },
    }),
  }

  const repository = options.slowPersist
    ? {
        ...conversations,
        list: () => conversations.list(),
        get: (id: string) => conversations.get(id),
        create: (init: { title?: string | undefined; modelId: string }) =>
          conversations.create(init),
        rename: (id: string, title: string) => conversations.rename(id, title),
        delete: (id: string) => conversations.delete(id),
        forget: (id: string) => conversations.forget(id),
        // A write that never lands, to exercise the deadline.
        appendMessage: async (
          id: string,
          message: Parameters<typeof conversations.appendMessage>[1],
        ) => {
          if (message.role === 'assistant') await new Promise(() => {})
          await conversations.appendMessage(id, message)
        },
      }
    : conversations

  const lifecycle = registerChatHandlers({
    client: client as never,
    conversations: repository as never,
    logger,
    settings: async () => settings,
    activeModelId: () => 'glm-4.7-flash',
    webContents: () => null,
  })

  return { lifecycle, wasAborted: () => aborted }
}

async function startReply(): Promise<{ conversationId: string; requestId: string }> {
  const conversation = await conversations.create({ modelId: 'glm-4.7-flash' })
  const handler = handlers.get(IPC.chatSend)
  if (!handler) throw new Error('chat:send was not registered')

  const result = (await handler(
    {},
    { conversationId: conversation.id, content: 'tell me something long' },
  )) as Result<{ requestId: string }>
  if (!result.ok) throw new Error(`chat:send failed: ${result.error.code}`)

  // Let a couple of frames arrive, so there is a partial worth saving.
  await new Promise((resolve) => setTimeout(resolve, 60))
  return { conversationId: conversation.id, requestId: result.value.requestId }
}

describe('quitting with a reply in flight', () => {
  it('persists the partial reply and marks it stopped', async () => {
    const { lifecycle } = register()
    const { conversationId } = await startReply()

    const outcome = await lifecycle.shutdown(2_000)

    expect(outcome).toEqual({ aborted: 1, settled: true })

    const saved = await conversations.get(conversationId)
    const assistant = saved?.messages.find((message) => message.role === 'assistant')
    expect(assistant, 'the reply was lost').toBeDefined()
    expect(assistant?.content).toContain('partial')
    // The same marking the Stop button produces — one path, not two.
    expect(assistant?.stopped).toBe(true)
    expect(assistant?.finishReason).toBe('abort')
  })

  it('aborts the upstream request rather than waiting for the reply to finish', async () => {
    // Waiting could take minutes, and on a metered backend it would keep
    // generating after the user asked to quit.
    const { lifecycle, wasAborted } = register()
    await startReply()

    await lifecycle.shutdown(2_000)

    expect(wasAborted()).toBe(true)
  })

  it('keeps the user message too', async () => {
    const { lifecycle } = register()
    const { conversationId } = await startReply()
    await lifecycle.shutdown(2_000)

    const saved = await conversations.get(conversationId)
    expect(saved?.messages.filter((m) => m.role === 'user')).toHaveLength(1)
  })

  it('handles several in-flight replies at once', async () => {
    const { lifecycle } = register()
    await startReply()
    await startReply()

    const outcome = await lifecycle.shutdown(2_000)
    expect(outcome.aborted).toBe(2)
    expect(outcome.settled).toBe(true)
  })
})

describe('the deadline', () => {
  it('expires cleanly rather than hanging', async () => {
    // A hung quit is worse than a lost message, and atomicWrite means the file
    // on disk is whole either way.
    const { lifecycle } = register({ slowPersist: 1 })
    await startReply()

    const startedAt = Date.now()
    const outcome = await lifecycle.shutdown(150)
    const elapsed = Date.now() - startedAt

    expect(outcome.settled, 'a write that never lands should trip the deadline').toBe(false)
    expect(outcome.aborted).toBe(1)
    expect(elapsed).toBeLessThan(1_000)
  })

  it('returns immediately when nothing is in flight', async () => {
    const { lifecycle } = register()

    const startedAt = Date.now()
    expect(await lifecycle.shutdown(2_000)).toEqual({ aborted: 0, settled: true })
    expect(Date.now() - startedAt).toBeLessThan(100)
  })
})

describe('the index cache', () => {
  it('is repaired when it disagrees with the conversation file', async () => {
    // The window is a quit between the two writes in appendMessage. The
    // transcript is written first, so the survivable state is a stale summary.
    const { readFileSync, writeFileSync } = await import('node:fs')
    const conversation = await conversations.create({ modelId: 'glm-4.7-flash' })
    await conversations.appendMessage(conversation.id, {
      id: 'm1',
      role: 'user',
      content: 'A title derived from this',
      createdAt: new Date().toISOString(),
    })

    const indexPath = join(directory, 'index.json')
    const stale = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, string>[]
    writeFileSync(
      indexPath,
      JSON.stringify(stale.map((row) => ({ ...row, title: 'a stale summary' }))),
    )

    // Opening the conversation notices and corrects it.
    await conversations.get(conversation.id)

    const repaired = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, string>[]
    expect(repaired[0]?.title).toBe('A title derived from this')
  })

  it('is left alone when it already agrees', async () => {
    const { readFileSync } = await import('node:fs')
    const conversation = await conversations.create({ modelId: 'glm-4.7-flash' })
    const before = readFileSync(join(directory, 'index.json'), 'utf8')

    await conversations.get(conversation.id)

    expect(readFileSync(join(directory, 'index.json'), 'utf8')).toBe(before)
  })
})
