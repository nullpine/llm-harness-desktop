import type { GpuInfo } from '@shared/types'

/**
 * Accelerator readout, when the server has one to report.
 *
 * Renders **nothing** for an empty array, which is the only case the local
 * Ollama path ever produces (`docs/BACKENDS.md` §2.1 — no `nvidia-smi`, and
 * unified memory is not worth modelling). A vLLM deployment populates it on the
 * first poll, so this exists to make that migration a config change rather than
 * a UI change.
 *
 * Returning null rather than an empty shell matters: the header must not gain a
 * gap, a separator or a shifted baseline just because a field came back empty.
 */
export function GpuIndicator({ gpus }: { gpus: GpuInfo[] }) {
  if (gpus.length === 0) return null

  return (
    <span data-testid="gpu-indicator" className="flex items-center gap-2">
      {gpus.map((gpu) => (
        <span
          key={gpu.index}
          data-testid={`gpu-${gpu.index}`}
          title={`${gpu.name} — ${formatGb(gpu.memoryUsedMb)} of ${formatGb(
            gpu.memoryTotalMb,
          )} used, ${gpu.utilizationPct}% utilisation`}
          className="flex items-center gap-1.5 rounded bg-[var(--color-surface-overlay)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]"
        >
          {/* A bar, because "41210 MB" is not a quantity anyone reads at a glance. */}
          <span
            aria-hidden
            className="h-1 w-8 overflow-hidden rounded-full bg-[var(--color-surface)]"
          >
            <span
              className="block h-full bg-[var(--color-accent)]"
              style={{ width: `${memoryPercent(gpu)}%` }}
            />
          </span>
          <span data-testid={`gpu-${gpu.index}-memory`} className="font-mono">
            {formatGb(gpu.memoryUsedMb)}/{formatGb(gpu.memoryTotalMb)}
          </span>
          <span data-testid={`gpu-${gpu.index}-util`}>{gpu.utilizationPct}%</span>
        </span>
      ))}
    </span>
  )
}

/** Percentage of a card's memory in use, clamped so a bad reading cannot overflow. */
export function memoryPercent(gpu: GpuInfo): number {
  if (gpu.memoryTotalMb <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((gpu.memoryUsedMb / gpu.memoryTotalMb) * 100)))
}

/** MB to GB, one decimal. The contract sends megabytes; nobody thinks in them. */
export function formatGb(megabytes: number): string {
  if (!Number.isFinite(megabytes) || megabytes < 0) return '0 GB'
  return `${(megabytes / 1024).toFixed(1)} GB`
}
