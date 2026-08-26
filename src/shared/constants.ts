/**
 * Defaults and timeouts, from SPEC §4, §7, §9 and API-CONTRACT §4.
 *
 * They live here rather than inline so the mock server, the poller and the tests
 * cannot drift from each other.
 */

import type { Settings } from '@shared/types'

// --- polling (SPEC §9) ------------------------------------------------------

/** Cadence while the server is settled: `ready`, `idle` or `error`. */
export const POLL_INTERVAL_IDLE_MS = 30_000
/** Cadence while an activation is in flight: `loading` or `stopping`. */
export const POLL_INTERVAL_ACTIVE_MS = 2_000
/** Cadence once we have given up reaching the server. Keep trying, just slower. */
export const POLL_INTERVAL_UNREACHABLE_MS = 60_000
/** Consecutive failures before the state becomes `unreachable`. */
export const POLL_FAILURES_BEFORE_UNREACHABLE = 3

// --- request timeouts (API-CONTRACT §4) -------------------------------------

/** `GET /healthz` and `/admin/*`. */
export const REQUEST_TIMEOUT_MS = 10_000
/** `POST /admin/models/{id}/activate` — the 202, not the load behind it. */
export const ACTIVATE_TIMEOUT_MS = 15_000
/**
 * A stream has no total deadline — a long answer is not a hung one. What is
 * bounded is the gap *between* chunks.
 */
export const SSE_IDLE_TIMEOUT_MS = 60_000
/** How long to wait for the response headers of a completion. */
export const CHAT_CONNECT_TIMEOUT_MS = 30_000

// --- generation defaults (SPEC §7) ------------------------------------------

export const DEFAULT_TEMPERATURE = 0.7
export const DEFAULT_TOP_P = 0.95
export const DEFAULT_MAX_TOKENS = 2048

export const TEMPERATURE_RANGE = { min: 0, max: 2, step: 0.05 } as const
export const TOP_P_RANGE = { min: 0, max: 1, step: 0.01 } as const
export const MAX_TOKENS_RANGE = { min: 1, max: 131_072, step: 1 } as const

// --- UI ---------------------------------------------------------------------

/** Markdown re-parsing per token destroys frame rate (CLAUDE.md). */
export const STREAM_RENDER_THROTTLE_MS = 60
/** Conversation titles are the first N characters of the first user message. */
export const TITLE_MAX_LENGTH = 48

// --- persistence ------------------------------------------------------------

/** Bumped when `settings.json` needs a migration. */
export const SETTINGS_SCHEMA_VERSION = 1
export const LOG_MAX_FILES = 5
export const LOG_MAX_BYTES = 1_000_000

// --- the contract ------------------------------------------------------------

/**
 * The API contract version this client is written against. The server reports
 * its own in `GET /healthz` → `version`; a server ahead of this is a non-blocking
 * warning (contract §5).
 */
export const CONTRACT_VERSION = '1.1'

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: '',
  hasApiKey: false,
  systemPrompt: '',
  temperature: DEFAULT_TEMPERATURE,
  topP: DEFAULT_TOP_P,
  maxTokens: DEFAULT_MAX_TOKENS,
  streamingEnabled: true,
  theme: 'system',
}
