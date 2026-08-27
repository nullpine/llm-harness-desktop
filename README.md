# llm-harness-desktop

An Electron chat client for a privately hosted open-weights LLM. Talks to
[`llm-harness-server`](https://github.com/nullpine/llm-harness-server), which today
runs Ollama on the same Mac — no cloud, no cost. The server's vLLM backend targets
an Azure GPU VM when quota exists; this app cannot tell the difference, because the
HTTP contract is the same. Pick a model from the dropdown, chat with it, history
stays on your machine.

> **MVP.** One user, one server, one model loaded at a time. See `docs/SPEC.md` §3
> for the deliberately long list of things this does not do.

## Installing the dmg

`npm run build` produces `dist/LLM Harness-<version>-arm64.dmg`. Mount it and drag
the app to Applications.

**Expect macOS to refuse the first launch.** `electron-builder.yml` sets
`identity: null`, so the build carries only an ad-hoc signature — no Developer ID,
no notarization. Code signing needs a paid Apple Developer account and is on the
post-MVP list. Gatekeeper cannot tell an unverified build from a tampered one, so
it blocks both.

Which dialog you get depends on the build, and both are expected:

- *"LLM Harness" cannot be opened because the developer cannot be verified.*
  **Right-click → Open** (⌃-click works too), then click **Open** in the dialog
  that follows. Do this once; macOS remembers. Double-clicking *first* gives a
  dialog with no Open button, which is why the right-click matters.
- *"LLM Harness" is damaged and can't be opened.* Misleading — it usually means the
  quarantine flag plus a signature Gatekeeper will not accept, not a bad download.
  Clear the flag and open normally:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/LLM Harness.app"
  ```

Neither is a failure of the app; both go away with a signed, notarized build.
`spctl -a -vv "/Applications/LLM Harness.app"` will tell you what Gatekeeper
actually thinks. If you would rather not do any of this, run it from source with
`npm run dev` — the section below.

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

The mock serves two fake models, simulates a model load (8 s by default,
`MOCK_LOAD_MS` to change it) and streams tokens, so the entire UI can be built and
tested with no server at all.

## Connecting to a real server

Start the server (in the `llm-harness-server` repo, `./scripts/dev-local.sh` — it
prints the API key and serves on `http://127.0.0.1:8080`). Then open **Settings**
(⌘,) and enter:

- **Server URL** — `http://localhost:8080` locally, or `https://your-harness-host`
  for a remote deployment
- **API key** — the one `dev-local.sh` printed; it is also in the server repo's
  `.env.local`

Press **Test connection**: it checks `/healthz` *and* makes an authenticated call,
because `/healthz` needs no key and would otherwise report success with a wrong
one. The key is encrypted with the OS keychain (`safeStorage`) and never reaches
the renderer process.

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
