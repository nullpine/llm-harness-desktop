/**
 * Subscribe to a main→renderer event for the lifetime of a component.
 *
 * The listener is held in a ref so a caller passing an inline arrow does not
 * resubscribe on every render — which with a streaming event firing dozens of
 * times a second would mean tearing down and rebuilding the subscription
 * constantly.
 */

import { useEffect, useRef } from 'react'

import type { Unsubscribe } from '@shared/api'

export function useIpcEvent<Payload>(
  subscribe: (listener: (payload: Payload) => void) => Unsubscribe,
  listener: (payload: Payload) => void,
): void {
  const latest = useRef(listener)

  // Updated in an effect rather than during render: a ref write during render is
  // not safe under concurrent rendering, which may discard and replay a render.
  // Declared first, so it has run by the time the subscription below fires.
  useEffect(() => {
    latest.current = listener
  })

  // `subscribe` comes off `window.api`, which is frozen for the app's lifetime,
  // so this runs once per mount.
  useEffect(() => subscribe((payload) => latest.current(payload)), [subscribe])
}
