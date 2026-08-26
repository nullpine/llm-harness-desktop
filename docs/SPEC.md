# llm-harness-desktop — MVP Specification

**Version:** 0.1 (MVP)
**Repo:** `llm-harness-desktop`
**Companion repo:** `llm-harness-server` (control plane + vLLM on the Azure VM)
**Contract:** `docs/API-CONTRACT.md`

---

## 1. What this is

A local Electron desktop app that is the *only* client for a privately hosted
open-weights LLM. The model runs on a single Azure GPU VM behind a small control
plane. The app gives you a chat window and a model dropdown; picking a different
model tells the server to swap what is loaded on the GPU.

**One user. One VM. One model resident at a time.** Everything below follows from that.

## 2. Goals

| # | Goal |
|---|---|
| G1 | Chat with a self-hosted open-weights model with streaming token output |
| G2 | Switch which model is loaded on the VM from a dropdown, with honest feedback about the ~1–2 min load |
| G3 | Keep conversation history locally, across app restarts |
| G4 | Store the server URL and API key securely on the desktop, never in the renderer |
| G5 | Be a clean foundation: adding a third model is a YAML line on the server, no client change |

## 3. Non-goals (explicitly out of MVP scope)

Do not build these. If a task seems to require one, stop and raise it.

- Multi-user accounts, sign-in, or any user identity beyond a shared API key
- Tool calling / function calling / MCP
- File attachments, image or audio input, vision (even where the model supports it)
- RAG, embeddings, vector stores, document upload
- Multiple models resident simultaneously; per-message model switching
- Auto-provisioning or auto-scaling the Azure VM from the app
- Conversation search, tags, folders, export to formats other than JSON/Markdown
- Cloud sync of conversations; any telemetry leaving the machine
- Prompt template library, agents, multi-turn planning
- Auto-update (ship unsigned local builds for MVP)
- Windows/Linux packaging polish — build them, but only macOS is a supported target

## 4. Platform & stack

| Concern | Choice | Why |
|---|---|---|
| Shell | Electron (latest stable) | Cross-platform, mature, matches the ask |
| Language | TypeScript, `strict: true` everywhere | |
| Build | `electron-vite` | Handles main/preload/renderer targets and HMR out of the box |
| UI | React 19 + Tailwind CSS | |
| State | Zustand | Small, no boilerplate, easy to test |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` | |
| Packaging | `electron-builder` → dmg (mac), nsis (win), AppImage (linux) | |
| Persistence | JSON files in `app.getPath('userData')` behind a repository interface | Zero native modules; swap to SQLite later without touching callers |
| Secrets | `safeStorage.encryptString` → Keychain/DPAPI/libsecret | API key never lands in plaintext on disk |
| Testing | Vitest (unit), Playwright + `_electron` (e2e smoke) | |

Node's global `fetch` is used in the main process. No `axios`, no `node-fetch`.

## 5. Process architecture

```
┌─────────────────────── Electron app ───────────────────────┐
│                                                             │
│  renderer (React)          preload            main (Node)   │
│  ─────────────────    ─────────────────   ────────────────  │
│  chat UI                contextBridge      settings store   │
│  model dropdown   ⇄     window.api    ⇄    key vault        │
│  conversation list      (typed, no      │  HTTP client      │──HTTPS──▶ Azure VM
│  settings modal          Node access)   │  SSE parser       │           (Caddy → control
│                                         │  conversation IO  │            plane → vLLM)
│  NO network access                      │  IPC handlers     │
└─────────────────────────────────────────┴─────────────────────┘
```

**Hard rule: the renderer makes no network requests.** All HTTP goes through the
main process. This is what lets the renderer run with a `default-src 'self'` CSP
and keeps the API key out of any window context.

### Security posture (non-negotiable)

```ts
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    preload: path.join(__dirname, '../preload/index.js'),
  },
})
```

- CSP on the renderer: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`
- `app.on('web-contents-created')` → block `will-navigate` and deny `setWindowOpenHandler` for anything not `file://`/dev server
- `shell.openExternal` only for `https:` links the user explicitly clicks in rendered markdown
- No `remote` module, no `enableRemoteModule`

