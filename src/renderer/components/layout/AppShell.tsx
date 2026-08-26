import type { ReactNode } from 'react'

/**
 * The frame: title bar on top, one main pane below.
 *
 * The sidebar and the chat pane are M2. M1 deliberately shows an empty state
 * rather than a disabled-looking chat window, so the app never implies a feature
 * that is not there yet.
 */
export function AppShell({ titleBar, children }: { titleBar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-[var(--color-surface)]">
      {titleBar}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  )
}

export function EmptyMainPane({ hint }: { hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="text-[var(--color-text-muted)]">{hint}</p>
      <p className="text-xs text-[var(--color-text-muted)] opacity-70">
        Chat arrives in the next milestone.
      </p>
    </div>
  )
}
