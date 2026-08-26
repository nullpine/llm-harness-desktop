import { useEffect, useState } from 'react'

import type { LogsRequest } from '@shared/ipc'

import { errorCopy } from '../../lib/errorCopy'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Spinner } from '../ui/Spinner'

const SOURCES: LogsRequest['source'][] = ['vllm', 'control']

/**
 * The server's own logs, for when a load fails.
 *
 * The one place raw server output is shown deliberately — everywhere else the
 * UI renders friendly copy (ARCHITECTURE.md). Someone reading this is already
 * past "something went wrong" and needs the detail.
 */
export function ServerLogsModal({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<LogsRequest['source']>('vllm')

  return (
    <Dialog
      open
      title="Server logs"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-1 rounded-md bg-[var(--color-surface-overlay)] p-1">
          {SOURCES.map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`logs-source-${option}`}
              onClick={() => setSource(option)}
              className={`flex-1 rounded px-3 py-1 text-sm transition ${
                source === option
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        {/* Keyed on the source so switching tabs remounts rather than resetting
            state inside an effect, which is the cascading-render pattern. */}
        <LogPane key={source} source={source} />
      </div>
    </Dialog>
  )
}

function LogPane({ source }: { source: LogsRequest['source'] }) {
  const [lines, setLines] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.logs.fetch({ source, lines: 200 }).then((result) => {
      if (cancelled) return
      if (result.ok) setLines(result.value.lines)
      else setError(errorCopy(result.error))
    })
    return () => {
      cancelled = true
    }
  }, [source])

  if (error) return <p className="text-sm text-[var(--color-danger)]">{error}</p>
  if (lines === null) return <Spinner label="Fetching logs…" />

  return (
    <pre
      data-testid="server-logs"
      className="max-h-80 overflow-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
    >
      {lines.length ? lines.join('\n') : 'The server returned no log lines.'}
    </pre>
  )
}
