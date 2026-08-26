/**
 * SSE parsing, against fixture strings rather than the network.
 *
 * The interesting cases are all about *where the chunk boundary lands*. A parser
 * that assumes one read is one frame passes every happy-path test and drops
 * tokens the moment a response is big enough to be split.
 */

import { describe, expect, it, vi } from 'vitest'

import { SseParser, readSseStream, type SseEvent } from '../services/sseStream'

// --- fixtures ---------------------------------------------------------------

const frame = (payload: object): string => `data: ${JSON.stringify(payload)}\n\n`

const contentFrame = (text: string): string =>
  frame({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    // Present on purpose: the engine's name, not the catalog id. Nothing may read it.
    model: 'glm-4.7-flash:q4_K_M',
    choices: [{ index: 0, delta: { content: text } }],
  })

const vllmReasoningFrame = (text: string): string =>
  frame({ choices: [{ index: 0, delta: { reasoning_content: text } }] })

const ollamaReasoningFrame = (text: string): string =>
  frame({ choices: [{ index: 0, delta: { reasoning: text } }] })

const finishFrame = (reason = 'stop'): string =>
  frame({
    choices: [{ index: 0, delta: {}, finish_reason: reason }],
    usage: { prompt_tokens: 11, completion_tokens: 22 },
  })

const DONE = 'data: [DONE]\n\n'

/** Feed a whole stream one character at a time — the worst possible chunking. */
function parseByChar(stream: string): SseEvent[] {
  const parser = new SseParser()
  const events: SseEvent[] = []
  for (const ch of stream) events.push(...parser.push(ch))
  events.push(...parser.end())
  return events
}

function parseWhole(stream: string): SseEvent[] {
  const parser = new SseParser()
  const events = [...parser.push(stream)]
  events.push(...parser.end())
  return events
}

/** Split at an exact index, so a test can put the boundary somewhere specific. */
function parseSplitAt(stream: string, index: number): SseEvent[] {
  const parser = new SseParser()
  const events = [...parser.push(stream.slice(0, index)), ...parser.push(stream.slice(index))]
  events.push(...parser.end())
  return events
}

const textOf = (events: SseEvent[], kind: 'content' | 'reasoning'): string =>
  events
    .filter((e): e is Extract<SseEvent, { type: 'delta' }> => e.type === 'delta' && e.kind === kind)
    .map((e) => e.text)
    .join('')

// --- the happy path ---------------------------------------------------------

describe('SseParser', () => {
  it('parses a complete stream', () => {
    const events = parseWhole(contentFrame('Hel') + contentFrame('lo') + finishFrame() + DONE)

    expect(textOf(events, 'content')).toBe('Hello')
    const done = events.at(-1)
    expect(done).toEqual({
      type: 'done',
      finishReason: 'stop',
      usage: { promptTokens: 11, completionTokens: 22 },
    })
  })

  it('reports a done event even with no usage', () => {
    const events = parseWhole(contentFrame('hi') + DONE)
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: null })
  })

  it('ignores everything after [DONE]', () => {
    const events = parseWhole(DONE + contentFrame('should not appear'))
    expect(textOf(events, 'content')).toBe('')
  })
})

// --- chunk boundaries: the reason this file exists --------------------------

describe('chunk boundaries', () => {
  const stream = contentFrame('Hel') + contentFrame('lo') + finishFrame() + DONE

  it('survives a boundary in the middle of a data: payload', () => {
    // Land it inside the JSON of the first frame.
    const index = stream.indexOf('Hel') + 1
    expect(textOf(parseSplitAt(stream, index), 'content')).toBe('Hello')
  })

  it('survives a boundary in the middle of the blank-line separator', () => {
    const index = stream.indexOf('\n\n') + 1
    expect(textOf(parseSplitAt(stream, index), 'content')).toBe('Hello')
  })

  it('survives a boundary right after "data:" but before the payload', () => {
    const index = stream.indexOf('data:') + 'data:'.length
    expect(textOf(parseSplitAt(stream, index), 'content')).toBe('Hello')
  })

  it('survives every possible boundary', () => {
    for (let i = 1; i < stream.length; i += 1) {
      expect(textOf(parseSplitAt(stream, i), 'content')).toBe('Hello')
    }
  })

  it('survives being fed one character at a time', () => {
    const events = parseByChar(stream)
    expect(textOf(events, 'content')).toBe('Hello')
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' })
  })

  it('handles several frames arriving in one read', () => {
    expect(textOf(parseWhole(contentFrame('a') + contentFrame('b') + DONE), 'content')).toBe('ab')
  })

  it('handles CRLF line endings, including a split inside \\r\\n\\r\\n', () => {
    const crlf = (contentFrame('a') + contentFrame('b') + DONE).replace(/\n/g, '\r\n')
    for (let i = 1; i < crlf.length; i += 1) {
      expect(textOf(parseSplitAt(crlf, i), 'content')).toBe('ab')
    }
  })
})

// --- reasoning: both spellings, one kind ------------------------------------

describe('reasoning', () => {
  it('emits delta.reasoning_content (vLLM) as reasoning', () => {
    expect(textOf(parseWhole(vllmReasoningFrame('think') + DONE), 'reasoning')).toBe('think')
  })

  it('emits delta.reasoning (Ollama) as reasoning', () => {
    // Ollama is the local MVP path, so this is the spelling that actually fires.
    expect(textOf(parseWhole(ollamaReasoningFrame('think') + DONE), 'reasoning')).toBe('think')
  })

  it('treats the two spellings as interchangeable within one stream', () => {
    const stream = vllmReasoningFrame('a') + ollamaReasoningFrame('b') + DONE
    expect(textOf(parseWhole(stream), 'reasoning')).toBe('ab')
  })

  it('keeps reasoning and content apart', () => {
    const stream = ollamaReasoningFrame('why') + contentFrame('answer') + DONE
    const events = parseWhole(stream)
    expect(textOf(events, 'reasoning')).toBe('why')
    expect(textOf(events, 'content')).toBe('answer')
  })

  it('emits both when a single delta carries content and reasoning', () => {
    const stream = frame({ choices: [{ delta: { content: 'c', reasoning: 'r' } }] }) + DONE
    const events = parseWhole(stream)
    expect(textOf(events, 'content')).toBe('c')
    expect(textOf(events, 'reasoning')).toBe('r')
  })
})

