# llm-harness-desktop

An Electron chat client for a privately hosted open-weights LLM. It talks to
[`llm-harness-server`](https://github.com/nullpine/llm-harness-server) over one
HTTP contract, and **cannot tell which engine is behind it** — Ollama on your Mac,
vLLM on a rented GPU, or a hosted provider all look identical from here. Pick a
model, chat, history stays on your machine.

```bash
npm install
npm run dev:mock   # terminal 1 — a fake server, no LLM needed
npm run dev        # terminal 2 — the app
```

> **MVP.** One user, one server, one model loaded at a time. `docs/SPEC.md` §3 has
> the deliberately long list of things this does not do.

---

## 1. Architecture

### The one decision everything follows from

**The renderer has no network access.** Every HTTP call to the server happens in
the main process. That costs a little plumbing — each request becomes an IPC round
trip — and buys three things:

- the API key lives only in a Node context, never in a window that renders markdown
- the renderer runs under `default-src 'self'`, so a malicious model response
  cannot exfiltrate anything even if it smuggles HTML past the sanitizer
- streaming, aborting and retrying are implemented once, in one file, with real
  tests — instead of scattered through React components

```
┌── renderer (Chromium, sandboxed) ──────────────────────────┐
│  React 19 + Zustand. Renders state, calls window.api.*      │
│  Receives chat:chunk / models:stateChanged events           │
│  MAKES NO NETWORK REQUESTS                                  │
└───────────────┬────────────────────────────────────────────┘
                │  contextBridge (preload — typed, minimal)
┌───────────────▼────────────────────────────────────────────┐
│  main (Node) — owns the key, the network, and the disk      │
│                                                             │
│  ipc/*.handlers.ts  ──▶  harnessClient.ts   ─┐              │
│                          sseStream.ts        ├─▶ HTTPS ──▶ server
│                          serverPoller.ts    ─┘              │
│                          settingsStore.ts    ──▶ userData/  │
│                          secretStore.ts      ──▶ Keychain   │
│                          conversationStore.ts ─▶ userData/  │
└─────────────────────────────────────────────────────────────┘
```

Four source roots, and the boundaries are rules rather than conventions:

| | |
|---|---|
| `src/main` | Node. Settings, the API key, all HTTP, all disk I/O |
| `src/preload` | the `contextBridge`. Exposes `window.api` and nothing else |
| `src/renderer` | React UI. **No network.** |
| `src/shared` | types and IPC channel definitions, imported by all three |

Enforced invariants — each is a ground rule in `CLAUDE.md`, not a preference:

- **The renderer never touches the network.** A `fetch` to the server origin
  anywhere outside `harnessClient.ts` is a bug, not a shortcut.
- **The API key never leaves the main process.** Not in `Settings`, not in an IPC
  response, not in a log line, not in an error message.
- **Nothing throws across IPC.** Handlers return `Result<T, AppError>`.
- **`docs/API-CONTRACT.md` is byte-identical to the server's copy.** Changing it
  means a PR in both repos and a version bump.

`docs/ARCHITECTURE.md` has the data flows, error handling and threat model.

### Persistence

One JSON file per conversation, written atomically (`tmp` → `fsync` → `rename`)
behind a `ConversationRepository` interface, so the post-MVP move to SQLite touches
one file.

**The conversation file is the source of truth; `index.json` is a cache.** They are
two separate atomic writes, and the conversation is written first on purpose: the
survivable failure is a complete transcript with a stale summary, never a summary
promising a message that is not there. A corrupt file is a logged warning and a
skipped list entry — never a failed startup.

---

## 2. Running it

Three ways, in increasing order of what they need.

### a. Against the mock — no server, no model, no GPU

```bash
npm run dev:mock      # terminal 1 — http://localhost:8787
npm run dev           # terminal 2
```

The mock implements the whole contract: two fake models, a simulated load (8 s,
`MOCK_LOAD_MS` to change it) and token streaming. The entire UI can be built and
exercised with no LLM anywhere.

### b. Against a real server

In the `llm-harness-server` repo, pick a deployment and start it:

```bash
make profile          # show the deployment profiles
make profile ollama   # local Mac, free — or: runpod, vllm
make dev              # prints the API key, serves on 127.0.0.1:8080
```

Then in the app, **Settings (⌘,)**:

- **Server URL** — `http://localhost:8080`, or `https://your-harness-host` for a
  remote deployment
- **API key** — printed by `make dev`; also in the server repo's `.env.local`

Press **Test connection**. It checks `/healthz` *and* makes an authenticated call,
because `/healthz` needs no key and would otherwise report success with a wrong
one. The key is encrypted with the OS keychain (`safeStorage`) and never reaches
the renderer.

Which deployment the server runs makes no difference here — that is the point of
the contract. A single-model deployment (a GPU pod serving one model) simply shows
one entry in the dropdown.

### c. From the packaged dmg

`npm run build` produces `dist/LLM Harness-<version>-arm64.dmg`. Mount it and drag
the app to Applications.

**Expect macOS to refuse the first launch.** `electron-builder.yml` sets
`identity: null`, so the build carries only an ad-hoc signature — no Developer ID,
no notarization. Code signing needs a paid Apple Developer account and is post-MVP.
Gatekeeper cannot tell an unverified build from a tampered one, so it blocks both.

Either dialog is expected:

- *"LLM Harness" cannot be opened because the developer cannot be verified.*
  **Right-click → Open** (⌃-click works too), then **Open**. Once; macOS remembers.
  Double-clicking *first* gives a dialog with no Open button, which is why the
  right-click matters.
- *"LLM Harness" is damaged and can't be opened.* Misleading — usually the
  quarantine flag plus a signature Gatekeeper will not accept, not a bad download:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/LLM Harness.app"
  ```

`spctl -a -vv "/Applications/LLM Harness.app"` reports what Gatekeeper actually
thinks. Neither dialog is a failure of the app, and both go away with a signed,
notarized build. To avoid all of it, run from source with `npm run dev`.

**Requirements:** Node 22 LTS (`.nvmrc`), macOS on Apple Silicon for the dmg.

---

## 3. What the client owes the server

`docs/API-CONTRACT.md` is authoritative. The obligations that shape this codebase:

- **Correlate replies by your own request, never by the frame's `model` field.**
  Frames are relayed verbatim, so `model` carries the *engine's* name
  (`glm-4.7-flash:q4_K_M`, `zai-org/GLM-4.7-Flash`) rather than the catalog id you
  asked for.
- **Tolerate both reasoning spellings** — `delta.reasoning_content` (vLLM) and
  `delta.reasoning` (Ollama). `sseStream.ts` normalises them; `ReasoningBlock`
  renders either in a collapsed Thinking block.
- **Never auto-retry a stream that already emitted tokens.**
- **Buffer partial SSE lines.** Frames split across TCP reads, so a naive
  line-splitter drops content.
- Poll `/admin/state` while loading, with backoff; 60 s idle timeout between
  chunks; no total timeout on a completion — a long answer is not a hung one.
- Every non-2xx from the server uses one envelope,
  `{"error":{"code","message","details"}}`. `errorCopy.ts` turns those codes into
  sentences: a person should never see a raw code or an HTTP status.

---

## 4. Scripts

| | |
|---|---|
| `npm run dev` | dev with HMR |
| `npm run dev:mock` | the mock server |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | eslint (`--max-warnings 0`) + prettier |
| `npm run test` | vitest |
| `npm run test:e2e` | playwright, against a real Electron build |
| `npm run build` | package for the current platform |

Unit tests cover pure logic; the eight e2e specs drive the packaged app and cover
acceptance criteria A1–A10 and A12. **A11 — launching the dmg on a machine that has
never run it — is the one criterion that needs a human**, and is tracked as such in
`docs/BACKLOG.md`.

---

## 5. Data and security

Conversations and settings live in the Electron `userData` directory as JSON. The
API key is in `secrets.bin`, encrypted by the OS keychain. **Nothing is sent
anywhere except your own server.**

`safeStorage.isEncryptionAvailable()` can be false on some Linux desktops; the app
must degrade rather than crash there.

The server side is a single shared API key, one user, one client — appropriate for
one person and nothing more. Any key holder can also switch the model for everyone,
since one key opens both `/v1` and `/admin`. Multi-user identity is a post-MVP
*replacement*, not a layer to add later.

---

## 6. Documentation

| | |
|---|---|
| `docs/SPEC.md` | what the MVP is, and what it is not |
| `docs/ARCHITECTURE.md` | process model, data flows, error handling, threat model |
| `docs/API-CONTRACT.md` | the server's HTTP surface — byte-identical copy in the server repo |
| `docs/PROJECT-STRUCTURE.md` | the full tree |
| `docs/BACKLOG.md` | milestone-by-milestone task list |
| `docs/adr/` | why the main process owns the network, why JSON persistence |
| `CLAUDE.md` | working instructions for AI contributors |

## License

MIT
