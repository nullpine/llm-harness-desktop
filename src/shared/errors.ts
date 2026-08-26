/**
 * The contract's error codes, mirrored as a union (API-CONTRACT §1), plus the
 * codes only the client can produce.
 *
 * `AppError` is what crosses IPC. Nothing throws over that boundary
 * (`.claude/rules/streaming-and-ipc.md`), so every handler returns a `Result`.
 */

/** Codes the server sends. Must match the contract's list exactly. */
export const SERVER_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'model_not_active',
  'model_loading',
  'activation_in_progress',
  'activation_failed',
  'upstream_unavailable',
  'bad_request',
  'internal',
] as const

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number]

/** Codes only this app produces. The server has no idea about any of them. */
export const CLIENT_ERROR_CODES = [
  /** No chunk for `SSE_IDLE_TIMEOUT_MS`. */
  'stream_stalled',
  /** The socket failed, DNS failed, TLS failed — we never got an envelope. */
  'network_error',
  /** A response arrived but was not the JSON the contract promises. */
  'malformed_response',
  /** The user pressed Stop, or the app is quitting. */
  'aborted',
  /** A request exceeded its deadline (SPEC §9). */
  'timeout',
  /** Settings are incomplete — no server URL, or no API key. */
  'not_configured',
] as const

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number]

export type ErrorCode = ServerErrorCode | ClientErrorCode

export interface AppError {
  code: ErrorCode | string
  message: string
  /** Whether trying the same thing again could plausibly work. */
  retryable: boolean
  /** Contract `details`, passed through for the logs modal. Never rendered raw. */
  details?: Record<string, unknown>
}

const SERVER_CODES = new Set<string>(SERVER_ERROR_CODES)
const CLIENT_CODES = new Set<string>(CLIENT_ERROR_CODES)

export function isServerErrorCode(code: string): code is ServerErrorCode {
  return SERVER_CODES.has(code)
}

export function isKnownErrorCode(code: string): code is ErrorCode {
  return SERVER_CODES.has(code) || CLIENT_CODES.has(code)
}

/** Which failures are worth another attempt. Everything else is a dead end. */
const RETRYABLE = new Set<string>([
  'model_loading',
  'upstream_unavailable',
  'internal',
  'network_error',
  'timeout',
  'stream_stalled',
])

export function isRetryable(code: string): boolean {
  return RETRYABLE.has(code)
}

export function appError(
  code: ErrorCode | string,
  message: string,
  details?: Record<string, unknown>,
): AppError {
  return details === undefined
    ? { code, message, retryable: isRetryable(code) }
    : { code, message, retryable: isRetryable(code), details }
}
