/**
 * The context bridge: exactly the channels in `shared/ipc.ts` and nothing else.
 *
 * `sandbox: true` means this file runs in a limited context — no `require`, no
 * `fs`, no `process` beyond what Electron injects. That is deliberate, and it is
 * why this is pure `ipcRenderer` plumbing with no logic in it
 * (`.claude/rules/network-boundary.md`).
 *
 * There is no `getApiKey`. There must never be one: the renderer learns whether a
 * key exists from `Settings.hasApiKey` and nothing more.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import type { HarnessApi } from '@shared/api'
import { IPC } from '@shared/ipc'
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

const invoke = <Response>(channel: string, payload?: unknown): Promise<Result<Response>> =>
  ipcRenderer.invoke(channel, payload) as Promise<Result<Response>>

/** Subscribe to a pushed event; returns the unsubscribe function. */
const subscribe = <Payload>(
  channel: string,
  listener: (payload: Payload) => void,
): (() => void) => {
  const wrapped = (_event: IpcRendererEvent, payload: Payload): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.off(channel, wrapped)
  }
}

// Typed against the shared interface: a missing channel is a compile error.
const api: HarnessApi = {
  settings: {
    get: () => invoke<Settings>(IPC.settingsGet),
    set: (patch: Partial<Settings>) => invoke<Settings>(IPC.settingsSet, patch),
    setApiKey: (key: string) => invoke<{ ok: true }>(IPC.settingsSetApiKey, { key }),
  },
  server: {
    test: () => invoke<ServerTestResult>(IPC.serverTest),
  },
  models: {
    list: () => invoke<ModelCatalog>(IPC.modelsList),
    activate: (modelId: string) => invoke<ActivateResult>(IPC.modelsActivate, { modelId }),
    state: () => invoke<ServerState>(IPC.modelsState),
    onStateChanged: (listener: (state: ServerState) => void) =>
      subscribe<ServerState>(IPC.modelsStateChanged, listener),
  },
  chat: {
    send: (request: ChatSendRequest) => invoke<{ requestId: string }>(IPC.chatSend, request),
    abort: (requestId: string) => invoke<{ ok: true }>(IPC.chatAbort, { requestId }),
    onChunk: (listener: (chunk: ChatChunkEvent) => void) =>
      subscribe<ChatChunkEvent>(IPC.chatChunk, listener),
    onDone: (listener: (done: ChatDoneEvent) => void) =>
      subscribe<ChatDoneEvent>(IPC.chatDone, listener),
    onError: (listener: (error: ChatErrorEvent) => void) =>
      subscribe<ChatErrorEvent>(IPC.chatError, listener),
  },
  conversations: {
    list: () => invoke<ConversationSummary[]>(IPC.convList),
    get: (id: string) => invoke<Conversation>(IPC.convGet, { id }),
    create: (init: { title?: string; modelId: string }) =>
      invoke<Conversation>(IPC.convCreate, init),
    appendMessage: (id: string, message: Message) =>
      invoke<void>(IPC.convAppendMessage, { id, message }),
    rename: (id: string, title: string) => invoke<void>(IPC.convRename, { id, title }),
    delete: (id: string) => invoke<void>(IPC.convDelete, { id }),
    forget: (id: string) => invoke<void>(IPC.convForget, { id }),
  },
  logs: {
    fetch: (request: LogsRequest) => invoke<{ lines: string[] }>(IPC.logsFetch, request),
  },
}

contextBridge.exposeInMainWorld('api', api)
