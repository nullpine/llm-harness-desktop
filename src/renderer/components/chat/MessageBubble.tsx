import { useState } from 'react'

import type { Message } from '@shared/types'

import { errorCopy } from '../../lib/errorCopy'
import { formatSeconds, formatTime } from '../../lib/format'
import { Button } from '../ui/Button'
import { MarkdownContent } from './MarkdownContent'
import { ReasoningBlock } from './ReasoningBlock'
import { StreamingCursor } from './StreamingCursor'

export interface MessageBubbleProps {
  message: Message
  /** Live text, when this bubble is the one currently streaming. */
  streaming?:
    | {
        content: string
        reasoning: string
        seconds: number
        active: boolean
      }
    | undefined
  modelLabel: string
  isLastAssistant: boolean
  onRetry?: (() => void) | undefined
  onRegenerate?: (() => void) | undefined
}

export function MessageBubble({
  message,
  streaming,
  modelLabel,
  isLastAssistant,
  onRetry,
  onRegenerate,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  const content = streaming?.active ? streaming.content : message.content
  const reasoning = streaming?.active ? streaming.reasoning : (message.reasoning ?? '')

  const copy = (): void => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <article
      className={`group flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
      aria-label={isUser ? 'Your message' : 'Assistant message'}
    >
      <header className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span>{isUser ? 'You' : modelLabel}</span>
        {message.createdAt ? <span>{formatTime(message.createdAt)}</span> : null}
        {message.stopped ? <span className="italic">stopped</span> : null}
      </header>

      <div
        className={`max-w-[46rem] rounded-xl px-4 py-3 ${
          isUser
            ? 'bg-[var(--color-accent)] text-white'
            : 'border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]'
        }`}
      >
        {!isUser ? (
          <ReasoningBlock
            text={reasoning}
            streaming={streaming?.active ?? false}
            seconds={streaming?.seconds ?? 0}
          />
        ) : null}

        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <>
            <MarkdownContent text={content} streaming={streaming?.active ?? false} />
            {streaming?.active ? <StreamingCursor /> : null}
          </>
        )}

        {message.error ? (
          <div className="mt-2 flex items-center gap-3 rounded-md border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {/* Friendly copy, never the raw code — ARCHITECTURE.md. */}
            <span>{errorCopy({ ...message.error, retryable: true })}</span>
            {onRetry ? (
              <Button variant="ghost" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="flex items-center gap-2 text-xs opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={copy}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        {isLastAssistant && onRegenerate ? (
          <button
            type="button"
            onClick={onRegenerate}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            Regenerate
          </button>
        ) : null}
        {message.usage ? (
          <span className="text-[var(--color-text-muted)]">
            {message.usage.completionTokens} tokens
          </span>
        ) : null}
        {streaming && !streaming.active && streaming.seconds > 0 ? (
          <span className="text-[var(--color-text-muted)]">{formatSeconds(streaming.seconds)}</span>
        ) : null}
      </footer>
    </article>
  )
}
