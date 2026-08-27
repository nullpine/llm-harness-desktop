/**
 * When the Retry button exists (SPEC §8.2).
 *
 * It used to be gated on `message.error && stream` — a live stream buffer. But
 * `useChatStore.fail()` clears `activeRequestId`, so the app's `stream` is null
 * exactly when a message carries an error. The button was therefore unreachable
 * in the only situation it is for, including after a `stream_stalled`.
 */

import { describe, expect, it } from 'vitest'

import type { Message } from '@shared/types'

import { offersRetry } from '../lib/retry'

const base: Message = {
  id: 'a1',
  role: 'assistant',
  content: '',
  createdAt: '2026-08-27T00:00:00Z',
}

describe('offersRetry', () => {
  it('offers Retry on a stalled stream', () => {
    // The 60 s idle timeout produces exactly this.
    expect(
      offersRetry({
        ...base,
        content: 'half an ans',
        error: { code: 'stream_stalled', message: 'the response stopped mid-stream' },
      }),
    ).toBe(true)
  })

  it('offers Retry on an upstream failure', () => {
    expect(
      offersRetry({
        ...base,
        error: { code: 'upstream_unavailable', message: 'no backend' },
      }),
    ).toBe(true)
  })

  it('does not offer Retry on a healthy reply', () => {
    expect(offersRetry({ ...base, content: 'a complete answer' })).toBe(false)
  })

  it('does not offer Retry on a reply the user stopped', () => {
    // Stopping is deliberate; the user can send again if they want more.
    expect(offersRetry({ ...base, content: 'as far as I got', stopped: true })).toBe(false)
  })

  it('does not depend on a live stream', () => {
    // The whole bug: after fail(), there is no live stream to depend on.
    const errored: Message = { ...base, error: { code: 'internal', message: 'boom' } }
    expect(offersRetry(errored)).toBe(true)
  })
})