// --- nothing reads the frame's model ----------------------------------------

describe('correlation', () => {
  it('never surfaces the frame model field', () => {
    // Contract §2: frames are verbatim, so `model` is the engine's name for the
    // model, not the catalog id the client asked for. Correlate by requestId.
    const events = parseWhole(contentFrame('hi') + DONE)
    expect(JSON.stringify(events)).not.toContain('glm-4.7-flash')
  })

  it('parses a frame with no model field at all', () => {
    const events = parseWhole(frame({ choices: [{ delta: { content: 'hi' } }] }) + DONE)
    expect(textOf(events, 'content')).toBe('hi')
  })
})

// --- malformed and edge-case input ------------------------------------------

describe('robustness', () => {
  it('reports non-JSON as malformed_response rather than throwing', () => {
    const events = parseWhole('data: {not json\n\n')
    expect(events).toEqual([
      { type: 'error', error: expect.objectContaining({ code: 'malformed_response' }) },
    ])
  })

  it('ignores SSE comments and non-data fields', () => {
    const stream = `: keep-alive\n\nevent: ping\nid: 7\n\n${contentFrame('hi')}${DONE}`
    expect(textOf(parseWhole(stream), 'content')).toBe('hi')
  })

  it('joins multi-line data fields', () => {
    const payload = JSON.stringify({ choices: [{ delta: { content: 'multi' } }] })
    const half = Math.floor(payload.length / 2)
    const stream = `data: ${payload.slice(0, half)}\ndata: ${payload.slice(half)}\n\n${DONE}`
    expect(textOf(parseWhole(stream), 'content')).toBe('multi')
  })

  it('preserves leading spaces beyond the one framing space', () => {
    const stream = frame({ choices: [{ delta: { content: '  indented' } }] }) + DONE
    expect(textOf(parseWhole(stream), 'content')).toBe('  indented')
  })

  it('skips empty deltas rather than emitting empty chunks', () => {
    const stream = frame({ choices: [{ delta: { content: '' } }] }) + contentFrame('x') + DONE
    expect(parseWhole(stream).filter((e) => e.type === 'delta')).toHaveLength(1)
  })

  it('tolerates a null delta content', () => {
    const stream = frame({ choices: [{ delta: { content: null } }] }) + DONE
    expect(parseWhole(stream).filter((e) => e.type === 'delta')).toHaveLength(0)
  })

  it('parses a trailing frame that never got its blank line', () => {
    const parser = new SseParser()
    const events = [...parser.push(contentFrame('a') + 'data: [DONE]')]
    events.push(...parser.end())
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('reports finished only after [DONE]', () => {
    const parser = new SseParser()
    parser.push(contentFrame('a'))
    expect(parser.finished).toBe(false)
    parser.push(DONE)
    expect(parser.finished).toBe(true)
  })
})

// --- the stream reader ------------------------------------------------------

function streamOf(chunks: string[], delayMs = 0): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      controller.enqueue(encoder.encode(chunks[i]!))
      i += 1
    },
  })
}

describe('readSseStream', () => {
  it('yields events as chunks arrive', async () => {
    const events: SseEvent[] = []
    for await (const event of readSseStream(
      streamOf([contentFrame('Hel'), contentFrame('lo'), finishFrame(), DONE]),
    )) {
      events.push(event)
    }
    expect(textOf(events, 'content')).toBe('Hello')
    expect(events.at(-1)).toMatchObject({ type: 'done', finishReason: 'stop' })
  })

  it('decodes a multi-byte character split across two reads', async () => {
    // "→" is three bytes; cut it in half so a naive decode would produce U+FFFD.
    const bytes = new TextEncoder().encode(contentFrame('a→b') + DONE)
    const cut = bytes.indexOf(0xe2) + 1
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut))
        controller.enqueue(bytes.slice(cut))
        controller.close()
      },
    })
    const events: SseEvent[] = []
    for await (const event of readSseStream(stream)) events.push(event)
    expect(textOf(events, 'content')).toBe('a→b')
  })

  it('emits stream_stalled and calls onIdleTimeout when chunks stop', async () => {
    const onIdleTimeout = vi.fn()
    const stalling = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(contentFrame('hi')))
        // ...and then never anything else, and never closes.
      },
    })

    const events: SseEvent[] = []
    for await (const event of readSseStream(stalling, { idleTimeoutMs: 30, onIdleTimeout })) {
      events.push(event)
    }

    expect(onIdleTimeout).toHaveBeenCalledOnce()
    expect(events.at(-1)).toEqual({
      type: 'error',
      error: expect.objectContaining({ code: 'stream_stalled', retryable: true }),
    })
  })

  it('does not time out a slow but live stream', async () => {
    const events: SseEvent[] = []
    for await (const event of readSseStream(streamOf([contentFrame('a'), DONE], 20), {
      idleTimeoutMs: 200,
    })) {
      events.push(event)
    }
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('ends cleanly when the body closes without [DONE]', async () => {
    const events: SseEvent[] = []
    for await (const event of readSseStream(streamOf([contentFrame('a'), finishFrame()]))) {
      events.push(event)
    }
    expect(textOf(events, 'content')).toBe('a')
  })
})
