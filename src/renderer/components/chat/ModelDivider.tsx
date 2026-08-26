/** `— switched to Qwen 3.8 27B —` in the transcript (SPEC §8.1). */
export function ModelDivider({ label }: { label: string }) {
  return (
    <div
      data-testid="model-divider"
      className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]"
    >
      <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
      <span>— switched to {label} —</span>
      <span className="h-px flex-1 bg-[var(--color-border-subtle)]" />
    </div>
  )
}
