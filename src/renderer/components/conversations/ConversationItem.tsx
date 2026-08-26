import { useState } from 'react'

import type { ConversationSummary } from '@shared/types'

export interface ConversationItemProps {
  conversation: ConversationSummary
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}

export function ConversationItem({
  conversation,
  active,
  onSelect,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(conversation.title)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (renaming) {
    const commit = (): void => {
      setRenaming(false)
      if (draft.trim() !== '' && draft !== conversation.title) onRename(draft.trim())
    }
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(conversation.title)
            setRenaming(false)
          }
        }}
        className="w-full rounded-md border border-[var(--color-accent)] bg-[var(--color-surface-overlay)] px-2 py-1.5 text-sm outline-none"
      />
    )
  }

  return (
    <div
      className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
        active
          ? 'bg-[var(--color-surface-overlay)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-overlay)]'
      }`}
    >
      <button type="button" onClick={onSelect} className="flex-1 truncate text-left">
        {conversation.title}
      </button>

      {confirmingDelete ? (
        <span className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={onDelete}
            className="text-[var(--color-danger)]"
            aria-label={`Confirm delete ${conversation.title}`}
          >
            Delete
          </button>
          <button type="button" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setRenaming(true)}
            aria-label={`Rename ${conversation.title}`}
            className="px-1 text-xs hover:text-[var(--color-text-primary)]"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            aria-label={`Delete ${conversation.title}`}
            className="px-1 text-xs hover:text-[var(--color-danger)]"
          >
            ×
          </button>
        </span>
      )}
    </div>
  )
}