## 6. IPC surface

All IPC is typed and defined once in `src/shared/ipc.ts`. Request/response uses
`ipcRenderer.invoke`; streaming uses invoke to start + `webContents.send` for chunks.

| Channel | Direction | Payload → Result |
|---|---|---|
| `settings:get` | invoke | `void` → `Settings` (API key redacted to `hasApiKey: boolean`) |
| `settings:set` | invoke | `Partial<Settings>` → `Settings` |
| `settings:setApiKey` | invoke | `{ key: string }` → `{ ok: true }` |
| `server:test` | invoke | `void` → `{ ok, version?, latencyMs?, error? }` |
| `models:list` | invoke | `void` → `ModelCatalog` |
| `models:activate` | invoke | `{ modelId }` → `{ jobId \| null }` |
| `models:state` | invoke | `void` → `ServerState` |
| `models:stateChanged` | main→renderer | `ServerState` (pushed on every poll tick that changes state) |
| `chat:send` | invoke | `ChatSendRequest` → `{ requestId }` |
| `chat:chunk` | main→renderer | `{ requestId, delta, kind: 'content' \| 'reasoning' }` |
| `chat:done` | main→renderer | `{ requestId, finishReason, usage? }` |
| `chat:error` | main→renderer | `{ requestId, code, message }` |
| `chat:abort` | invoke | `{ requestId }` → `{ ok: true }` |
| `conv:list` | invoke | `void` → `ConversationSummary[]` |
| `conv:get` | invoke | `{ id }` → `Conversation` |
| `conv:create` | invoke | `{ title?, modelId }` → `Conversation` |
| `conv:appendMessage` | invoke | `{ id, message }` → `void` |
| `conv:rename` | invoke | `{ id, title }` → `void` |
| `conv:delete` | invoke | `{ id }` → `void` |
| `logs:fetch` | invoke | `{ source, lines }` → `{ lines: string[] }` |

`window.api` in the preload mirrors this 1:1 and nothing else is exposed.

## 7. Data model

```ts
// src/shared/types.ts
type Role = 'system' | 'user' | 'assistant'

interface Message {
  id: string                 // ulid
  role: Role
  content: string
  reasoning?: string         // from delta.reasoning_content or delta.reasoning
  modelId?: string           // which model produced it (assistant only)
  createdAt: string          // ISO 8601
  usage?: { promptTokens: number; completionTokens: number }
  error?: { code: string; message: string }
  stopped?: boolean          // user pressed Stop
}

interface Conversation {
  id: string                 // ulid
  title: string              // auto: first 48 chars of first user message
  createdAt: string
  updatedAt: string
  modelId: string            // model selected when the conversation started
  systemPrompt: string | null
  messages: Message[]
}

interface Settings {
  serverUrl: string          // https://harness.example.com
  hasApiKey: boolean         // never the key itself
  systemPrompt: string
  temperature: number        // default 0.7
  topP: number               // default 0.95
  maxTokens: number          // default 2048
  streamingEnabled: boolean  // default true
  theme: 'system' | 'light' | 'dark'
}

interface ModelInfo {
  id: string; displayName: string; params: string; quantization: string
  modelRef: string           // the engine's name for it — opaque, display only
  contextLength: number; available: boolean   // v1.1: `available` was `downloaded`
  state: 'idle' | 'loading' | 'ready' | 'stopping' | 'error'
  estimatedLoadSeconds: number
}

interface ServerState {
  reachable: boolean
  state: 'idle' | 'loading' | 'ready' | 'stopping' | 'error' | 'unreachable'
  activeModelId: string | null
  progressHint: string | null
  lastError: string | null
  gpu: { index: number; name: string; memoryUsedMb: number; memoryTotalMb: number }[]
}
```

