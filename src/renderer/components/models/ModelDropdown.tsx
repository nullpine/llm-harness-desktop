import { useEffect, useRef, useState } from 'react'

import type { ModelInfo, ServerState } from '@shared/types'

import { ModelStatusPill } from './ModelStatusPill'

interface ModelDropdownProps {
  models: ModelInfo[]
  server: ServerState
  /** Called with a *different* model. Picking the active one is a no-op. */
  onSelect: (model: ModelInfo) => void
  disabled?: boolean
}

export function ModelDropdown({ models, server, onSelect, disabled = false }: ModelDropdownProps) {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const active = models.find((model) => model.id === server.activeModelId) ?? null

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        data-testid="model-dropdown"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-[var(--color-surface-overlay)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="font-medium">{active?.displayName ?? 'No model'}</span>
        <ModelStatusPill server={server} />
        <span aria-hidden className="text-[var(--color-text-muted)]">
          ▾
        </span>
      </button>

      {open ? (
        <ul
          role="listbox"
          data-testid="model-list"
          className="absolute z-40 mt-1 w-80 overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] py-1 shadow-2xl"
        >
          {models.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
              The server reported no models.
            </li>
          ) : null}

          {models.map((model) => {
            const isActive = model.id === server.activeModelId
            return (
              <li key={model.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  data-testid={`model-option-${model.id}`}
                  onClick={() => {
                    setOpen(false)
                    // Selecting the active model is a no-op — no dialog, no
                    // pointless unload-and-reload of what is already serving.
                    if (!isActive) onSelect(model)
                  }}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-[var(--color-surface-overlay)]"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span aria-hidden className="w-3 text-[var(--color-accent)]">
                      {isActive ? '✓' : ''}
                    </span>
                    <span>{model.displayName}</span>
                    {!model.available ? (
                      <span
                        data-testid={`model-unavailable-${model.id}`}
                        title="The weights are not on the server yet"
                        className="rounded bg-[var(--color-surface-overlay)] px-1.5 text-[10px] text-[var(--color-text-muted)]"
                      >
                        not downloaded
                      </span>
                    ) : null}
                  </span>
                  {/* The engine's own name for the model. Secondary here, but it
                      is the first thing you want when something is wrong. */}
                  <span
                    title={model.modelRef}
                    className="pl-5 font-mono text-[11px] text-[var(--color-text-muted)]"
                  >
                    {model.modelRef}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
