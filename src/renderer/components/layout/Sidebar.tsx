import type { ConversationSummary } from '@shared/types'

import { ConversationList } from '../conversations/ConversationList'
import { Button } from '../ui/Button'

interface SidebarProps {
  summaries: ConversationSummary[]
  activeId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]">
      <div className="p-2">
        <Button variant="secondary" onClick={props.onNew} className="w-full">
          + New chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <ConversationList
          summaries={props.summaries}
          activeId={props.activeId}
          onSelect={props.onSelect}
          onRename={props.onRename}
          onDelete={props.onDelete}
        />
      </div>
    </aside>
  )
}
