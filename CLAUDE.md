# CLAUDE.md — llm-harness-desktop

Instructions for Claude working in this repository. Read this before writing code.

## What this repo is

An Electron desktop chat client for a privately hosted open-weights LLM running on
an Azure GPU VM. The server side lives in a **separate repo**, `llm-harness-server`.

## How to load context

This file loads automatically. **Nothing in `docs/` does.** Read them explicitly:

| Read | When |
|---|---|
| `docs/SPEC.md` | before any feature work — scope, UI spec, acceptance criteria |
| `docs/API-CONTRACT.md` | before touching `services/harnessClient.ts` or `ipc/` |
| `docs/ARCHITECTURE.md` | before adding a service, store, or IPC channel |
| `docs/PROJECT-STRUCTURE.md` | before creating a new file — it says where things go |
| `docs/BACKLOG.md` | at the start of every session — find your current milestone |

`.claude/rules/` holds path-scoped rules that load automatically when you open the
files they cover. They are the short version; `docs/` is the long version.

**Start every session by reading `docs/BACKLOG.md` and stating which milestone and
item you are working on.**

## Ground rules

1. **The scope in `docs/SPEC.md` §3 is closed.** If a task appears to need
   something on the non-goals list, stop and say so instead of building it.
2. **The renderer never touches the network.** Every HTTP call goes through
   `src/main/services/harnessClient.ts`. A `fetch` to the server origin anywhere
   else is a bug, not a shortcut.
3. **The API key never leaves the main process.** It is not in `Settings`, not in
   an IPC response, not in a log line, not in an error message.
4. **Never edit `docs/API-CONTRACT.md` unilaterally.** It is byte-identical to the
   copy in the server repo. A change means a PR in both, and a version bump.
5. **Nothing throws across IPC.** Handlers return `Result<T, AppError>`.
6. `strict` TypeScript. No `any`, no `@ts-ignore`, no non-null `!` without a
   comment explaining why it holds.

## Working method

- Work one backlog item at a time. Each is sized to a single PR.
- Write the test with the code, in the same commit. `src/main/services` and
  `src/shared` require unit tests; UI components need tests only where there is
  real logic (grouping, formatting, streaming assembly).
- Before opening a PR: `npm run typecheck && npm run lint && npm run test` all clean.
- If the spec is ambiguous or wrong, say so in the PR description and propose the
  fix. Do not silently invent behaviour — an ambiguity resolved quietly becomes a
  contract mismatch with the server two weeks later.

## Local development without a VM

You do not need the Azure VM to build almost all of this:

```bash
npm run dev:mock     # starts scripts/dev-mock-server.mjs on http://localhost:8787
npm run dev          # electron-vite dev, pointed at the mock by .env
```

The mock implements the full contract including simulated 90-second model loads
and token-by-token SSE. **Build against the mock; verify against the VM.** Every
new server behaviour you rely on must exist in the mock first.

## Commands

| Command | Does |
|---|---|
| `npm run dev` | electron-vite dev with HMR |
| `npm run dev:mock` | mock server implementing the API contract |
| `npm run typecheck` | `tsc --noEmit` across all three tsconfigs |
| `npm run lint` | eslint + prettier check |
| `npm run test` | vitest unit tests |
| `npm run test:e2e` | playwright electron smoke tests (uses the mock) |
| `npm run build` | electron-builder for the current platform |

## Commits and PRs

- Conventional commits: `feat(chat): stream reasoning_content into a collapsed block`
- One backlog item per PR; the PR description links the item and lists which
  acceptance criteria from `docs/SPEC.md` §10 it moves forward
- Include a screenshot or a short recording for any PR that changes the UI

## Things that will bite you

- **Markdown re-parsing per token** destroys frame rate. Throttle to ~60 ms.
- **`sandbox: true` breaks naive preload code.** The preload runs in a limited
  context; keep it to `contextBridge` plumbing with no Node API use beyond `ipcRenderer`.
- **SSE frames split across TCP reads.** `sseStream.ts` must buffer partial lines.
  Test it with a chunk boundary in the middle of a `data:` payload.
- **Aborting a stream** must abort the underlying `fetch` via `AbortController`,
  not just stop reading — otherwise the GPU keeps generating.
- **`safeStorage.isEncryptionAvailable()` can be false** on some Linux desktops.
  Handle it: warn the user and refuse to persist the key rather than writing plaintext.
