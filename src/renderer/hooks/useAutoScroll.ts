/**
 * Follow a stream, but only while the user is at the bottom (SPEC §8.2).
 *
 * The rule that makes this feel right: scrolling up is a deliberate act, and
 * yanking the view back down mid-read is the single most irritating thing a chat
 * UI can do. So following stops the moment the user leaves the bottom and
 * resumes only when they come back or press Jump to latest.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Slack for sub-pixel rounding and the last line's descenders. */
const BOTTOM_THRESHOLD_PX = 48

export interface AutoScroll {
  ref: React.RefObject<HTMLDivElement | null>
  /** True when the view is pinned to the bottom and following new content. */
  following: boolean
  scrollToBottom: (behavior?: ScrollBehavior) => void
  onScroll: () => void
}

export function useAutoScroll(dependency: unknown): AutoScroll {
  const ref = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = ref.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
    setFollowing(true)
  }, [])

  const onScroll = useCallback(() => {
    const element = ref.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    setFollowing(distance <= BOTTOM_THRESHOLD_PX)
  }, [])

  // New content arrived. Follow it only if the user has not scrolled away.
  useEffect(() => {
    if (!following) return
    const element = ref.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [dependency, following])

  return { ref, following, scrollToBottom, onScroll }
}
