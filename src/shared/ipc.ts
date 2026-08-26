/**
 * Every IPC channel, defined once (SPEC §6).
 *
 * All of them are declared now even though M1 implements only some; `chat:*` and
 * `conv:*` handlers land in M2. Declaring the whole table up front is what makes
 * the preload a literal mirror of this file rather than a growing pile of
 * one-offs — and `window.api` exposes exactly this and nothing else
 * (`.claude/rules/network-boundary.md`).
 *
 * Two shapes:
 *   - `IpcInvoke`  renderer → main, request/response, always a `Result`
 *   - `IpcEvent`   main → renderer, fire and forget
 */

import type { AppError } from '@shared/errors'
import type {
  ChatSendRequest,
  Conversation,
  ConversationSummary,
  FinishReason,
  Message,
  MessageUsage,
  ModelCatalog,
  ServerState,
  Settings,
} from '@shared/types'

/** Nothing throws across IPC (`.claude/rules/streaming-and-ipc.md`). */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export const ok = <T>(value: T): Result<T> => ({ ok: true, value })
export const err = <T = never>(error: AppError): Result<T> => ({ ok: false, error })

// --- channel names ----------------------------------------------------------

export const IPC = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsSetApiKey: 'settings:setApiKey',
  serverTest: 'server:test',
  modelsList: 'models:list',
  modelsActivate: 'models:activate',
  modelsState: 'models:state',
  modelsStateChanged: 'models:stateChanged',
  chatSend: 'chat:send',
  chatChunk: 'chat:chunk',
  chatDone: 'chat:done',
  chatError: 'chat:error',
  chatAbort: 'chat:abort',
  convList: 'conv:list',
  convGet: 'conv:get',
  convCreate: 'conv:create',
  convAppendMessage: 'conv:appendMessage',
  convRename: 'conv:rename',
  convDelete: 'conv:delete',
  convForget: 'conv:forget',
  logsFetch: 'logs:fetch',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

// --- payloads ---------------------------------------------------------------

export interface ServerTestResult {
  ok: boolean
  /** The contract version from `/healthz` → `version`. */
  version?: string
  /** The server build from `/healthz` → `service_version`. Debugging only. */
  serviceVersion?: string
  latencyMs?: number
  error?: string
}

export interface ActivateResult {
  jobId: string | null
  alreadyActive?: boolean
  estimatedSeconds?: number
}

export interface ChatChunkEvent {
  requestId: string
  delta: string
  /**
   * `reasoning` covers both spellings the two engines use — see
   * `sseStream.ts`. The renderer never needs to know which one arrived.
   */
  kind: 'content' | 'reasoning'
}

export interface ChatDoneEvent {
  requestId: string
  finishReason: FinishReason
  usage?: MessageUsage
}

export interface ChatErrorEvent {
  requestId: string
  code: string
  message: string
}

/**
 * The outcome of storing an API key.
 *
 * `persisted: false` is a **warning, not a failure**: some Linux desktops have no
 * keyring, and rather than writing the key in plaintext the app keeps it in
 * memory for the session. Treating that as an error left the user unable to
 * close Settings at all — stuck in a modal on a machine where the app would
 * otherwise work perfectly well until quit.
 */
export interface SetApiKeyResult {
  ok: true
  persisted: boolean
  warning?: string
}

export interface LogsRequest {
  source: 'vllm' | 'control'
  lines: number
}

/**
 * renderer → main. Every entry is `[request, response]`; the response is always
 * wrapped in `Result` at the boundary.
 */
export interface IpcInvoke {
  [IPC.settingsGet]: [void, Settings]
  [IPC.settingsSet]: [Partial<Settings>, Settings]
  [IPC.settingsSetApiKey]: [{ key: string }, SetApiKeyResult]
  [IPC.serverTest]: [void, ServerTestResult]
  [IPC.modelsList]: [void, ModelCatalog]
  [IPC.modelsActivate]: [{ modelId: string }, ActivateResult]
  [IPC.modelsState]: [void, ServerState]
  [IPC.chatSend]: [ChatSendRequest, { requestId: string }]
  [IPC.chatAbort]: [{ requestId: string }, { ok: true }]
  [IPC.convList]: [void, ConversationSummary[]]
  [IPC.convGet]: [{ id: string }, Conversation]
  [IPC.convCreate]: [{ title?: string; modelId: string }, Conversation]
  [IPC.convAppendMessage]: [{ id: string; message: Message }, void]
  [IPC.convRename]: [{ id: string; title: string }, void]
  [IPC.convDelete]: [{ id: string }, void]
  /**
   * Drop an entry from the index without touching the file on disk.
   *
   * For a conversation whose file is damaged: the user wants it out of the
   * sidebar, but the bytes may still be recoverable by hand, so deleting them
   * is not ours to decide.
   */
  [IPC.convForget]: [{ id: string }, void]
  [IPC.logsFetch]: [LogsRequest, { lines: string[] }]
}

/** main → renderer. Pushed, never requested; no `Result` wrapper. */
export interface IpcEvent {
  [IPC.modelsStateChanged]: ServerState
  [IPC.chatChunk]: ChatChunkEvent
  [IPC.chatDone]: ChatDoneEvent
  [IPC.chatError]: ChatErrorEvent
}

export type InvokeChannel = keyof IpcInvoke
export type EventChannel = keyof IpcEvent

export type InvokeRequest<C extends InvokeChannel> = IpcInvoke[C][0]
export type InvokeResponse<C extends InvokeChannel> = IpcInvoke[C][1]

/** The channels M1 actually implements. The rest answer `not_implemented`. */
export const M1_IMPLEMENTED: readonly InvokeChannel[] = [
  IPC.settingsGet,
  IPC.settingsSet,
  IPC.settingsSetApiKey,
  IPC.serverTest,
  IPC.modelsList,
  IPC.modelsActivate,
  IPC.modelsState,
]
