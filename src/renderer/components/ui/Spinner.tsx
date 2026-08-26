export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[var(--color-text-muted)]">
      <span
        aria-hidden
        className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      {label ? <span>{label}</span> : null}
    </span>
  )
}
