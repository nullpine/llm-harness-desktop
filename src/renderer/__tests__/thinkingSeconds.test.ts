/**
 * The Thinking label's elapsed time.
 *
 * It read "Thinking (0.0s)" on every finished reply, including one that spent
 * its entire 512-token budget reasoning. Two separate causes, both covered here:
 * the window being measured was wrong, and the number was read from a buffer
 * that is unreachable once the stream ends.
 */

import { describe, expect, it } from 'vitest'

import { thinkingSeconds, type StreamBuffer } from '../stores/useChatStore'

const T0 = 1_000_000

const buffer = (overrides: Partial<StreamBuffer> = {}): StreamBuffer => ({
  requestId: 'r1',
  conversationId: 'c1',
  content: '',
  reasoning: '',
  status: 'streaming',
  error: null,
  finishReason: null,
  usage: undefined,
  startedAt: T0,
  endedAt: null,
  firstReasoningAt: null,
  firstContentAt: null,
  prompt: 'hi',
  ...overrides,
})

describe('thinkingSeconds', () => {
  it('measures first reasoning chunk to first content chunk', () => {
    const stream = buffer({
      reasoning: 'thinking...',
      firstReasoningAt: T0 + 500,
      firstContentAt: T0 + 3_500,
    })
    // Not 3.5 s: the half second before reasoning began is not thinking time.
    expect(thinkingSeconds(stream)).toBe(3)
  })

  it('measures to the end of the stream when no content ever arrives', () => {
    // The 512-token case: the whole budget went on reasoning, no answer at all.
    const stream = buffer({
      reasoning: 'a very long think',
      firstReasoningAt: T0 + 100,
      firstContentAt: null,
      endedAt: T0 + 9_100,
      status: 'done',
    })
    expect(thinkingSeconds(stream)).toBe(9)
  })

  it('is zero when no reasoning ever arrived', () => {
    const stream = buffer({ content: 'straight to the answer', firstContentAt: T0 + 200 })
    expect(thinkingSeconds(stream)).toBe(0)
  })

  it('does not count the time spent writing the answer', () => {
    const short = buffer({ firstReasoningAt: T0, firstContentAt: T0 + 1_000, endedAt: T0 + 60_000 })
    expect(thinkingSeconds(short)).toBe(1)
  })

  it('never goes negative on out-of-order timestamps', () => {
    const stream = buffer({ firstReasoningAt: T0 + 5_000, firstContentAt: T0 })
    expect(thinkingSeconds(stream)).toBe(0)
  })

  it('counts up while reasoning is still arriving', () => {
    const stream = buffer({ firstReasoningAt: Date.now() - 2_000 })
    expect(thinkingSeconds(stream)).toBeGreaterThan(1.5)
  })
})
