import { useEffect, useState } from 'react'

import type { ServerState } from '@shared/types'

import { elapsedClock } from '../../lib/duration'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

interface LoadingBannerProps {
  server: ServerState
  /** When the switch was requested, for the elapsed clock. */
  startedAt: number | null
  onViewLogs: () => void
}

/**
 * The strip above the composer during and after a switch.
 *
 * It has no timer of its own for *polling* — the state it renders arrives on
 * `models:stateChanged`, and the poller is already adaptive at 2 s while loading
 * (SPEC §9). The one interval here is a display clock, which is a different
 * thing: it makes the wait feel accounted for rather than frozen.
 */
export function LoadingBanner({ server, startedAt, onViewLogs }: LoadingBannerProps) {
  const failed = server.state === 'error'
  const loading = server.state === 'loading' || server.state === 'stopping'

  if (!failed && !loading) return null

  return failed ? (
    <div
      data-testid="load-banner"
      data-failed="true"
      className="flex items-center gap-3 border-t border-[var(--color-danger)] bg-[var(--color-danger)]/10 px-6 py-2 text-sm"
    >
      <span className="text-[var(--color-danger)]">✕</span>
      <span className="flex-1" data-testid="load-error">
        {server.lastError ?? 'The model failed to load.'}
      </span>
      <Button variant="ghost" onClick={onViewLogs} data-testid="view-server-logs">
        View server logs
      </Button>
    </div>
  ) : (
    <div
      data-testid="load-banner"
      data-failed="false"
      className="flex items-center gap-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-6 py-2 text-sm"
    >
      <Spinner />
      <span className="flex-1">
        {/* Rendered verbatim: the server is describing its own progress and the
            app has no business paraphrasing it. */}
        <span data-testid="load-hint">{server.progressHint ?? 'Loading the model…'}</span>
      </span>
      <ElapsedClock startedAt={startedAt} />
    </div>
  )
}

function ElapsedClock({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [startedAt])

  if (startedAt === null) return null
  return (
    <span data-testid="load-elapsed" className="font-mono text-xs text-[var(--color-text-muted)]">
      {elapsedClock(now - startedAt)}
    </span>
  )
}
