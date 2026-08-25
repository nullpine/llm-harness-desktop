---
description: SSE parsing, abort semantics, and the IPC result convention
paths:
  - "src/main/services/sseStream.ts"
  - "src/main/services/harnessClient.ts"
  - "src/main/ipc/**"
  - "src/shared/**"
  - "src/renderer/stores/**"
  - "src/renderer/hooks/**"
---

# Streaming and IPC

## Nothing throws across IPC

Handlers return `Result<T, AppError>`:

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }
interface AppError { code: string; message: string; retryable: boolean }
```

An uncaught exception in a handler is a bug. The renderer branches on `ok`.

## SSE parsing

- **Frames split across TCP reads.** Buffer partial lines. A test must cover a
  chunk boundary landing in the middle of a `data:` payload.
- Handle `data: [DONE]`, blank-line frame separators, and `delta.reasoning_content`
  alongside `delta.content`.
- **60-second idle timeout between chunks** → emit `chat:error` with
  `stream_stalled`. A stalled stream must not hang forever.
- Never auto-retry a stream that already emitted tokens.

## Abort

`chat:abort` must abort the underlying `fetch` via `AbortController`. Merely
stopping the read leaves the GPU generating and costs real money. Verify the
server logs an aborted request.

## Ownership of the transcript

The main process owns the canonical persisted conversation; the renderer's copy is
a view keyed by `requestId`. If they disagree, reload from disk — main wins.

Full detail: `docs/ARCHITECTURE.md`, `docs/API-CONTRACT.md`.
