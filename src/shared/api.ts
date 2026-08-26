/**
 * The shape of `window.api`.
 *
 * It lives in `shared` rather than in the preload because both sides need it and
 * neither can import the other: the preload is a Node/Electron module the
 * renderer's `tsconfig.web.json` deliberately cannot see, and the renderer is DOM
 * code the preload has no business importing.
 *
 * So this is the contract between them. The preload declares
 * `const api: HarnessApi`, which makes a missing or misspelled channel a
 * compile error rather than an `undefined is not a function` at runtime.
 */

import type {
  ActivateResult,
  ChatChunkEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  LogsRequest,
  Result,
  ServerTestResult,
} from '@shared/ipc'
import type {
  ChatSendRequest,
  Conversation,
  ConversationSummary,
  Message,
  ModelCatalog,
  ServerState,
  Settings,
} from '@shared/types'

/** Every subscription returns its own unsubscribe. */
export type Unsubscribe = () => void

export interface HarnessApi {
  readonly settings: {
    get(): Promise<Result<Settings>>
    set(patch: Partial<Settings>): Promise<Result<Settings>>
    /**
     * Send the key *to* main. There is deliberately no way to read it back —
     * `Settings.hasApiKey` is all the renderer ever learns (CLAUDE.md rule 3).
     */
    setApiKey(key: string): Promise<Result<{ ok: true }>>
  }
  readonly server: {
    test(): Promise<Result<ServerTestResult>>
  }
  readonly models: {
    list(): Promise<Result<ModelCatalog>>
    activate(modelId: string): Promise<Result<ActivateResult>>
    state(): Promise<Result<ServerState>>
    onStateChanged(listener: (state: ServerState) => void): Unsubscribe
  }
  readonly chat: {
    send(request: ChatSendRequest): Promise<Result<{ requestId: string }>>
    abort(requestId: string): Promise<Result<{ ok: true }>>
    onChunk(listener: (chunk: ChatChunkEvent) => void): Unsubscribe
    onDone(listener: (done: ChatDoneEvent) => void): Unsubscribe
    onError(listener: (error: ChatErrorEvent) => void): Unsubscribe
  }
  readonly conversations: {
    list(): Promise<Result<ConversationSummary[]>>
    get(id: string): Promise<Result<Conversation>>
    create(init: { title?: string; modelId: string }): Promise<Result<Conversation>>
    appendMessage(id: string, message: Message): Promise<Result<void>>
    rename(id: string, title: string): Promise<Result<void>>
    delete(id: string): Promise<Result<void>>
    /** Remove from the list, leaving the file on disk. */
    forget(id: string): Promise<Result<void>>
  }
  readonly logs: {
    fetch(request: LogsRequest): Promise<Result<{ lines: string[] }>>
  }
}

declare global {
  interface Window {
    readonly api: HarnessApi
  }
}
