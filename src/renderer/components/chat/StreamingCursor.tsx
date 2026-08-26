/** The block cursor on the message currently streaming (SPEC §8.2). */
export function StreamingCursor() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[0.15em] animate-pulse bg-[var(--color-text-primary)]"
    />
  )
}
