import type { ConversationSummary } from '@shared/types'

import { groupConversations } from '../../lib/groupConversations'
import { ConversationItem } from './ConversationItem'

interface ConversationListProps {
  summaries: ConversationSummary[]
  activeId: string | null
  damagedIds: string[]
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

export function ConversationList({
  summaries,
  activeId,
  damagedIds,
  onSelect,
  onRename,
  onDelete,
}: ConversationListProps) {
  const groups = groupConversations(summaries)

  if (groups.length === 0) {
    return <p className="px-2 py-4 text-xs text-[var(--color-text-muted)]">No conversations yet.</p>
  }

  return (
    <nav className="flex flex-col gap-4" aria-label="Conversations">
      {groups.map((group) => (
        <section key={group.label} className="flex flex-col gap-0.5">
          <h2 className="px-2 py-1 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            {group.label}
          </h2>
          {group.conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              damaged={damagedIds.includes(conversation.id)}
              onSelect={() => onSelect(conversation.id)}
              onRename={(title) => onRename(conversation.id, title)}
              onDelete={() => onDelete(conversation.id)}
            />
          ))}
        </section>
      ))}
    </nav>
  )
}
