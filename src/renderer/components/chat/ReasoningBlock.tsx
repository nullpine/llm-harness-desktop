import { useState } from 'react'

import { formatSeconds } from '../../lib/format'
import { hasReasoning } from '../../lib/reasoning'

/**
 * The collapsed Thinking block (SPEC §8.2).
 *
 * `sseStream` already normalises vLLM's `delta.reasoning_content` and Ollama's
 * `delta.reasoning` into one kind, so this consumes plain text and never sees a
 * field name. Re-handling the spellings here would put backend knowledge in the
 * renderer, which is exactly what that normalisation exists to prevent.
 */
export function ReasoningBlock({
  text,
  streaming,
  seconds,
}: {
  text: string
  streaming: boolean
  seconds: number
}) {
  const [open, setOpen] = useState(false)
  if (!hasReasoning(text)) return null

  return (
    <div className="mb-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
      >
        <span aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`}>
          ▸
        </span>
        {/* Elapsed only once the stream ends; a ticking number mid-stream is noise. */}
        <span>{streaming ? 'Thinking…' : `Thinking (${formatSeconds(seconds)})`}</span>
      </button>
      {open ? (
        <p className="border-t border-[var(--color-border-subtle)] px-3 py-2 text-xs whitespace-pre-wrap text-[var(--color-text-muted)]">
          {text}
        </p>
      ) : null}
    </div>
  )
}
