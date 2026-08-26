/**
 * The server URL policy: https, or http on loopback for local development.
 *
 * One implementation, used by both sides. The Settings form needs it to explain
 * the rule to a person (SPEC §8.4) and `harnessClient` needs it to enforce the
 * rule at the point of use — a settings file can be hand-edited, so the form is
 * not a security boundary. Two copies of this drift, and the failure mode is a
 * URL the form accepts and the client silently refuses to call.
 */

export interface UrlValidation {
  valid: boolean
  error: string | null
}

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

/**
 * The origin to send requests to, or null if this URL is not allowed.
 *
 * Returns the origin plus any base path, with no trailing slash, so callers can
 * append `/v1/chat/completions` without thinking about it.
 */
export function normaliseBaseUrl(raw: string): string | null {
  const url = parse(raw)
  if (!url) return null
  if (url.protocol === 'https:') return stripTrailingSlash(url)
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return stripTrailingSlash(url)
  return null
}

/** The same rule, with an explanation attached for the Settings form. */
export function validateServerUrl(raw: string): UrlValidation {
  if (raw.trim() === '') return { valid: false, error: 'Enter the address of your harness server.' }

  const url = parse(raw)
  if (!url) return { valid: false, error: 'That is not a valid URL.' }

  if (url.protocol === 'https:') return { valid: true, error: null }

  if (url.protocol === 'http:') {
    return isLoopbackHost(url.hostname)
      ? { valid: true, error: null }
      : {
          valid: false,
          error: 'Plain http is only allowed for localhost. Use https for a remote server.',
        }
  }

  return { valid: false, error: 'The URL must start with https:// (or http:// for localhost).' }
}

function parse(raw: string): URL | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed)
  } catch {
    return null
  }
}

function stripTrailingSlash(url: URL): string {
  const withPath = `${url.origin}${url.pathname}`
  return withPath.endsWith('/') ? withPath.slice(0, -1) : withPath
}
