/**
 * Context assembly (SPEC §8.3).
 *
 * The rules are short and each one exists because of a specific failure: a system
 * prompt sent as an empty string confuses some models; errored turns never got a
 * real reply, so replaying them teaches the model to produce more errors; and the
 * new user message must appear exactly once no matter how the caller passes it.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '@shared/constants'
import type { Message, Settings } from '@shared/types'

import { buildRequestBody } from '../ipc/chat.handlers'

const settings: Settings = { ...DEFAULT_SETTINGS, hasApiKey: true }

const message = (overrides: Partial<Message> & { id: string }): Message => ({
  role: 'user',
  content: 'hello',
  createdAt: '2026-08-26T00:00:00Z',
  ...overrides,
})

const build = (args: {
  systemPrompt?: string
  history?: Message[]
  content?: string
  settings?: Settings
}) => {
  const userMessage = message({ id: 'new', content: args.content ?? 'the new question' })
  return buildRequestBody({
    modelId: 'glm-4.7-flash',
    settings: args.settings ?? settings,
    systemPrompt: args.systemPrompt ?? '',
    history: args.history ?? [],
    userMessage,
  })
}

const roles = (body: Record<string, unknown>): string[] =>
  (body.messages as { role: string }[]).map((m) => m.role)

const contents = (body: Record<string, unknown>): string[] =>
  (body.messages as { content: string }[]).map((m) => m.content)

describe('the request envelope', () => {
  it('addresses the model by its catalog id', () => {
    // The proxy substitutes model_ref on the way out; the client always sends
    // the id the user chose (API-CONTRACT §2).
    expect(build({}).model).toBe('glm-4.7-flash')
  })

  it('carries the generation settings', () => {
    const body = build({
      settings: { ...settings, temperature: 0.2, topP: 0.5, maxTokens: 128 },
    })
    expect(body).toMatchObject({ temperature: 0.2, top_p: 0.5, max_tokens: 128, stream: true })
  })

  it('honours the streaming toggle', () => {
    expect(build({ settings: { ...settings, streamingEnabled: false } }).stream).toBe(false)
  })
})

describe('the system prompt', () => {
  it('leads when set', () => {
    const body = build({ systemPrompt: 'be brief' })
    expect(roles(body)).toEqual(['system', 'user'])
    expect(contents(body)[0]).toBe('be brief')
  })

  it('is omitted when empty', () => {
    expect(roles(build({ systemPrompt: '' }))).toEqual(['user'])
  })

  it('is omitted when only whitespace', () => {
    expect(roles(build({ systemPrompt: '   \n  ' }))).toEqual(['user'])
  })
})

describe('history', () => {
  it('is included oldest first, with the new message last', () => {
    const body = build({
      history: [
        message({ id: '1', role: 'user', content: 'first' }),
        message({ id: '2', role: 'assistant', content: 'second' }),
      ],
      content: 'third',
    })
    expect(contents(body)).toEqual(['first', 'second', 'third'])
    expect(roles(body)).toEqual(['user', 'assistant', 'user'])
  })

  it('excludes errored messages', () => {
    const body = build({
      history: [
        message({ id: '1', content: 'kept' }),
        message({
          id: '2',
          role: 'assistant',
          content: 'half an answer',
          error: { code: 'stream_stalled', message: 'stopped' },
        }),
      ],
    })
    expect(contents(body)).toEqual(['kept', 'the new question'])
  })

  it('excludes empty messages', () => {
    const body = build({
      history: [
        message({ id: '1', content: 'kept' }),
        message({ id: '2', role: 'assistant', content: '' }),
        message({ id: '3', role: 'assistant', content: '   ' }),
      ],
    })
    expect(contents(body)).toEqual(['kept', 'the new question'])
  })

  it('excludes stored system messages, so the prompt is not duplicated', () => {
    const body = build({
      systemPrompt: 'the real prompt',
      history: [message({ id: '1', role: 'system', content: 'a stale prompt' })],
    })
    expect(contents(body)).toEqual(['the real prompt', 'the new question'])
  })

  it('does not duplicate the new message when it is already in the history', () => {
    // It always is: main persists it before opening the request.
    const body = build({
      history: [
        message({ id: 'old', content: 'earlier' }),
        message({ id: 'new', content: 'the new question' }),
      ],
    })
    expect(contents(body)).toEqual(['earlier', 'the new question'])
  })

  it('keeps a stopped message — partial text is still context', () => {
    const body = build({
      history: [message({ id: '1', role: 'assistant', content: 'as far as I got', stopped: true })],
    })
    expect(contents(body)).toContain('as far as I got')
  })

  it('does no truncation, however long the history', () => {
    // MVP is deliberately not token-aware (SPEC §8.3); a context-length error is
    // surfaced verbatim rather than silently avoided by dropping turns.
    const history = Array.from({ length: 500 }, (_, i) =>
      message({ id: String(i), content: `turn ${i}` }),
    )
    expect((build({ history }).messages as unknown[]).length).toBe(501)
  })
})
