/**
 * Human durations for the switch dialog and the loading banner.
 *
 * Nothing here invents a number. The only source of a load estimate is
 * `estimatedLoadSeconds` from the catalog, which the server measures on the
 * hardware in use (SPEC §8.1). A dialog that promises two minutes before a
 * ten-second wait teaches people to distrust every estimate the app gives.
 */

/**
 * Whether a switch involves no load at all.
 *
 * `0` is a real, honest value rather than a missing one: on the `remote_openai`
 * backend the weights are already resident in whatever is serving — a RunPod pod,
 * a hosted provider — so activation only verifies the model is offered and
 * returns. The catalog says 0 because nothing loads.
 *
 * Distinct from an *unknown* estimate, which `describeSeconds` renders. Without
 * this the dialog promises "about an unknown time" for something instantaneous,
 * which reads as a fault.
 */
export function loadsInstantly(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds === 0
}

export function describeSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'an unknown time'
  if (seconds < 60) return `${Math.round(seconds)} seconds`

  const minutes = Math.round(seconds / 60)
  if (seconds % 60 === 0 || minutes >= 3) {
    return minutes === 1 ? 'a minute' : `${minutes} minutes`
  }
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/** `0:07`, for a clock that is counting up. */
export function elapsedClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
