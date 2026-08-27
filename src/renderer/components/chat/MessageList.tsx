import type { Conversation, Message } from '@shared/types'

import { useAutoScroll } from '../../hooks/useAutoScroll'
import { offersRetry } from '../../lib/retry'
import { withDividers } from '../../lib/transcriptDividers'
import { thinkingSeconds, type StreamBuffer } from '../../stores/useChatStore'
import { JumpToLatest } from './JumpToLatest'
import { MessageBubble } from './MessageBubble'
import { ModelDivider } from './ModelDivider'

interface MessageListProps {
  conversation: Conversation
  stream: StreamBuffer | null
  modelLabel: string
  /** Catalog id -> display name, for message labels and dividers. */
  displayName: (modelId: string) => string
  onRetry: (prompt: string) => void
  onRegenerate: (prompt: string) => void
}

export function MessageList({
  conversation,
  stream,
  modelLabel,
  displayName,
  onRetry,
  onRegenerate,
}: MessageListProps) {
  const visible = conversation.messages.filter((m) => m.role !== 'system')

  // A live stream whose assistant message is not on disk yet needs a bubble of
  // its own; once main persists it, the real message takes over and this stops
  // being rendered. Keying on the request id keeps the two from double-rendering.
  const streamingUnpersisted = stream?.status === 'streaming' && !hasPendingAssistant(visible)

  const { ref, following, scrollToBottom, onScroll } = useAutoScroll(
    `${visible.length}:${stream?.content.length ?? 0}:${stream?.reasoning.length ?? 0}`,
  )

  const lastAssistantId = [...visible].reverse().find((m) => m.role === 'assistant')?.id ?? null

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {withDividers(visible).map((item, index) => {
            if (item.kind === 'divider') {
              return (
                <ModelDivider
                  key={`divider-${item.modelId}-${index}`}
                  label={displayName(item.modelId ?? '')}
                />
              )
            }

            const message = item.message
            if (!message) return null

            return (
              <MessageBubble
                key={message.id}
                message={message}
                streaming={streamingFor(message, stream)}
                // The model that produced *this* message, not whatever is active
                // now — after a switch the transcript must still say who said what.
                modelLabel={message.modelId ? displayName(message.modelId) : modelLabel}
                isLastAssistant={message.id === lastAssistantId}
                onRetry={
                  // Errored messages only — but *not* gated on a live stream.
                  // `fail()` clears activeRequestId, so `stream` is null exactly
                  // when a message has an error, which made this button
                  // unreachable in the one case it exists for (SPEC §8.2).
                  offersRetry(message)
                    ? () => onRetry(previousUserContent(visible, message))
                    : undefined
                }
                onRegenerate={
                  message.id === lastAssistantId
                    ? () => onRegenerate(previousUserContent(visible, message))
                    : undefined
                }
              />
            )
          })}

          {streamingUnpersisted && stream ? (
            <MessageBubble
              key={stream.requestId}
              message={{
                id: stream.requestId,
                role: 'assistant',
                content: '',
                createdAt: new Date(stream.startedAt).toISOString(),
              }}
              streaming={{
                content: stream.content,
                reasoning: stream.reasoning,
                seconds: thinkingSeconds(stream),
                active: true,
              }}
              modelLabel={modelLabel}
              isLastAssistant={false}
            />
          ) : null}
        </div>
      </div>

      {!following ? <JumpToLatest onClick={() => scrollToBottom('smooth')} /> : null}
    </div>
  )
}

/**
 * The live buffer for a persisted message, if that message is the one streaming.
 *
 * Matching is by position — the last assistant message — rather than by anything
 * in the stream, because the buffer is keyed by `requestId` and the message by
 * ulid; they are deliberately different namespaces.
 */
function streamingFor(message: Message, stream: StreamBuffer | null) {
  if (!stream || message.role !== 'assistant') return undefined
  const active = stream.status === 'streaming'
  return {
    content: stream.content,
    reasoning: stream.reasoning,
    seconds: thinkingSeconds(stream),
    active,
  }
}

function hasPendingAssistant(messages: Message[]): boolean {
  return messages.at(-1)?.role === 'assistant'
}

/** The prompt that produced a reply, so Retry and Regenerate can re-send it. */
function previousUserContent(messages: Message[], message: Message): string {
  const index = messages.findIndex((m) => m.id === message.id)
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = messages[i]
    if (candidate?.role === 'user') return candidate.content
  }
  return ''
}
