/**
 * The server URL policy (SPEC §8.4).
 *
 * `validateServerUrl` and `normaliseBaseUrl` are two views of one rule — the
 * form's explanation and the client's enforcement — so most of what matters here
 * is that they never disagree.
 */

import { describe, expect, it } from 'vitest'

import { isLoopbackHost, normaliseBaseUrl, validateServerUrl } from '../serverUrl'

describe('validateServerUrl', () => {
  it('accepts https', () => {
    expect(validateServerUrl('https://harness.example.com')).toEqual({ valid: true, error: null })
  })

  it('accepts http on loopback for local development', () => {
    expect(validateServerUrl('http://localhost:8080').valid).toBe(true)
    expect(validateServerUrl('http://127.0.0.1:8787').valid).toBe(true)
  })

  it('rejects http to a remote host and says why', () => {
    const result = validateServerUrl('http://harness.example.com')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/localhost/i)
  })

  it('prompts rather than complains when the field is empty', () => {
    expect(validateServerUrl('   ').error).toMatch(/enter/i)
  })

  it('rejects nonsense and other schemes', () => {
    expect(validateServerUrl('not a url').valid).toBe(false)
    expect(validateServerUrl('example.com').valid).toBe(false)
    expect(validateServerUrl('file:///etc/passwd').valid).toBe(false)
    expect(validateServerUrl('ws://localhost:8080').valid).toBe(false)
  })

  it('tolerates surrounding whitespace', () => {
    expect(validateServerUrl('  https://harness.example.com  ').valid).toBe(true)
  })
})

describe('normaliseBaseUrl', () => {
  it('strips the trailing slash so callers can append a path', () => {
    expect(normaliseBaseUrl('https://harness.example.com/')).toBe('https://harness.example.com')
    expect(normaliseBaseUrl('  https://harness.example.com  ')).toBe('https://harness.example.com')
  })

  it('keeps a base path', () => {
    expect(normaliseBaseUrl('https://example.com/harness/')).toBe('https://example.com/harness')
  })

  it('returns null for anything the policy forbids', () => {
    expect(normaliseBaseUrl('http://harness.example.com')).toBeNull()
    expect(normaliseBaseUrl('ftp://example.com')).toBeNull()
    expect(normaliseBaseUrl('')).toBeNull()
  })
})

describe('the form and the client agree', () => {
  const cases = [
    'https://harness.example.com',
    'https://harness.example.com/',
    'https://example.com/harness/',
    'http://localhost:8080',
    'http://127.0.0.1:8787',
    'http://[::1]:8787',
    'http://harness.example.com',
    'ftp://example.com',
    'file:///etc/passwd',
    'not a url',
    'example.com',
    '',
    '   ',
  ]

  it.each(cases)('%j is judged the same by both', (input) => {
    // The form must never accept a URL the client will refuse to call, and never
    // reject one it would happily use.
    expect(validateServerUrl(input).valid).toBe(normaliseBaseUrl(input) !== null)
  })
})

describe('isLoopbackHost', () => {
  it('knows the loopback names', () => {
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('harness.example.com')).toBe(false)
  })
})
