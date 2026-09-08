# ADR-0002: The renderer has no network access

**Status:** accepted
**Date:** 2026-08-25

## Context

The app renders model output as markdown. Model output is untrusted text — not
because the model is hostile, but because it is a program that turns arbitrary
input into arbitrary output, and some of that input comes from whatever the user
pastes in.

If the renderer could make requests, a single sanitizer bug would be enough to
exfiltrate the conversation, or the API key if it were reachable from there. The
convenient design — `fetch` in a React hook, key in a store — puts the credential
and the attack surface in the same process.

## Decision

**All HTTP happens in the main process.** The renderer talks to it over IPC and
makes no network requests at all.

- the API key is read by main, kept in a Node context, and **never** appears in an
  IPC response, an error message, a log line, or the `/admin/logs` ring buffer
- `window.api` exposes no key getter — there is nothing to leak, not merely
  nothing that leaks
- streaming, aborting and retrying live in one file (`harnessClient.ts`) with real
  tests, rather than being scattered through components
- the renderer runs under `connect-src 'self'`, applied from main via
  `onHeadersReceived` with a dev-only carve-out gated strictly on
  `ELECTRON_RENDERER_URL`

The CSP is the **backstop, not the rule**. The rule is that no `fetch` to the
server origin exists outside `harnessClient.ts`; `.claude/rules/network-boundary.md`
states it, and the CSP is what holds if someone breaks it anyway.

## Consequences

- Every request costs an IPC round trip, and streaming needs a channel per chunk
  (`chat:chunk` / `chat:done` / `chat:error`) rather than an async iterator. Worth
  it.
- The main process owns abort too, which is what made "quit without losing the
  in-flight reply" a change in one place.
- Tests can assert the boundary directly: a Playwright spec records CDP network
  events and fails if the renderer requests the server origin, and a positive
  control proves the recorder would have seen it.
- Anything the UI needs from the network must be added to the IPC surface
  deliberately. That friction is the point.
