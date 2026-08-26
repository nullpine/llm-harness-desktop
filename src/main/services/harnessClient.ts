/**
 * The only file in this repo that may make an HTTP request to the harness server
 * (`.claude/rules/network-boundary.md`, ADR-0002).
 *
 * Two rules shape everything here:
 *
 *  - **Nothing throws.** Every method returns `Result<T, AppError>`. A DNS
 *    failure, a 502, a body that is not JSON, an abort — all of them are values,
 *    because the caller is an IPC handler and nothing throws across IPC.
 *  - **The API key never leaves.** It is read from the config provider at call
 *    time and written into a header. It is never returned, logged, or attached to
 *    an error.
 *
 * Wire bodies are snake_case (`docs/API-CONTRACT.md`); the app is camelCase. That
 * translation happens here and nowhere else.
 */

import { ACTIVATE_TIMEOUT_MS, CHAT_CONNECT_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from '@shared/constants'
import { appError, isServerErrorCode, type AppError } from '@shared/errors'
import { err, ok, type ActivateResult, type Result } from '@shared/ipc'
import { normaliseBaseUrl } from '@shared/serverUrl'
import type {
  GpuInfo,
  HealthInfo,
  ModelCatalog,
  ModelInfo,
  ModelState,
  ServerState,
} from '@shared/types'

export interface HarnessConfig {
  serverUrl: string
  apiKey: string
}

/** Read fresh on every call, so a settings change takes effect immediately. */
export type ConfigProvider = () => HarnessConfig

const CLIENT_HEADER = 'X-Harness-Client'

export interface ChatCompletionsResponse {
  /** The raw SSE body. `sseStream.ts` turns it into events. */
  body: ReadableStream<Uint8Array>
  status: number
}

export class HarnessClient {
  constructor(
    private readonly config: ConfigProvider,
    private readonly clientVersion: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  /** `GET /healthz` — unauthenticated, so it works before a key is configured. */
  async getHealth(): Promise<Result<HealthInfo & { latencyMs: number }>> {
    const { serverUrl } = this.config()
    const base = normaliseBaseUrl(serverUrl)
    if (!base) return err(appError('not_configured', 'no server URL is configured'))

    const startedAt = Date.now()
    const response = await this.send(`${base}/healthz`, { method: 'GET' }, REQUEST_TIMEOUT_MS, {
      authenticated: false,
    })
    if (!response.ok) return response

    const parsed = await readJson(response.value)
    if (!parsed.ok) return parsed
    const body = parsed.value as Record<string, unknown>

    return ok({
      status: asString(body.status) ?? 'unknown',
      version: asString(body.version) ?? 'unknown',
      // v1.1 split this out of `version`. An older server sends neither, and
      // "unknown" is a truer answer than pretending it is the contract version.
      serviceVersion: asString(body.service_version) ?? 'unknown',
      uptimeS: asNumber(body.uptime_s) ?? 0,
      latencyMs: Date.now() - startedAt,
    })
  }

  /** `GET /admin/models` — the full catalog, annotated with live state. */
  async getModels(): Promise<Result<ModelCatalog>> {
    const response = await this.get('/admin/models', REQUEST_TIMEOUT_MS)
    if (!response.ok) return response
    const body = response.value as Record<string, unknown>
    const rows = Array.isArray(body.models) ? body.models : []

    return ok({
      activeModelId: asString(body.active_model_id) ?? null,
      state: asModelState(body.state),
      models: rows.map(toModelInfo),
    })
  }

  /** `GET /admin/state` — cheap and pollable. */
  async getState(): Promise<Result<ServerState>> {
    const response = await this.get('/admin/state', REQUEST_TIMEOUT_MS)
    if (!response.ok) return response
    const body = response.value as Record<string, unknown>

    return ok({
      reachable: true,
      state: asModelState(body.state),
      activeModelId: asString(body.active_model_id) ?? null,
      progressHint: asString(body.progress_hint) ?? null,
      lastError: asString(body.last_error) ?? null,
      gpu: Array.isArray(body.gpu) ? body.gpu.map(toGpuInfo) : [],
    })
  }

  /**
   * `POST /admin/models/{id}/activate`.
   *
   * The timeout covers the 202, not the load behind it (contract §4). Everything
   * after the 202 is the poller's problem.
   */
  async activateModel(modelId: string): Promise<Result<ActivateResult>> {
    const response = await this.request(
      `/admin/models/${encodeURIComponent(modelId)}/activate`,
      { method: 'POST', body: JSON.stringify({ force: false }) },
      ACTIVATE_TIMEOUT_MS,
    )
    if (!response.ok) return response
    const body = response.value as Record<string, unknown>

    const result: ActivateResult = { jobId: asString(body.job_id) ?? null }
    if (body.already_active === true) result.alreadyActive = true
    const estimated = asNumber(body.estimated_seconds)
    if (estimated !== undefined) result.estimatedSeconds = estimated
    return ok(result)
  }

  /** `GET /admin/logs` — the server's own logs, for the diagnosis modal. */
  async getLogs(source: 'vllm' | 'control', lines: number): Promise<Result<{ lines: string[] }>> {
    const capped = Math.max(1, Math.min(lines, 1000)) // the contract's cap (§3)
    const response = await this.get(
      `/admin/logs?lines=${capped}&source=${source}`,
      REQUEST_TIMEOUT_MS,
    )
    if (!response.ok) return response
    const body = response.value as Record<string, unknown>
    return ok({
      lines: Array.isArray(body.lines)
        ? body.lines.filter((l): l is string => typeof l === 'string')
        : [],
    })
  }

  /**
   * `POST /v1/chat/completions`, returning the undrained body.
   *
   * `signal` must be the one from the caller's `AbortController`, and aborting it
   * has to abort the *request* — stopping the read alone leaves the model
   * generating tokens nobody will ever see, on hardware that bills by the hour.
   */
  async chatCompletions(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Result<ChatCompletionsResponse>> {
    const { serverUrl, apiKey } = this.config()
    const base = normaliseBaseUrl(serverUrl)
    if (!base) return err(appError('not_configured', 'no server URL is configured'))
    if (!apiKey) return err(appError('not_configured', 'no API key is configured'))

    // Connection has a deadline; the stream that follows deliberately does not.
    // `sseStream.ts` owns the idle timeout between chunks.
    const connectTimer = new AbortController()
    const timer = setTimeout(() => connectTimer.abort(), CHAT_CONNECT_TIMEOUT_MS)
    const combined = AbortSignal.any([signal, connectTimer.signal])

    let response: Response
    try {
      response = await this.fetchImpl(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: this.headers({ accept: 'text/event-stream' }),
        body: JSON.stringify(body),
        signal: combined,
      })
    } catch (cause) {
      return err(this.transportError(cause, signal))
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) return err(await envelopeToError(response))
    if (!response.body) {
      return err(appError('malformed_response', 'the server returned no response body'))
    }
    return ok({ body: response.body, status: response.status })
  }

  // --- plumbing -------------------------------------------------------------

  private async get(path: string, timeoutMs: number): Promise<Result<unknown>> {
    return this.request(path, { method: 'GET' }, timeoutMs)
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Result<unknown>> {
    const { serverUrl } = this.config()
    const base = normaliseBaseUrl(serverUrl)
    if (!base) return err(appError('not_configured', 'no server URL is configured'))

    const response = await this.send(`${base}${path}`, init, timeoutMs, { authenticated: true })
    if (!response.ok) return response
    return readJson(response.value)
  }

  private async send(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    { authenticated }: { authenticated: boolean },
  ): Promise<Result<Response>> {
    if (authenticated && !this.config().apiKey) {
      return err(appError('not_configured', 'no API key is configured'))
    }

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: this.headers({ authenticated }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      return err(this.transportError(cause))
    }

    if (!response.ok) return err(await envelopeToError(response))
    return ok(response)
  }

  private headers(
    options: { authenticated?: boolean; accept?: string } = {},
  ): Record<string, string> {
    const { apiKey } = this.config()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: options.accept ?? 'application/json',
      [CLIENT_HEADER]: `llm-harness-desktop/${this.clientVersion}`,
    }
    if (options.authenticated !== false && apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    return headers
  }

  /**
   * Turn a thrown fetch into a value. The message must stay free of anything the
   * key could have been interpolated into, so only the cause's own text is used.
   */
  private transportError(cause: unknown, userSignal?: AbortSignal): AppError {
    if (userSignal?.aborted) return appError('aborted', 'the request was cancelled')
    if (cause instanceof Error) {
      if (cause.name === 'TimeoutError') {
        return appError('timeout', 'the server did not respond in time')
      }
      if (cause.name === 'AbortError') {
        return appError('aborted', 'the request was cancelled')
      }
      return appError('network_error', `could not reach the server: ${cause.message}`)
    }
    return appError('network_error', 'could not reach the server')
  }
}

// --- wire → domain ------------------------------------------------------------

/**
 * Map the contract's error envelope onto an `AppError`.
 *
 * A server that returns a non-2xx without the envelope — a proxy's HTML 502, say
 * — still has to become an `AppError`, never an exception.
 */
async function envelopeToError(response: Response): Promise<AppError> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return appError(
      statusFallbackCode(response.status),
      `the server returned HTTP ${response.status} with an unreadable body`,
    )
  }

  const envelope = (payload as { error?: unknown })?.error
  if (!envelope || typeof envelope !== 'object') {
    return appError(
      statusFallbackCode(response.status),
      `the server returned HTTP ${response.status}`,
    )
  }

  const { code, message, details } = envelope as Record<string, unknown>
  const codeString =
    typeof code === 'string' && isServerErrorCode(code) ? code : statusFallbackCode(response.status)
  const error = appError(
    codeString,
    asString(message) ?? `the server returned HTTP ${response.status}`,
    isRecord(details) ? details : undefined,
  )

  // `Retry-After` on a 503 is how long the load is expected to take (contract §2).
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    error.details = { ...(error.details ?? {}), retryAfterSeconds: Number(retryAfter) }
  }
  return error
}

