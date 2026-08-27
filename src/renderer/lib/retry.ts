/**
 * When the transcript offers a Retry (SPEC §8.2).
 *
 * Deliberately independent of any live stream. `useChatStore.fail()` clears
 * `activeRequestId`, so the app's stream buffer is null exactly when a message
 * carries an error — gating on it made the button unreachable in the one case it
 * exists for, a stalled or failed reply.
 */

import type { Message } from '@shared/types'

export function offersRetry(message: Message): boolean {
  // Stopping is deliberate, so it is not a failure to retry.
  return message.error !== undefined && message.stopped !== true
}
