/**
 * SSE parsing for `POST /v1/chat/completions`.
 *
 * The subtle failures this file exists to prevent, all of which look fine in a
 * happy-path test:
 *
 *  1. **Frames split across TCP reads.** A chunk boundary can land anywhere —
 *     mid-payload, mid-`\n\n`, even mid-UTF-8-character. Anything that assumes a
 *     read is a whole frame drops tokens under load and never under test.
 *  2. **Two spellings of reasoning.** vLLM sends `delta.reasoning_content`,
 *     Ollama sends `delta.reasoning`. Ollama is the local MVP path, so a parser
 *     that handles only vLLM's spelling silently drops every Thinking block
 *     against the backend you can actually run today.
 *  3. **Correlating by the frame's `model`.** Frames are relayed verbatim, so
 *     that field carries the *engine's* name (`glm-4.7-flash:q4_K_M`), not the
 *     catalog id that was requested (API-CONTRACT §2). This parser never reads
 *     it; callers correlate by `requestId`.
 *  4. **A stream that stops without ending.** No chunk for `SSE_IDLE_TIMEOUT_MS`
 *     is `stream_stalled`, not a hang.
 */

import { SSE_IDLE_TIMEOUT_MS } from '@shared/constants'
import { appError, type AppError } from '@shared/errors'
import type { FinishReason, MessageUsage } from '@shared/types'

export type SseEvent =
  | { type: 'delta'; kind: 'content' | 'reasoning'; text: string }
  | { type: 'done'; finishReason: FinishReason; usage?: MessageUsage }
  | { type: 'error'; error: AppError }

/** The `data:` payload shape we care about. Everything else passes by untouched. */
interface ChatChunkPayload {
  choices?: {
    delta?: {
      content?: string | null
      /** vLLM's spelling. */
      reasoning_content?: string | null
      /** Ollama's spelling. Same thing. */
      reasoning?: string | null
    }
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  } | null
}

const DONE_SENTINEL = '[DONE]'

/**
 * Incremental SSE frame assembler.
 *
 * Feed it whatever bytes arrive, in whatever sizes. It holds the partial tail
 * until a frame is complete, so callers never think about boundaries.
 */
export class SseParser {
  /** Everything received since the last complete frame. */
  private buffer = ''
  private sawDone = false

  /** Push one network chunk; get back the events it completed. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    return this.drain(false)
  }

  /**
   * The response body ended. Flush whatever is left.
   *
   * A well-behaved server ends with `data: [DONE]`, but a connection that closes
   * cleanly after a `finish_reason` is not an error either — so a trailing
   * frame without the sentinel is still parsed rather than discarded.
   */
  end(): SseEvent[] {
    return this.drain(true)
  }

  get finished(): boolean {
    return this.sawDone
  }

  private drain(atEnd: boolean): SseEvent[] {
    const events: SseEvent[] = []

    // Frames are separated by a blank line. Normalise CRLF first: a boundary can
    // split \r\n\r\n, and treating \r as content corrupts the last field.
    this.buffer = this.buffer.replace(/\r\n/g, '\n')

    let separator = this.buffer.indexOf('\n\n')
    while (separator !== -1) {
      const frame = this.buffer.slice(0, separator)
      this.buffer = this.buffer.slice(separator + 2)
      this.emit(frame, events)
      separator = this.buffer.indexOf('\n\n')
    }

    if (atEnd && this.buffer.trim() !== '') {
      // No trailing blank line. The body is over, so this is a whole frame.
      this.emit(this.buffer, events)
      this.buffer = ''
    }

    return events
  }

  private emit(rawFrame: string, out: SseEvent[]): void {
    if (this.sawDone) return

    // One frame may carry several `data:` lines; per the SSE spec they join with
    // newlines. Comments (`:`) and other fields (`event:`, `id:`) are ignored.
    const dataLines: string[] = []
    for (const line of rawFrame.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith(':')) continue
      const colon = trimmed.indexOf(':')
      if (colon === -1) continue
      if (trimmed.slice(0, colon) !== 'data') continue
      // Exactly one optional leading space after the colon is part of the
      // framing, not the payload; anything beyond that is.
      let value = trimmed.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      dataLines.push(value)
    }
    if (dataLines.length === 0) return

    const data = dataLines.join('\n').trim()
    if (data === '') return

    if (data === DONE_SENTINEL) {
      this.sawDone = true
      out.push({ type: 'done', finishReason: this.pendingFinishReason, ...this.pendingUsage() })
      return
    }

    let payload: ChatChunkPayload
    try {
      payload = JSON.parse(data) as ChatChunkPayload
    } catch {
      out.push({
        type: 'error',
        error: appError('malformed_response', 'the server sent a frame that is not JSON'),
      })
      return
    }

    const choice = payload.choices?.[0]
    const delta = choice?.delta

    if (typeof delta?.content === 'string' && delta.content !== '') {
      out.push({ type: 'delta', kind: 'content', text: delta.content })
    }

    // Both spellings, one kind. See the header note.
    const reasoning = delta?.reasoning_content ?? delta?.reasoning
    if (typeof reasoning === 'string' && reasoning !== '') {
      out.push({ type: 'delta', kind: 'reasoning', text: reasoning })
    }

    if (typeof choice?.finish_reason === 'string') {
      this.pendingFinishReason = normaliseFinishReason(choice.finish_reason)
    }
    if (payload.usage) {
      this.usage = {
        promptTokens: payload.usage.prompt_tokens ?? 0,
        completionTokens: payload.usage.completion_tokens ?? 0,
      }
    }
  }

  /**
   * `finish_reason` and `usage` arrive on the frame *before* `[DONE]`, so they
   * are held here until the sentinel closes the stream.
   */
  private pendingFinishReason: FinishReason = null
  private usage: MessageUsage | undefined

  private pendingUsage(): { usage?: MessageUsage } {
    return this.usage === undefined ? {} : { usage: this.usage }
  }
}

function normaliseFinishReason(value: string): FinishReason {
  return value === 'stop' || value === 'length' || value === 'content_filter' ? value : null
}

/**
 * Read a response body as SSE events, with an idle timeout between chunks.
 *
 * The timeout is per-chunk, never total: a long answer is not a hung one, but a
 * minute of silence is. On expiry the caller's `onIdleTimeout` runs — that is
 * where the underlying request gets aborted, since merely stopping the read
 * leaves the GPU generating (`.claude/rules/streaming-and-ipc.md`).
 */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
  options: { idleTimeoutMs?: number; onIdleTimeout?: () => void } = {},
): AsyncGenerator<SseEvent> {
  const idleTimeoutMs = options.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS
  const parser = new SseParser()
  const reader = body.getReader()
  // `stream: true` is what makes a multi-byte character split across two reads
  // decode correctly rather than becoming U+FFFD.
  const decoder = new TextDecoder('utf-8')

  try {
    for (;;) {
      const next = await withIdleTimeout(reader.read(), idleTimeoutMs)

      if (next === TIMED_OUT) {
        options.onIdleTimeout?.()
        yield {
          type: 'error',
          error: appError(
            'stream_stalled',
            `the response stopped mid-stream (no data for ${Math.round(idleTimeoutMs / 1000)}s)`,
          ),
        }
        return
      }

      if (next.done) {
        for (const event of parser.end()) yield event
        return
      }

      for (const event of parser.push(decoder.decode(next.value, { stream: true }))) {
        yield event
        if (event.type === 'done') return
      }
    }
  } finally {
    reader.releaseLock()
  }
}

const TIMED_OUT = Symbol('timed-out')

async function withIdleTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
