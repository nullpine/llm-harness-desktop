/**
 * Error copy (ARCHITECTURE.md), and acceptance **A12** in particular:
 * "Sending with no model active shows a clear 'no model loaded — pick one from
 * the dropdown' message, not a raw 409."
 *
 * The test that matters is the negative one: no raw code, and no HTTP status,
 * ever reaches the strings a person reads.
 */

import { describe, expect, it } from 'vitest'

import { SERVER_ERROR_CODES, appError } from '@shared/errors'

import { composerDisabledReason, errorCopy } from '../lib/errorCopy'

describe('A12: no model active', () => {
  it('reads as a sentence, not a code', () => {
    const copy = errorCopy(appError('model_not_active', 'raw server text'))
    expect(copy).toBe('No model is loaded — start the server or pick a model')
  })

  it('is what the composer explains when nothing is loaded', () => {
    expect(composerDisabledReason('idle', true, true)).toMatch(/no model is loaded/i)
  })

  it('never leaks the raw code or a status number', () => {
    const copy = composerDisabledReason('idle', true, true) ?? ''
    expect(copy).not.toContain('model_not_active')
    expect(copy).not.toContain('409')
  })
})

describe('every server error code has human copy', () => {
  it.each(SERVER_ERROR_CODES)('%s does not surface its own code', (code) => {
    const copy = errorCopy(appError(code, 'raw server text'))
    expect(copy).not.toBe('raw server text')
    expect(copy).not.toContain(code)
    expect(copy.length).toBeGreaterThan(10)
  })
})

describe('composerDisabledReason', () => {
  it('returns null when sending is possible', () => {
    expect(composerDisabledReason('ready', true, true)).toBeNull()
  })

  it('explains an unreachable server before anything else', () => {
    // Unreachable outranks state: "no model loaded" is misleading when the real
    // problem is that we cannot ask.
    expect(composerDisabledReason('idle', false, true)).toMatch(/can't reach the server/i)
  })

  it('explains a load in progress', () => {
    expect(composerDisabledReason('loading', true, true)).toMatch(/loading/i)
    expect(composerDisabledReason('stopping', true, true)).toMatch(/loading/i)
  })

  it('explains a failed load and points at the logs', () => {
    expect(composerDisabledReason('error', true, true)).toMatch(/server logs/i)
  })

  it('asks for a conversation when the server is fine but none is open', () => {
    expect(composerDisabledReason('ready', true, false)).toMatch(/new chat/i)
  })

  it('never returns a raw code for any state', () => {
    for (const state of ['idle', 'loading', 'ready', 'stopping', 'error', 'unreachable']) {
      const copy = composerDisabledReason(state, true, true) ?? ''
      expect(copy).not.toMatch(/model_not_active|model_loading|upstream_unavailable/)
    }
  })
})

describe('unknown codes fall back to the server message', () => {
  it('shows what the server said rather than nothing', () => {
    expect(errorCopy(appError('some_new_code', 'the server explained itself'))).toBe(
      'the server explained itself',
    )
  })
})
