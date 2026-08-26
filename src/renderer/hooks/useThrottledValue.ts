/**
 * Hold a fast-changing value at a fixed cadence.
 *
 * This is the single biggest performance trap in the milestone (CLAUDE.md):
 * `react-markdown` re-parses the whole message on every change, and a stream
 * produces dozens of changes a second. At 60 ms the text still looks continuous
 * and the parse runs ~16 times a second instead of ~60.
 *
 * The trailing edge matters — the final token must land even if it arrives inside
 * a throttle window, or the last word of every reply goes missing until something
 * else re-renders.
 */

import { useEffect, useRef, useState } from 'react'

import { STREAM_RENDER_THROTTLE_MS } from '@shared/constants'

export function useThrottledValue<T>(value: T, intervalMs = STREAM_RENDER_THROTTLE_MS): T {
  const [visible, setVisible] = useState(value)
  const lastEmitted = useRef(0)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const elapsed = Date.now() - lastEmitted.current

    if (elapsed >= intervalMs) {
      lastEmitted.current = Date.now()
      setVisible(value)
      return
    }

    // Inside the window: schedule the trailing edge and let a newer value
    // replace it if one arrives first.
    if (pending.current) clearTimeout(pending.current)
    pending.current = setTimeout(() => {
      lastEmitted.current = Date.now()
      setVisible(value)
    }, intervalMs - elapsed)

    return () => {
      if (pending.current) clearTimeout(pending.current)
    }
  }, [value, intervalMs])

  return visible
}