### On-disk layout

```
<userData>/
  settings.json                 # Settings, minus the key
  secrets.bin                   # safeStorage-encrypted API key
  conversations/
    index.json                  # ConversationSummary[] — id, title, updatedAt, modelId
    01J8XR....json              # one Conversation per file
  logs/
    main.log                    # rotating, 5 files × 1 MB
```

Writes are atomic: write to `<file>.tmp`, `fsync`, `rename`. A corrupt
conversation file must never crash the app — log it and skip the entry.

## 8. UI specification

```
┌──────────────────────────────────────────────────────────────────────┐
│ ┌── sidebar ──┐  ┌──────────────── main pane ────────────────────┐   │
│ │ + New chat  │  │ ● GLM 4.7 Flash ▾    [●ready]         ⚙      │   │
│ │             │  ├───────────────────────────────────────────────┤   │
│ │ Today       │  │                                               │   │
│ │ ▸ Rust perf │  │   ┌ user ─────────────────────────────────┐   │   │
│ │ ▸ SQL notes │  │   │ how do I ...                          │   │   │
│ │             │  │   └───────────────────────────────────────┘   │   │
│ │ Yesterday   │  │   ┌ assistant · GLM 4.7 Flash ────────────┐   │   │
│ │ ▸ Draft memo│  │   │ ▸ Thinking (2.1s)                     │   │   │
│ │             │  │   │ You can ... ▋                         │   │   │
│ │             │  │   └───────────────────────────────────────┘   │   │
│ │             │  ├───────────────────────────────────────────────┤   │
│ │             │  │ ┌───────────────────────────────┐  ┌───────┐  │   │
│ │             │  │ │ Message GLM 4.7 Flash…        │  │ Stop  │  │   │
│ │             │  │ └───────────────────────────────┘  └───────┘  │   │
│ └─────────────┘  └───────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.1 Model dropdown

- Lists every model from `GET /admin/models`, with the active one marked.
- Status pill next to the name: `ready` (green), `loading` (amber, animated),
  `idle` (grey), `error` (red), `unreachable` (grey outline).
- Selecting a **different** model opens a confirmation dialog:

  > **Switch to Qwen 3.8 27B?**
  > This unloads GLM 4.7 Flash from the GPU and loads Qwen 3.8 27B.
  > Takes about 2 minutes. Any reply in progress will be cancelled.
  > `[Cancel]` `[Switch]`

- On confirm: `models:activate`, then the composer is disabled and a load banner
  appears above it showing elapsed time and `progressHint` from the server.
- On failure: banner turns red with `lastError` and a **View server logs** button
  that opens a modal fed by `logs:fetch`.
- Switching does **not** clear the current conversation. Subsequent assistant
  messages record the new `modelId` and the transcript shows a divider:
  `— switched to Qwen 3.8 27B —`.

### 8.2 Chat behaviour

- **Send:** `Enter`. **Newline:** `Shift+Enter`. Composer autogrows to 12 lines then scrolls.
- Sending appends the user message, persists immediately, then opens the stream.
- Assistant message renders progressively with a block cursor; markdown re-parses
  on a 60 ms throttle (do not re-parse per token).
- Code blocks: syntax highlighted, language label, copy button.
- `reasoning_content` accumulates into a `<details>`-style block, collapsed by
  default, labelled `Thinking (Ns)` once the stream ends.
- **Stop** button replaces Send while streaming; calls `chat:abort`, keeps the
  partial text, marks the message `stopped: true`.
- Auto-scroll follows the stream unless the user has scrolled up; then show a
  **Jump to latest** pill.
- Errors render inline in the message bubble with the code, and a **Retry** button
  that re-sends the same request.
- Each message has copy; the last assistant message additionally has regenerate.

### 8.3 Context assembly

For every request the main process builds `messages` as:

1. `{role:'system', content: conversation.systemPrompt ?? settings.systemPrompt}` — omitted if empty
2. all prior messages in the conversation, oldest first, excluding errored/empty ones
3. the new user message

MVP does **no** token counting or truncation. If the model returns a context-length
error, surface it verbatim and tell the user to start a new chat. (Token-aware
trimming is a post-MVP item — tracked, not built.)

### 8.4 Settings modal

Fields: Server URL, API key (password input, shows `••••` when set, with **Replace**),
System prompt (textarea), Temperature (0–2 slider), Top P (0–1), Max tokens (number),
Streaming (toggle), Theme (segmented).

**Test connection** button → `server:test`, showing `✓ Connected · v0.1.0 · 42 ms`
or the error. Saving is blocked until the URL parses as `https://` (allow `http://localhost` for dev).

