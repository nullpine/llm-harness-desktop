/**
 * The CSP, and the gate that keeps the dev carve-out out of a packaged build.
 *
 * This is the test that would have caught the blank window. The policy has to be
 * loose enough for Vite's HMR preamble in dev and strict enough to satisfy SPEC
 * §5 when packaged, and the only thing allowed to switch between them is the
 * presence of a dev server URL.
 */

import { describe, expect, it } from 'vitest'

import { PACKAGED_CSP, contentSecurityPolicy } from '../window'

const DEV_URL = 'http://localhost:5173'

const directives = (policy: string): Map<string, string> =>
  new Map(
    policy.split(';').map((part) => {
      const [name, ...rest] = part.trim().split(/\s+/)
      return [name ?? '', rest.join(' ')]
    }),
  )

describe('the packaged policy (SPEC §5)', () => {
  it('is what the spec says', () => {
    const packaged = directives(PACKAGED_CSP)
    expect(packaged.get('default-src')).toBe("'self'")
    expect(packaged.get('img-src')).toBe("'self' data:")
    expect(packaged.get('style-src')).toBe("'self' 'unsafe-inline'")
  })

  it('allows no inline script', () => {
    expect(directives(PACKAGED_CSP).get('script-src')).toBe("'self'")
  })

  it('lets the renderer reach nothing on the network', () => {
    // ADR-0002: main owns network access. This is the backstop, not the rule.
    expect(directives(PACKAGED_CSP).get('connect-src')).toBe("'self'")
  })

  it('forbids objects, frames, a base tag and form posts', () => {
    const packaged = directives(PACKAGED_CSP)
    expect(packaged.get('object-src')).toBe("'none'")
    expect(packaged.get('frame-src')).toBe("'none'")
    expect(packaged.get('base-uri')).toBe("'none'")
    expect(packaged.get('form-action')).toBe("'none'")
  })
})

describe('the dev carve-out', () => {
  it("allows inline script, for Vite's react-refresh preamble", () => {
    expect(directives(contentSecurityPolicy(DEV_URL)).get('script-src')).toBe(
      "'self' 'unsafe-inline'",
    )
  })

  it('allows the dev server and its HMR websocket', () => {
    expect(directives(contentSecurityPolicy(DEV_URL)).get('connect-src')).toBe(
      `'self' ${DEV_URL} ws://localhost:5173`,
    )
  })

  it('loosens nothing else', () => {
    const dev = directives(contentSecurityPolicy(DEV_URL))
    const packaged = directives(PACKAGED_CSP)
    for (const [name, value] of dev) {
      if (name === 'script-src' || name === 'connect-src') continue
      expect(value).toBe(packaged.get(name))
    }
  })

  it('derives the websocket scheme from the dev server, including https', () => {
    expect(
      directives(contentSecurityPolicy('https://localhost:5173')).get('connect-src'),
    ).toContain('wss://localhost:5173')
  })

  it('uses the origin, not the whole URL', () => {
    expect(
      directives(contentSecurityPolicy('http://localhost:5173/some/path')).get('connect-src'),
    ).toBe("'self' http://localhost:5173 ws://localhost:5173")
  })
})

describe('the gate', () => {
  it.each([undefined, ''])('gives the strict policy when the dev URL is %j', (value) => {
    // A packaged build has no ELECTRON_RENDERER_URL, so it lands here. If this
    // ever loosened, a shipped app would accept inline script.
    expect(contentSecurityPolicy(value)).toBe(PACKAGED_CSP)
  })

  it('never lets a packaged build accept inline script', () => {
    expect(directives(contentSecurityPolicy(undefined)).get('script-src')).toBe("'self'")
  })
})
