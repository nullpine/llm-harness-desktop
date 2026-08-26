import type { ReactNode } from 'react'

import { Button } from '../ui/Button'

interface TitleBarProps {
  onOpenSettings: () => void
  serverLabel: string
  connected: boolean
  /** The active model and its status pill. The dropdown itself is M3. */
  children?: ReactNode
}

export function TitleBar({ onOpenSettings, serverLabel, connected, children }: TitleBarProps) {
  return (
    <header className="titlebar-drag flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] pr-3 pl-20">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-semibold">LLM Harness</span>
        {children}
      </div>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: connected ? 'var(--color-success)' : 'var(--color-text-muted)' }}
        />
        <span className="text-xs text-[var(--color-text-muted)]">{serverLabel}</span>
        <Button variant="ghost" onClick={onOpenSettings}>
          Settings
        </Button>
      </div>
    </header>
  )
}
