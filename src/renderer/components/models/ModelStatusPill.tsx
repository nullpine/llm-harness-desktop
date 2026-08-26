import type { ServerState } from '@shared/types'

/**
 * The status dot beside the model name (SPEC §8.1).
 *
 * The dropdown itself is M3. M1 and M2 show the active model as static text with
 * this pill, because the state still has to be visible — a disabled composer with
 * no explanation is worse than no composer.
 */
const STYLES: Record<string, { color: string; label: string; pulse?: boolean }> = {
  ready: { color: 'var(--color-success)', label: 'ready' },
  loading: { color: '#f5a524', label: 'loading', pulse: true },
  stopping: { color: '#f5a524', label: 'switching', pulse: true },
  idle: { color: 'var(--color-text-muted)', label: 'idle' },
  error: { color: 'var(--color-danger)', label: 'error' },
  unreachable: { color: 'var(--color-text-muted)', label: 'unreachable' },
}

export function ModelStatusPill({ server }: { server: ServerState }) {
  const style = STYLES[server.state] ?? STYLES.idle
  if (!style) return null

  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${style.pulse ? 'animate-pulse' : ''}`}
        style={{ background: style.color }}
      />
      <span>{style.label}</span>
      {server.progressHint ? <span className="italic">· {server.progressHint}</span> : null}
    </span>
  )
}
