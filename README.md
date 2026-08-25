# llm-harness-desktop

An Electron chat client for a privately hosted open-weights LLM. Talks to
[`llm-harness-server`](https://github.com/nullpine/llm-harness-server), which runs
vLLM on an Azure GPU VM. Pick a model from the dropdown, chat with it, history
stays on your machine.

> **MVP.** One user, one VM, one model loaded at a time. See `docs/SPEC.md` §3 for
> the deliberately long list of things this does not do.

## Requirements

- Node 22 LTS (`.nvmrc`)
- A running `llm-harness-server` deployment, **or** nothing at all — the bundled
  mock server implements the whole API contract

## Quick start (no VM needed)

```bash
npm install
npm run dev:mock      # terminal 1 — mock server on http://localhost:8787
npm run dev           # terminal 2 — the app
```

The mock serves two fake models, simulates a 90-second model load, and streams
tokens, so the entire UI can be built and tested without spending a cent on GPU time.

## Connecting to a real server

Open **Settings** (⌘,) and enter:

- **Server URL** — `https://your-harness-host`
- **API key** — printed once by the server's `provision.sh`

Press **Test connection**. The key is encrypted with the OS keychain
(`safeStorage`) and never reaches the renderer process.

## Scripts

| | |
|---|---|
| `npm run dev` | dev with HMR |
| `npm run dev:mock` | mock server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint + prettier |
| `npm run test` | vitest |
| `npm run test:e2e` | playwright electron smoke tests |
| `npm run build` | package for the current platform |

## Where things live

`docs/PROJECT-STRUCTURE.md` has the full tree. The short version:

- `src/main` — Node process. Owns settings, the API key, all HTTP, and all disk I/O.
- `src/preload` — the `contextBridge`. Exposes `window.api` and nothing else.
- `src/renderer` — React UI. **Makes no network requests.**
- `src/shared` — types and IPC channel definitions, imported by all three.

## Documentation

| | |
|---|---|
| `docs/SPEC.md` | what the MVP is, and what it is not |
| `docs/API-CONTRACT.md` | the server's HTTP surface (identical copy in the server repo) |
| `docs/ARCHITECTURE.md` | process model and data flow |
| `docs/BACKLOG.md` | milestone-by-milestone task list |
| `CLAUDE.md` | working instructions for AI contributors |

## Data on disk

Conversations and settings live in the Electron `userData` directory as JSON.
The API key is in `secrets.bin`, encrypted by the OS. Nothing is sent anywhere
except your own server.

## License

MIT
