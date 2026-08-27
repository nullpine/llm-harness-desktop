# ADR-0001: Electron with electron-vite, not a browser app or Tauri

**Status:** accepted
**Date:** 2026-08-25

## Context

The client needs to hold an API key, stream responses from a server on the local
network or the internet, and keep conversations on disk. It is a single-user
desktop tool for one developer's own machine.

Three options.

**A browser app.** No install, but the two things this most needs are exactly what
a browser refuses: a credential that survives without a server session to hold it,
and direct access to a host on `127.0.0.1` from an origin that is not there. It
would push the key into `localStorage` — readable by any script that gets into the
page — and add CORS to the server for no gain.

**Tauri.** Smaller binaries and a Rust backend, both real advantages. Against it:
the webview is the OS's, so rendering differs by machine and by macOS version,
which for a markdown-and-streaming UI is the surface most likely to bite. It would
also mean writing the streaming HTTP client in Rust rather than in the same
language as the UI.

**Electron.** Large binaries and a well-known security surface, which has to be
managed rather than assumed away.

## Decision

**Electron**, built with **electron-vite**.

- one Chromium, one Node, identical on every machine
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and a
  `contextBridge` preload that exposes exactly the IPC surface and nothing else
- electron-vite for the build: one config covering main, preload and renderer, HMR
  in development, and a packaged output where each of the three is a separate
  bundle

## Consequences

- ~200 MB per build, and the whole Electron threat model. That is the price, and
  the mitigations above are not optional extras — they are what makes the choice
  defensible.
- `sandbox: true` requires a **CommonJS preload**. This is not obvious and cost a
  blank window once: an ESM preload fails silently, taking the whole UI with it.
  CI now asserts the invariant on the built output — `out/preload/index.cjs`
  exists, contains `require(`, and has no top-level `import` — rather than
  asserting a filename.
- The renderer is a normal React app with normal tooling, and the streaming client
  is TypeScript shared with the rest of the code.
- Rewriting the shell later (Tauri, or a native app) would not touch the server
  contract, which is where the value is.
