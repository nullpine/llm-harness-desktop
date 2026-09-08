# llm-harness-desktop — Architecture

## The one decision everything follows from

**The renderer has no network access.** All HTTP to the harness server happens in
the main process.

This costs a little plumbing — every request becomes an IPC round trip — and buys:

- the API key lives only in a Node context, never in a window that renders markdown
- the renderer runs under `default-src 'self'`, so a malicious model response
  cannot exfiltrate anything even if it smuggles HTML past the markdown sanitizer
- streaming, aborting, and retrying are implemented once, in one file, with real
  tests, instead of being scattered through React components

See `docs/adr/0002-main-process-owns-network.md`.

## Process map

```
┌── renderer (Chromium, sandboxed) ─────────────────────────┐
│  React 19 + Zustand                                        │
│  reads state from stores, calls window.api.*                │
│  receives chat:chunk / models:stateChanged events           │
└───────────────┬────────────────────────────────────────────┘
                │ contextBridge (preload — typed, minimal)
┌───────────────▼────────────────────────────────────────────┐
│  main (Node)                                                │
│                                                             │
│  ipc/*.handlers.ts   ──▶  services/                         │
│                            harnessClient.ts ──┐             │
│                            sseStream.ts       ├─▶ HTTPS ──▶ server
│                            serverPoller.ts ───┘             │
│                            settingsStore.ts   ──▶ userData/ │
│                            secretStore.ts     ──▶ Keychain  │
│                            conversationStore.ts ─▶ userData/│
└─────────────────────────────────────────────────────────────┘
```

## Data flow: sending a message

```
user presses Enter
  │
  ├─ renderer: append user message to store (optimistic), clear composer
  ├─ renderer: window.api.chat.send({conversationId, content})
  │
  └─▶ main: chat.handlers.ts
        ├─ conversationStore.appendMessage(user)          ← persisted before the call
        ├─ build messages[] = system? + history + new     ← §8.3 of SPEC.md
        ├─ harnessClient.chatCompletions(body, signal)
        │     └─ fetch(POST /v1/chat/completions, stream)
        │           └─ sseStream.parse()
        │                 ├─ delta.content   ─▶ send('chat:chunk', {kind:'content'})
        │                 ├─ delta.reasoning ─▶ send('chat:chunk', {kind:'reasoning'})
        │                 └─ [DONE]          ─▶ send('chat:done', {usage})
        └─ on done: conversationStore.appendMessage(assistant, full text)
```

The renderer accumulates chunks into `useChatStore` keyed by `requestId` and
renders from there. The **main process** owns the canonical persisted transcript;
the renderer's copy is a view. If they ever disagree, main wins — reload the
conversation from disk.

## Data flow: switching models

```
dropdown selection
  └─ SwitchModelDialog confirm
      └─ window.api.models.activate({modelId})
           └─ main: POST /admin/models/{id}/activate  → 202 {jobId}
                └─ serverPoller switches to 2s cadence
                     └─ every state change → send('models:stateChanged', state)
                          └─ renderer: LoadingBanner reads useServerStore
                               ├─ state==='ready'  → re-enable composer, insert divider
                               └─ state==='error'  → red banner + View server logs
```

The client never blocks on the activation HTTP call. The 202 returns immediately;
everything after that is the poller.

## Error handling

Nothing throws across the IPC boundary. Every handler returns:

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }
interface AppError { code: string; message: string; retryable: boolean }
```

Server error codes from the API contract map to user-facing copy in one place,
`src/renderer/lib/errorCopy.ts`:

| code | shown to the user |
|---|---|
| `model_not_active` | "That model isn't loaded any more — refreshing." (then auto-refresh) |
| `model_loading` | "Still loading — this usually takes about a minute." |
| `unauthorized` | "Your API key was rejected. Check Settings." |
| `upstream_unavailable` | "The model server isn't responding. Check the server logs." |
| `stream_stalled` | "The response stopped mid-stream." + Retry |

Raw error codes never appear in the UI except inside the server-logs modal.

## Persistence

JSON files, one per conversation, written atomically (`tmp` → `fsync` → `rename`),
behind `ConversationRepository`:

```ts
interface ConversationRepository {
  list(): Promise<ConversationSummary[]>
  get(id: string): Promise<Conversation | null>
  create(init: {...}): Promise<Conversation>
  appendMessage(id: string, m: Message): Promise<void>
  rename(id: string, title: string): Promise<void>
  delete(id: string): Promise<void>
  /** Drop from the index; leave the file alone — a damaged file may be recoverable. */
  forget(id: string): Promise<void>
}
```

The interface exists so the post-MVP move to SQLite touches one file. Chosen over
SQLite now purely to avoid a native module in the Electron build for a
single-user app with a few hundred conversations. See
`docs/adr/0003-json-file-persistence.md`.

A corrupt file is a warning in the log and a skipped entry in the list — never a
failed startup.

**The conversation file is the source of truth; `index.json` is a cache.** They are
two separate atomic writes, so a process that dies between them leaves one of two
states. The conversation file is written first, deliberately: the survivable failure
is a complete transcript with a stale summary, never a summary promising a message
the transcript does not contain. A stale entry is repaired lazily when the
conversation is opened — a stale-but-valid index parses fine, so nothing else would
notice it. This is a rule rather than a transaction because the cost then falls on
the rare case: opening a conversation already reads the file, so the comparison is
free and the correcting write happens only when something is actually wrong.

**Quitting waits for in-flight replies.** `before-quit` aborts every live stream —
the same path the Stop button uses, so the partial is persisted with
`stopped: true` — and awaits those writes for up to `QUIT_PERSIST_DEADLINE_MS`
before exiting. Without it the process could exit mid-write, and because
`atomicWrite` never leaves a half-file the result was an intact conversation
silently missing its last reply.

## Threat model (brief)

| Threat | Handling |
|---|---|
| Model output containing HTML/JS | markdown renderer sanitizes; renderer CSP blocks external loads regardless |
| API key exfiltration via renderer | key never enters the renderer; `window.api` has no getter for it |
| MITM on the wire | HTTPS only; `http://` rejected in settings except `localhost` for dev |
| Malicious link in a response | `shell.openExternal` gated to `https:` and only on explicit click |
| Local disk access to history | out of scope — the transcript is plaintext JSON by design; the key is not |
