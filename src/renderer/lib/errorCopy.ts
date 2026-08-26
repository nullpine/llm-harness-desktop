/**
 * Server error codes → what a person actually sees (ARCHITECTURE.md).
 *
 * One table, one place. Raw codes never reach the UI outside the server-logs
 * modal — "409 model_not_active" is a fact about HTTP, not an explanation.
 */

import type { AppError } from '@shared/errors'
import type { FinishReason } from '@shared/types'

const COPY: Record<string, string> = {
  // A12: this is what someone sees when nothing is loaded. Never a raw 409.
  model_not_active: 'No model is loaded — start the server or pick a model',
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

/**
 * The composer's explanation for why sending is impossible, or null.
 *
 * A12 lives here: "no model active" must read as a sentence a person can act on,
 * never as `model_not_active` or a bare 409.
 */
export function composerDisabledReason(
  state: string,
  reachable: boolean,
  hasConversation: boolean,
): string | null {
  if (!reachable || state === 'unreachable') {
    return "Can't reach the server. Check the URL in Settings, and that it's running."
  }
  if (state === 'loading' || state === 'stopping') {
    return 'A model is loading — this usually takes about a minute.'
  }
  if (state === 'error') {
    return 'The server had a problem loading the model. Check the server logs.'
  }
  if (state !== 'ready') {
    return COPY.model_not_active ?? 'No model is loaded — start the server or pick a model'
  }
  if (!hasConversation) return 'Start a new chat to send a message.'
  return null
}

/** True when the UI should offer a Retry rather than just an explanation. */
export function isRetryable(error: AppError): boolean {
  return error.retryable
}

/**
 * What to tell the user when a reply was cut short by the token budget.
 *
 * `finish_reason: "length"` means the model hit `max_tokens`, and the two cases
 * read very differently. With no content at all the user sees an empty bubble and
 * has no way to guess why — that happens when a reasoning model spends the whole
 * budget thinking, but the cause is the budget, not the reasoning, so this is
 * general truncation handling rather than a special case for one kind of model.
 *
 * Returns null when the reply ended normally.
 */
export function truncationNote(
  finishReason: FinishReason | undefined,
  content: string,
): string | null {
  if (finishReason !== 'length') return null
  return content.trim() === ''
    ? "The model used its whole token budget reasoning and didn't produce an answer. Increase Max tokens in Settings."
    : 'Response was cut off — increase Max tokens in Settings.'
}
