/**
 * Server error codes → what a person actually sees (ARCHITECTURE.md).
 *
 * One table, one place. Raw codes never reach the UI outside the server-logs
 * modal — "409 model_not_active" is a fact about HTTP, not an explanation.
 */

import type { AppError } from '@shared/errors'

const COPY: Record<string, string> = {
  model_not_active: "That model isn't loaded any more — refreshing.",
  model_loading: 'Still loading — this usually takes about a minute.',
  activation_in_progress: 'Another model is already loading. Give it a moment.',
  activation_failed: "That model didn't start. Check the server logs.",
  unauthorized: 'Your API key was rejected. Check Settings.',
  forbidden: 'That key does not have permission for this.',
  not_found: "The server doesn't know about that model.",
  upstream_unavailable: "The model server isn't responding. Check the server logs.",
  bad_request: 'The server rejected the request as malformed.',
  internal: 'The server hit an unexpected error.',
  stream_stalled: 'The response stopped mid-stream.',
  network_error: "Couldn't reach the server. Check the URL and that it's running.",
  malformed_response: "The server replied with something this app couldn't read.",
  timeout: "The server didn't respond in time.",
  aborted: 'Cancelled.',
  not_configured: 'Set your server URL and API key in Settings first.',
  encryption_unavailable: 'This system has no secure place to store the key.',
  write_failed: 'The key could not be saved to disk.',
}

export function errorCopy(error: AppError): string {
  return COPY[error.code] ?? error.message
}

/** True when the UI should offer a Retry rather than just an explanation. */
export function isRetryable(error: AppError): boolean {
  return error.retryable
}