### 8.5 First run

If no server URL is set, the app opens directly into Settings with a short
explainer and the Test connection button, rather than a broken chat window.

## 9. Server state polling

The main process runs one poller:

- Every **30 s** when state is `ready`/`idle`/`error`
- Every **2 s** while state is `loading` or `stopping`
- Immediately on window focus, and immediately after any activation request
- On 3 consecutive failures → state `unreachable`, back off to 60 s, keep retrying

Every state change is pushed to the renderer on `models:stateChanged`. The renderer
never polls on its own.

## 10. Acceptance criteria

The MVP is done when all of these pass on a clean machine against a real VM.

| # | Criterion |
|---|---|
| A1 | Fresh install opens Settings; entering URL + key and pressing Test connection shows a success with the server version |
| A2 | With a model `ready`, sending "Write a haiku about GPUs" streams tokens visibly within 3 s and completes without error |
| A3 | Pressing Stop mid-stream halts token flow within 500 ms, keeps the partial text, and the server-side request is cancelled (verify vLLM logs show the abort) |
| A4 | Switching the dropdown from GLM to Qwen shows the confirm dialog, disables the composer, shows elapsed-time progress, and re-enables within the advertised load window |
| A5 | After a switch, a new message is answered by the new model and the assistant bubble is labelled with it |
| A6 | Killing the vLLM process on the VM makes the app show `unreachable`/`error` within 60 s without crashing, and it recovers automatically once the model is back |
| A7 | Quitting and reopening the app restores the conversation list and the full transcript of the last conversation |
| A8 | The API key is not present in plaintext anywhere under `userData` (grep the directory) and is not readable from the renderer (`window.api` exposes no key getter) |
| A9 | Renderer DevTools shows zero network requests to the server origin |
| A10 | A malformed conversation JSON file is skipped with a logged warning; the app still starts |
| A11 | `npm run build` produces a launchable dmg on macOS |
| A12 | Sending with no model active shows a clear "no model loaded — pick one from the dropdown" message, not a raw 409 |

## 11. Performance targets

| Metric | Target |
|---|---|
| Cold app start to interactive | < 2.5 s |
| Time from Send to first visible token (model ready, 1k-token prompt) | < 2 s over a good connection |
| UI frame rate during streaming | ≥ 50 fps with a 4k-token response on screen |
| Memory after 20 conversations loaded | < 500 MB RSS |

## 12. Risks

| Risk | Mitigation |
|---|---|
| Model load takes far longer than estimated on first run (weights download) | `progressHint` from the server surfaces download progress; pre-download weights during VM provisioning (server repo's job) |
| Streaming stalls silently (network drop mid-SSE) | 60 s idle-chunk timeout in the main process → `chat:error` with `stream_stalled` |
| Markdown re-parse per token tanks the UI | Throttled parsing, virtualized message list if a conversation exceeds 200 messages |
| API key leaks into logs | Central redaction helper applied to every log call; unit test asserts the key never appears in log output |
| Contract drift between repos | `docs/API-CONTRACT.md` is byte-identical in both repos; CI job fails if the hashes differ |
