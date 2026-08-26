import type { Conversation } from '@shared/types'
import type { ServerState } from '@shared/types'

import { composerDisabledReason } from '../../lib/errorCopy'
import type { StreamBuffer } from '../../stores/useChatStore'
import { Composer } from './Composer'
import { MessageList } from './MessageList'

interface ChatPaneProps {
  conversation: Conversation | null
  stream: StreamBuffer | null
  server: ServerState
  modelLabel: string
  onSend: (content: string) => void
  onStop: () => void
}

export function ChatPane({
  conversation,
  stream,
  server,
  modelLabel,
  onSend,
  onStop,
}: ChatPaneProps) {
  const disabledReason = composerDisabledReason(
    server.state,
    server.reachable,
    conversation !== null,
  )
  const streaming = stream?.status === 'streaming'

  return (
    <section className="flex h-full flex-col">
      {conversation ? (
        <MessageList
          conversation={conversation}
          stream={stream}
          modelLabel={modelLabel}
          onRetry={onSend}
          onRegenerate={onSend}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <p className="text-[var(--color-text-muted)]">
            Start a new chat to send your first message.
          </p>
        </div>
      )}

      <Composer
        disabledReason={disabledReason}
        streaming={streaming}
        placeholder={`Message ${modelLabel}…`}
        onSend={onSend}
        onStop={onStop}
      />
    </section>
  )
}