function statusFallbackCode(status: number): string {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 502 || status === 504) return 'upstream_unavailable'
  if (status === 503) return 'model_loading'
  if (status >= 500) return 'internal'
  return 'bad_request'
}

async function readJson(response: Response): Promise<Result<unknown>> {
  try {
    return ok(await response.json())
  } catch {
    return err(appError('malformed_response', 'the server sent a body that is not valid JSON'))
  }
}

function toModelInfo(raw: unknown): ModelInfo {
  const row = isRecord(raw) ? raw : {}
  return {
    id: asString(row.id) ?? '',
    displayName: asString(row.display_name) ?? asString(row.id) ?? '',
    // v1.1. `model_ref` is opaque — display and debugging only, never a request field.
    modelRef: asString(row.model_ref) ?? '',
    params: asString(row.params) ?? '',
    quantization: asString(row.quantization) ?? '',
    contextLength: asNumber(row.context_length) ?? 0,
    // v1.1 renamed `downloaded`. A server still sending the old name is a version
    // mismatch, not something to paper over, so there is no fallback read here.
    available: row.available === true,
    state: asModelState(row.state),
    estimatedLoadSeconds: asNumber(row.estimated_load_seconds) ?? 0,
  }
}

function toGpuInfo(raw: unknown): GpuInfo {
  const row = isRecord(raw) ? raw : {}
  return {
    index: asNumber(row.index) ?? 0,
    name: asString(row.name) ?? 'unknown',
    memoryUsedMb: asNumber(row.memory_used_mb) ?? 0,
    memoryTotalMb: asNumber(row.memory_total_mb) ?? 0,
  }
}

const MODEL_STATES: ModelState[] = ['idle', 'loading', 'ready', 'stopping', 'error']

function asModelState(value: unknown): ModelState {
  return typeof value === 'string' && (MODEL_STATES as string[]).includes(value)
    ? (value as ModelState)
    : 'idle'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
