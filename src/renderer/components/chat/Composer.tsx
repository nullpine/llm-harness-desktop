import { useEffect, useRef, useState } from 'react'

import { Button } from '../ui/Button'

const MAX_ROWS = 12
const LINE_HEIGHT_PX = 21

export interface ComposerProps {
  /** Why sending is impossible right now, or null when it is possible. */
  disabledReason: string | null
  streaming: boolean
  placeholder: string
  onSend: (content: string) => void
  onStop: () => void
}

export function Composer({
  disabledReason,
  streaming,
  placeholder,
  onSend,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState('')
  const textarea = useRef<HTMLTextAreaElement>(null)

  // Autogrow to 12 lines, then scroll (SPEC §8.2).
  useEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_ROWS * LINE_HEIGHT_PX)}px`
  }, [value])

  const send = (): void => {
    const trimmed = value.trim()
    if (trimmed === '' || disabledReason || streaming) return
    onSend(trimmed)
    setValue('')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends, Shift+Enter newlines. IME composition must not send — an
    // in-progress candidate selection ends with Enter too.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-6 py-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {disabledReason ? (
          <p className="text-xs text-[var(--color-text-muted)]">{disabledReason}</p>
        ) : null}

        <div className="flex items-end gap-2">
          <textarea
            ref={textarea}
            rows={1}
            value={value}
            placeholder={placeholder}
            disabled={disabledReason !== null}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            className="flex-1 resize-none rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-3 py-2 leading-[21px] outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          />

          {streaming ? (
            // Stop replaces Send while streaming (SPEC §8.2).
            <Button variant="danger" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={send}
              disabled={disabledReason !== null || value.trim() === ''}
            >
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
