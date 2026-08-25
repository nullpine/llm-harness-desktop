---
description: Where network access and the API key are allowed to live
paths:
  - "src/renderer/**"
  - "src/preload/**"
  - "src/main/services/**"
  - "src/main/ipc/**"
---

# Network boundary

**The renderer makes no network requests. Ever.**

- Every HTTP call to the harness server goes through `src/main/services/harnessClient.ts`.
  A `fetch` against the server origin in any other file is a bug, not a shortcut.
- The API key lives only in the main process. It is never in a `Settings` object,
  an IPC response, a log line, an error message, or a `window.api` getter.
  `Settings` carries `hasApiKey: boolean` and nothing more.
- The preload exposes exactly the channels in `src/shared/ipc.ts` and nothing else.
  No `ipcRenderer` passthrough, no Node APIs, no `require`.
- Window options are fixed: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. Do not relax any of them to make something work — if something
  needs Node, it belongs in main.

If a feature seems to need the renderer to reach the network, it belongs in a new
IPC handler. Say so rather than opening the boundary.

Full reasoning: `docs/ARCHITECTURE.md`, ADR-0002.
