import type { Conversation } from '@shared/types'
import type { ServerState } from '@shared/types'

import { DamagedConversation } from '../conversations/DamagedConversation'
import { composerDisabledReason } from '../../lib/errorCopy'
import type { StreamBuffer } from '../../stores/useChatStore'
import { Composer } from './Composer'
import { MessageList } from './MessageList'

interface ChatPaneProps {
  conversation: Conversation | null
  /** Set when the selected conversation's file would not parse (A10). */
  damagedId: string | null
  onForget: () => void
  stream: StreamBuffer | null
  server: ServerState
  modelLabel: string
  displayName: (modelId: string) => string
  /** The load banner and its failure path sit between transcript and composer. */
  banner: React.ReactNode
  onSend: (content: string) => void
  onStop: () => void
}

export function ChatPane({
  conversation,
  damagedId,
  onForget,
  stream,
  server,
  modelLabel,
  displayName,
  banner,
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
      {damagedId ? (
        <DamagedConversation onForget={onForget} />
      ) : conversation ? (
        <MessageList
          conversation={conversation}
          stream={stream}
          modelLabel={modelLabel}
          displayName={displayName}
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

      {banner}

      <Composer
        disabledReason={disabledReason}
        streaming={streaming}
        placeholder={
          // `Message no model…` is what the naive template produced when the
          // fallback display name got substituted.
          server.activeModelId ? `Message ${modelLabel}…` : 'No model available'
        }
        onSend={onSend}
        onStop={onStop}
      />
    </section>
  )
}
