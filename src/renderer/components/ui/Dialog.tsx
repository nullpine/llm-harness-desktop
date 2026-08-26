import { useEffect, useRef, type ReactNode } from 'react'

interface DialogProps {
  open: boolean
  title: string
  /** Omitted when the dialog must not be dismissed — see first run in SPEC §8.5. */
  onClose?: (() => void) | undefined
  children: ReactNode
  footer?: ReactNode
}

export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !onClose) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open) panel.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded px-2 text-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              ×
            </button>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
