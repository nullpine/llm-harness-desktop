/**
 * What "Test connection" says when it fails.
 *
 * Lives in `shared` because the string is produced in main — the renderer only
 * displays what `server:test` returns — but it has to read like the rest of the
 * user-facing copy in `renderer/lib/errorCopy.ts`. Raw codes never reach the UI.
 */

import type { AppError } from '@shared/errors'

const COPY: Record<string, string> = {
  unauthorized: 'Your API key was rejected. Check the key and try again.',
  forbidden: 'That key does not have permission for this server.',
  not_found: "Reached the server, but it didn't recognise that address.",
  upstream_unavailable: "Reached the server, but the model backend isn't responding.",
  network_error: "Couldn't reach the server. Check the URL and that it's running.",
  timeout: "The server didn't respond in time.",
  malformed_response: "That address answered, but it isn't a harness server.",
  not_configured: 'Enter a server URL and API key first.',
  internal: 'The server hit an unexpected error.',
}

export function serverTestError(error: AppError): string {
  return COPY[error.code] ?? error.message
}
