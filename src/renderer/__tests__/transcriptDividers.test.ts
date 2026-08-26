/**
 * Where the "— switched to X —" divider goes (SPEC §8.1).
 *
 * Derived from each assistant message's `modelId` rather than stored as its own
 * kind of entry, so it survives a reload and cannot disagree with the transcript.
 */

import { describe, expect, it } from 'vitest'

import type { Message } from '@shared/types'

import { withDividers } from '../lib/transcriptDividers'

const user = (id: string): Message => ({
  id,
  role: 'user',
  content: 'ask',
  createdAt: '2026-08-26T00:00:00Z',
})

const assistant = (id: string, modelId: string): Message => ({
  id,
  role: 'assistant',
  content: 'answer',
  modelId,
  createdAt: '2026-08-26T00:00:00Z',
})

/** An assistant message written before `modelId` was recorded. */
const withoutModelId = (message: Message): Message => {
  const { modelId: _dropped, ...rest } = message
  return rest
}

const kinds = (messages: Message[]): string[] =>
  withDividers(messages).map((item) =>
    item.kind === 'divider' ? `divider:${item.modelId}` : `message:${item.message?.id}`,
  )

describe('withDividers', () => {
  it('adds nothing to a single-model conversation', () => {
    const items = withDividers([
      user('u1'),
      assistant('a1', 'glm'),
      user('u2'),
      assistant('a2', 'glm'),
    ])
    expect(items.every((item) => item.kind === 'message')).toBe(true)
  })

  it('does not announce the first model — there is nothing to switch from', () => {
    expect(kinds([user('u1'), assistant('a1', 'glm')])).toEqual(['message:u1', 'message:a1'])
  })

  it('inserts a divider when the model changes', () => {
    expect(
      kinds([user('u1'), assistant('a1', 'glm'), user('u2'), assistant('a2', 'qwen')]),
    ).toEqual(['message:u1', 'message:a1', 'message:u2', 'divider:qwen', 'message:a2'])
  })

  it('inserts one divider per change, not per message', () => {
    const items = kinds([
      assistant('a1', 'glm'),
      assistant('a2', 'qwen'),
      assistant('a3', 'qwen'),
      assistant('a4', 'glm'),
    ])
    expect(items.filter((entry) => entry.startsWith('divider'))).toEqual([
      'divider:qwen',
      'divider:glm',
    ])
  })

  it('places the divider before the message it introduces', () => {
    const items = kinds([assistant('a1', 'glm'), user('u1'), assistant('a2', 'qwen')])
    expect(items.indexOf('divider:qwen')).toBe(items.indexOf('message:a2') - 1)
  })

  it('ignores user messages, which have no model', () => {
    expect(kinds([user('u1'), user('u2')])).toEqual(['message:u1', 'message:u2'])
  })

  it('tolerates an assistant message with no modelId', () => {
    // Messages written before modelId was recorded, or a partial write.
    const items = kinds([
      assistant('a1', 'glm'),
      withoutModelId(assistant('a2', 'glm')),
      assistant('a3', 'qwen'),
    ])
    expect(items.filter((entry) => entry.startsWith('divider'))).toEqual(['divider:qwen'])
  })

  it('keeps every message exactly once', () => {
    const messages = [user('u1'), assistant('a1', 'glm'), user('u2'), assistant('a2', 'qwen')]
    const kept = withDividers(messages)
      .filter((item) => item.kind === 'message')
      .map((item) => item.message?.id)
    expect(kept).toEqual(['u1', 'a1', 'u2', 'a2'])
  })

  it('returns nothing for an empty transcript', () => {
    expect(withDividers([])).toEqual([])
  })
})
