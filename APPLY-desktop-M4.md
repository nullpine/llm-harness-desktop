# TASK: Desktop M4 — harden

You are in `llm-harness-desktop`. Branch `m4/harden` off `main`.
Delete this file as part of the work.

Read first: `CLAUDE.md`, `docs/SPEC.md` (§7, §9, §10), `docs/ARCHITECTURE.md`,
and `.claude/rules/`.

Part 1 is a data-loss bug. Do it first, in its own commit, before anything else.

---

## Part 1 — quit does not lose the reply

**The bug:** nothing awaits persistence on quit. `window-all-closed` calls
`app.quit()` immediately, and `chat:send` launches the stream as
`void streamReply({...})` with nothing tracking it. Quitting mid-reply kills the
process before `persist()` runs.

`atomicWrite` does tmp → fsync → rename, so the file is never half-written. The
observable result is therefore **an intact, valid conversation silently missing the
reply the user just watched arrive** — no warning, no damaged-entry marker, nothing
to notice. That is worse than corruption, not better.

### The fix

1. `before-quit` → `event.preventDefault()`, **guarded against re-entry** so the
   second quit is not also trapped.
2. **Abort every in-flight stream** via its `AbortController`. Do not wait for
   replies to finish — that could take minutes, and on a metered backend it would
   keep generating. Aborting also stops the model.
3. Persist each partial assistant message through **the same path the Stop button
   uses**, marked `stopped: true`. Reuse it; a second persistence path will drift
   from the first.
4. Await outstanding persists with a **2000 ms deadline**. A conversation file is a
   few KB and fsync is milliseconds — that is roughly a thousandfold headroom and
   imperceptible. On timeout, log and exit anyway: a hung quit is worse than a lost
   message, and `atomicWrite` means you cannot leave a half-file either way.
5. `app.exit(0)`.

Track outstanding work explicitly. `void streamReply(...)` in `chat:send` is the
hole — register each stream in a set, clear it on done/error/abort.

### The second exposure

`appendMessage` writes the conversation file and `index.json` as two separate atomic
writes. A quit between them leaves a stale index — correct transcript, wrong
title/timestamp — and nothing detects it, because a stale-but-valid index parses fine.

**Do not add a transaction.** Make the rule explicit instead:

> The conversation file is the source of truth. `index.json` is a cache.

- Guarantee conversation-file-first ordering, so a kill between writes leaves a
  complete transcript with a stale summary — the better failure direction.
- Correct entries lazily: when a conversation is opened, if the file disagrees with
  its index entry, refresh the entry.
- Document this in `docs/ARCHITECTURE.md` beside the persistence section.

### Tests

- Unit: quit with an in-flight stream persists the partial and marks it `stopped`.
- Unit: the 2000 ms deadline expires cleanly rather than hanging.
- e2e: **quit mid-stream, reopen, assert the partial reply is present and marked
  stopped.** The tightened A7 no longer covers this — it now waits for completion,
  which is correct for A7 and leaves this case uncovered.
- Break the code and confirm each fails.

## Part 2 — escalating backoff

SPEC §9 polls every 30 s when settled and needs three consecutive failures, so a
dead control plane takes up to 90 s to surface. A6 asks for 60 s. Shortening the
interval or the failure count outright trades away the quiet period §9 exists for.

**Escalate instead: fast to detect, slow to nag.**

- Settled: 30 s (unchanged)
- On the **first** failure, retry after 5 s; on the second, after 15 s
- Third consecutive failure → `unreachable`
- Once `unreachable`, back off to 60 s and stay there until it recovers
- Loading/stopping: 2 s (unchanged)

Worst case becomes ~30 s to notice plus 20 s to confirm ≈ 50 s, inside A6's 60 s,
while a genuinely-down server is still only polled once a minute.

Update **SPEC §9** to describe the escalation, and update the A6 note in §10 that
currently records the 90 s figure. Add a unit test asserting the interval sequence.

## Part 3 — audit, don't assume

Two items were specified in M1/M2. Check whether they exist and work; implement only
what is missing, and say which was which:

- **60 s idle-chunk timeout** between SSE frames → `stream_stalled` (SPEC §9,
  `.claude/rules/streaming-and-ipc.md`). Is it wired, and does it fire?
- **Retry on a failed message** — SPEC §8.2 requires a Retry that re-sends the same
  request. Does it exist, and does it work after a `stream_stalled`?

## Part 4 — the A7 flake

Already tightened, and artifact retention is configured. Nothing more unless it
recurs. If it does, the preserved trace is now the evidence — do not re-tighten the
test until the trace has been read.

---

## Exit

    npm run typecheck && npm run lint && npm run test && npm run test:e2e && npm run build

Then by hand, against the real server:

- Send a long reply, ⌘Q while it is still streaming, reopen. **The partial reply is
  there, marked stopped.** This is the milestone.
- `pkill ollama`, watch the header. It should reach `error` in under 60 s.

## Checks before you commit

- Part 1 is its own commit, first
- `docs/API-CONTRACT.md` not in the diff
- No second persistence path — the quit handler reuses the Stop path
- No CHANGELOG entry
- This file deleted

Commit Part 1 as:

    fix: persist in-flight replies before quitting (data loss)
