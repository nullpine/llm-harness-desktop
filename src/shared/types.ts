/**
 * The data model, shared by main, preload and renderer (SPEC §7).
 *
 * Wire types from `docs/API-CONTRACT.md` are snake_case; everything here is
 * camelCase. `harnessClient.ts` owns the translation, and it is the only place
 * the wire shape appears.
 */

export type Role = 'system' | 'user' | 'assistant'

/** The server's model lifecycle (API contract §3). `unreachable` is client-only. */
export type ModelState = 'idle' | 'loading' | 'ready' | 'stopping' | 'error'

/** Why a stream ended. `abort` is ours — the user pressed Stop. */
export type FinishReason = 'stop' | 'length' | 'content_filter' | 'abort' | null

export interface MessageUsage {
  promptTokens: number
  completionTokens: number
}

export interface Message {
  id: string
  role: Role
  content: string
  /** From `delta.reasoning_content` (vLLM) or `delta.reasoning` (Ollama). */
  reasoning?: string
  /**
   * How long the model spent reasoning: first reasoning chunk to first content
   * chunk, or to the end of the stream when no content ever arrives.
   *
   * Persisted rather than derived from the live buffer, because the buffer is
   * unreachable the moment the stream ends and the transcript reloads from disk.
   */
  reasoningMs?: number
  /** Which model produced it. Assistant messages only. */
  modelId?: string
  createdAt: string
  usage?: MessageUsage
  error?: { code: string; message: string }
  /** The user pressed Stop. */
  stopped?: boolean
  /**
   * Why the stream ended. Persisted rather than left in the live buffer so a
   * truncated reply still says so after the app is quit and reopened (A7).
   */
  finishReason?: FinishReason
}

export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  modelId: string
  systemPrompt: string | null
  messages: Message[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: string
  modelId: string
}

export type Theme = 'system' | 'light' | 'dark'

/**
 * What the renderer is allowed to know about configuration.
 *
 * There is no `apiKey` field and there must never be one: the key lives in the
 * main process only (CLAUDE.md rule 3). `hasApiKey` is the entire surface.
 */
export interface Settings {
  serverUrl: string
  hasApiKey: boolean
  /**
   * Whether this machine has somewhere secure to keep the key.
   *
   * False on a desktop with no keyring, where the key is held in memory for the
   * session and is gone after quit. A property of the machine, not of the key —
   * which is why it belongs here rather than in a transient bit of modal state
   * that vanishes the moment the dialog closes.
   */
  credentialStoreAvailable: boolean
  systemPrompt: string
  temperature: number
  topP: number
  maxTokens: number
  streamingEnabled: boolean
  theme: Theme
}

/**
 * One catalog entry, from `GET /admin/models` (contract v1.1).
 *
 * `available` was `downloaded` in v1: the server may serve a model it never
 * "downloaded" — a hosted provider has nothing to fetch — so the honest question
 * is whether the backend can serve it without a fetch.
 */
export interface ModelInfo {
  id: string
  displayName: string
  /**
   * The engine's own name for this model — an Ollama tag, a Hugging Face repo, or
   * a provider's model string. Opaque (contract §3): display and debugging only.
   * Never send it as `model`; never match a response against it.
   */
  modelRef: string
  params: string
  quantization: string
  contextLength: number
  available: boolean
  state: ModelState
  estimatedLoadSeconds: number
}

export interface ModelCatalog {
  activeModelId: string | null
  state: ModelState
  models: ModelInfo[]
}

export interface GpuInfo {
  index: number
  name: string
  memoryUsedMb: number
  memoryTotalMb: number
  /** 0-100. The contract has always sent it; the app used to drop it. */
  utilizationPct: number
}

/** What the poller pushes to the renderer. `unreachable` is ours, not the server's. */
export interface ServerState {
  reachable: boolean
  state: ModelState | 'unreachable'
  activeModelId: string | null
  progressHint: string | null
  lastError: string | null
  gpu: GpuInfo[]
}

/** `GET /healthz` (contract §3). Two versions, and they mean different things. */
export interface HealthInfo {
  status: string
  /** The API contract version the server implements. Compare this. */
  version: string
  /** The server build. Debugging only — never branch on it. */
  serviceVersion: string
  uptimeS: number
}

export interface ChatSendRequest {
  conversationId: string
  content: string
}
