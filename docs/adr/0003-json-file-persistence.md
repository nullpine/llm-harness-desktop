# ADR-0003: JSON files on disk, not SQLite

**Status:** accepted
**Date:** 2026-08-25

## Context

Conversations have to survive a quit. The realistic volume is one user and a few
hundred conversations, each a list of messages.

SQLite is the obvious answer and would give transactions — a real one, covering
the transcript and its summary together. Against it in Electron: `better-sqlite3`
is a native module, which means rebuilding per Electron version and per
architecture, and a packaged app that fails at runtime rather than at build time
when that goes wrong. That is a meaningful cost for a workload with no queries in
it.

## Decision

**One JSON file per conversation**, plus an `index.json` of summaries, written
atomically (`tmp` → `fsync` → `rename`), all behind a `ConversationRepository`
interface so the move to SQLite touches one file.

Two rules follow from having no transaction:

- **The conversation file is the source of truth; `index.json` is a cache.** The
  transcript is written first, deliberately, so the survivable failure is a
  complete transcript with a stale summary — never a summary promising a message
  the transcript does not contain. A stale entry is repaired lazily when the
  conversation is opened.
- **A corrupt file is skipped with a logged warning, never a failed startup**
  (acceptance A10). `forget()` drops it from the sidebar but leaves the file on
  disk, because it may be recoverable by hand.

Ids are validated before they touch the filesystem: a renderer-supplied
`../settings` must not read or delete anything.

## Consequences

- No transactions, hence the source-of-truth rule above, and hence
  `before-quit` waiting for in-flight writes.
- No search, which is a non-goal anyway (SPEC §3) and would be the thing that
  forces SQLite.
- The files are readable and repairable with a text editor, which for a personal
  tool is worth more than query performance.
- Atomic writes mean the failure mode is never a half-written file. It is a
  *missing* update, which is quieter and needed the quit-path fix to close.
