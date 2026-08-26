/**
 * Conversation persistence, and above all acceptance **A10**: "A malformed
 * conversation JSON file is skipped with a logged warning; the app still starts."
 *
 * The corrupt-file path is the bulk of this file on purpose. It is the kind of
 * thing nobody writes a test for until it bites, and when it bites the symptom is
 * an app that will not open — which the user cannot work around.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Message } from '@shared/types'

import { ConversationStore, deriveTitle } from '../services/conversationStore'

let directory: string
let warn: ReturnType<typeof vi.fn<(message: string, meta?: unknown) => void>>
let store: ConversationStore

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'harness-conv-'))
  warn = vi.fn<(message: string, meta?: unknown) => void>()
  store = new ConversationStore({ directory, onWarn: warn })
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const message = (overrides: Partial<Message> = {}): Message => ({
  id: `msg-${Math.random().toString(36).slice(2)}`,
  role: 'user',
  content: 'hello',
  createdAt: new Date().toISOString(),
  ...overrides,
})

// --- the happy path -----------------------------------------------------------

describe('create, append, list, get', () => {
  it('creates a conversation and lists it', async () => {
    const created = await store.create({ modelId: 'glm-4.7-flash' })
    expect(created.id).toMatch(/^[0-9A-Z]{26}$/)
    expect(created.messages).toEqual([])

    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: created.id, modelId: 'glm-4.7-flash' })
  })

  it('round-trips a transcript through disk', async () => {
    const created = await store.create({ modelId: 'glm-4.7-flash' })
    await store.appendMessage(created.id, message({ content: 'what is a GPU?' }))
    await store.appendMessage(
      created.id,
      message({ role: 'assistant', content: 'A parallel processor.', modelId: 'glm-4.7-flash' }),
    )

    // A7: a fresh store, as if the app had been quit and reopened.
    const reopened = new ConversationStore({ directory })
    const loaded = await reopened.get(created.id)
    expect(loaded?.messages.map((m) => m.content)).toEqual([
      'what is a GPU?',
      'A parallel processor.',
    ])
  })

  it('treats a repeated message id as an update, not a duplicate', async () => {
    // The assistant message is written once when the stream ends and again on a
    // retry; appending twice must not double it.
    const created = await store.create({ modelId: 'm' })
    const partial = message({ role: 'assistant', content: 'partial' })
    await store.appendMessage(created.id, partial)
    await store.appendMessage(created.id, { ...partial, content: 'complete' })

    const loaded = await store.get(created.id)
    expect(loaded?.messages).toHaveLength(1)
    expect(loaded?.messages[0]?.content).toBe('complete')
  })

  it('round-trips finishReason, so a truncated reply still says so after a reopen', async () => {
    // A7 plus truncation: the note in the bubble is driven by this field, and it
    // has to survive a quit rather than living only in the in-memory buffer.
    const created = await store.create({ modelId: 'm' })
    await store.appendMessage(
      created.id,
      message({ role: 'assistant', content: 'cut off mid-', finishReason: 'length' }),
    )

    const reopened = new ConversationStore({ directory })
    const loaded = await reopened.get(created.id)
    expect(loaded?.messages[0]?.finishReason).toBe('length')
  })

  it('derives the title from the first user message', async () => {
    const created = await store.create({ modelId: 'm' })
    await store.appendMessage(created.id, message({ content: 'How do I profile Rust?' }))
    expect((await store.get(created.id))?.title).toBe('How do I profile Rust?')
  })

  it('leaves an explicit title alone', async () => {
    const created = await store.create({ title: 'Named by hand', modelId: 'm' })
    await store.appendMessage(created.id, message({ content: 'anything' }))
    expect((await store.get(created.id))?.title).toBe('Named by hand')
  })

  it('renames and deletes', async () => {
    const created = await store.create({ modelId: 'm' })
    await store.rename(created.id, '  Renamed  ')
    expect((await store.get(created.id))?.title).toBe('Renamed')

    await store.delete(created.id)
    expect(await store.get(created.id)).toBeNull()
    expect(await store.list()).toEqual([])
  })

  it('lists newest first', async () => {
    const a = await store.create({ modelId: 'm' })
    const b = await store.create({ modelId: 'm' })
    await store.appendMessage(a.id, message({ content: 'later' }))

    expect((await store.list()).map((s) => s.id)).toEqual([a.id, b.id])
  })

  it('keeps index.json to summaries only', async () => {
    const created = await store.create({ modelId: 'm' })
    await store.appendMessage(created.id, message({ content: 'a body that should not be indexed' }))

    const index: unknown = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'))
    const first = (index as Record<string, unknown>[])[0] ?? {}
    expect(Object.keys(first).sort()).toEqual(['id', 'modelId', 'title', 'updatedAt'])
  })

  it('writes atomically, leaving no temp files behind', async () => {
    const created = await store.create({ modelId: 'm' })
    await store.appendMessage(created.id, message())
    expect(readdirSync(directory).filter((f) => f.includes('.tmp'))).toEqual([])
  })
})

// --- A10: corrupt files -------------------------------------------------------

describe('A10: a malformed conversation file is skipped, not fatal', () => {
  async function withCorruptFile(contents: string): Promise<void> {
    await store.create({ modelId: 'm' })
    writeFileSync(join(directory, 'CORRUPT01234567890123456789.json'), contents)
    rmSync(join(directory, 'index.json'), { force: true })
  }

  it.each([
    ['truncated json', '{"id":"CORRUPT","messages":['],
    ['not an object', '"just a string"'],
    ['an array', '[1, 2, 3]'],
    ['empty', ''],
    ['messages missing', '{"id":"CORRUPT","title":"x"}'],
    ['messages not an array', '{"id":"CORRUPT","messages":"nope"}'],
    ['plain text', 'not json at all'],
  ])('skips a file that is %s', async (_label, contents) => {
    await withCorruptFile(contents)

    const list = await store.list()

    expect(list).toHaveLength(1) // the good one survives
    expect(list.every((s) => !s.id.startsWith('CORRUPT'))).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('returns null for a corrupt conversation rather than throwing', async () => {
    writeFileSync(join(directory, 'BAD01234567890123456789012.json'), '{oops')
    await expect(store.get('BAD01234567890123456789012')).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('drops malformed messages but keeps the conversation', async () => {
    // One bad message should not condemn the whole transcript.
    const created = await store.create({ modelId: 'm' })
    const path = join(directory, `${created.id}.json`)
    const conversation = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    conversation.messages = [
      { id: 'ok', role: 'user', content: 'kept', createdAt: '2026-01-01T00:00:00Z' },
      { role: 'user', content: 'no id' },
      'not even an object',
      { id: 'bad-role', role: 'wizard', content: 'x', createdAt: '2026-01-01T00:00:00Z' },
    ]
    writeFileSync(path, JSON.stringify(conversation))

    const loaded = await store.get(created.id)
    expect(loaded?.messages.map((m) => m.content)).toEqual(['kept'])
  })

  it('rebuilds an unreadable index.json from the directory', async () => {
    const created = await store.create({ modelId: 'm' })
    writeFileSync(join(directory, 'index.json'), 'not json')

    const list = await store.list()

    expect(list.map((s) => s.id)).toEqual([created.id])
    expect(warn).toHaveBeenCalled()
    // And the rebuilt index is written back, so the next start is cheap.
    expect(JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'))).toHaveLength(1)
  })

  it('rebuilds an index that is valid JSON but the wrong shape', async () => {
    const created = await store.create({ modelId: 'm' })
    writeFileSync(join(directory, 'index.json'), '{"not":"an array"}')
    expect((await store.list()).map((s) => s.id)).toEqual([created.id])
  })

  it('drops malformed entries from an otherwise-valid index', async () => {
    await store.create({ modelId: 'm' })
    const index = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8')) as unknown[]
    writeFileSync(join(directory, 'index.json'), JSON.stringify([...index, { junk: true }, 42]))

    expect(await store.list()).toHaveLength(1)
  })

  it('forget() drops the entry but leaves the file on disk', async () => {
    // A10: the file may be recoverable by hand, so removing it from the sidebar
    // must not destroy it.
    const created = await store.create({ modelId: 'm' })
    const path = join(directory, `${created.id}.json`)
    writeFileSync(path, '{ truncated')

    await store.forget(created.id)

    expect(await store.list()).toEqual([])
    expect(existsSync(path)).toBe(true)
  })

  it('forget() on an unknown id is a no-op', async () => {
    const created = await store.create({ modelId: 'm' })
    await store.forget('NOTAREALID0123456789012345')
    expect((await store.list()).map((s) => s.id)).toEqual([created.id])
  })

  it('a damaged file leaves its index entry in place — which is why the UI marks it', async () => {
    // The entry comes from index.json, which is usually fine. Before the UI
    // change this meant a damaged conversation looked like an ordinary empty one.
    const created = await store.create({ modelId: 'm' })
    await store.appendMessage(created.id, message({ content: 'hello' }))
    writeFileSync(join(directory, `${created.id}.json`), '{ truncated')

    expect((await store.list()).map((s) => s.id)).toEqual([created.id])
    expect(await store.get(created.id)).toBeNull()
  })

  it('starts clean on an empty or missing directory', async () => {
    const fresh = new ConversationStore({ directory: join(directory, 'does-not-exist') })
    await expect(fresh.list()).resolves.toEqual([])
  })

  it('ignores non-JSON files in the directory', async () => {
    await store.create({ modelId: 'm' })
    writeFileSync(join(directory, 'notes.txt'), 'a stray file')
    rmSync(join(directory, 'index.json'), { force: true })
    expect(await store.list()).toHaveLength(1)
  })
})

// --- path safety ---------------------------------------------------------------

describe('ids from the renderer cannot escape the directory', () => {
  const traversals = ['../settings', '../../etc/passwd', 'a/b', '', '.']

  it.each(traversals)('refuses to read %j', async (id) => {
    await expect(store.get(id)).resolves.toBeNull()
  })

  it('refuses to delete via a traversal', async () => {
    await expect(store.delete('../settings')).rejects.toThrow(/unsafe/)
  })
})

// --- title derivation ----------------------------------------------------------

describe('deriveTitle', () => {
  it('uses the first user message', () => {
    expect(
      deriveTitle([
        { id: '1', role: 'system', content: 'sys', createdAt: '' },
        { id: '2', role: 'user', content: 'the real first', createdAt: '' },
        { id: '3', role: 'user', content: 'second', createdAt: '' },
      ]),
    ).toBe('the real first')
  })

  it('truncates at 48 characters', () => {
    const title = deriveTitle([{ id: '1', role: 'user', content: 'x'.repeat(100), createdAt: '' }])
    expect(title).toHaveLength(49) // 48 plus the ellipsis
    expect(title?.endsWith('…')).toBe(true)
  })

  it('flattens newlines so the sidebar stays one line', () => {
    expect(
      deriveTitle([{ id: '1', role: 'user', content: 'line one\n\nline two', createdAt: '' }]),
    ).toBe('line one line two')
  })

  it('returns null with nothing to derive from', () => {
    expect(deriveTitle([])).toBeNull()
    expect(deriveTitle([{ id: '1', role: 'user', content: '   ', createdAt: '' }])).toBeNull()
  })
})
