# LLM Harness — MVP Roadmap

Desktop milestones only. The server side of each milestone lives in
[llm-harness-server/docs/BACKLOG.md](https://github.com/nullpine/llm-harness-server/blob/main/docs/BACKLOG.md).
Milestone numbering is shared; contents are per-repo.

---

## M0 — Foundations (½ day, both repos)

Nothing runs yet; everything is in place to start.

- [x] Create both GitHub repos, private, with the directory trees from
      `docs/PROJECT-STRUCTURE.md` (empty files with a one-line docstring are fine)
- [x] Commit `SPEC.md`, `API-CONTRACT.md`, `PROJECT-STRUCTURE.md`, `CLAUDE.md`,
      `README.md` to each
- [x] Toolchain: `package.json` / `pyproject.toml`, lint, format, typecheck, test
      runner — all wired and passing on an empty codebase
- [x] CI green on both repos
- [ ] GitHub milestones M1–M5 created; the issues below filed against them
      *(not done — the work was tracked in this file and in PRs instead)*

**Exit:** `npm run typecheck && npm run lint && npm run test` and
`make lint && make test` both pass on a repo with no features.

---

## M1 — Serve one model / stand up the shell (2–3 days)

### desktop
- [x] `src/shared/types.ts`, `ipc.ts`, `constants.ts`
- [x] `scripts/dev-mock-server.mjs` implementing the full contract, incl. fake loads
- [x] `harnessClient.ts` + `sseStream.ts`, unit-tested against the mock
- [x] `settingsStore.ts` + `secretStore.ts`
- [x] Window with security hardening, preload bridge, empty React shell
- [x] Settings modal with Test connection working end to end
- [x] Mock server serves both /healthz versions (`version` = contract, `service_version` = build) and the renamed /admin/models fields (`model_ref`, `available`)
- [x] `sseStream.ts` tolerates `delta.reasoning` (Ollama) as well as `delta.reasoning_content` (vLLM) — Ollama is the local MVP path, so this is the one that actually fires
- [x] Nothing keys off a chunk's `model` field; responses correlate by requestId only
- [x] e2e harness: `playwright.config.ts` and `e2e/` now drive the built app via `_electron`, covering A1, A2, A3, A7, A8, A9, A10 and A12. Runs in CI after `build`.

**Exit (desktop):** A1, A8, A9 from `SPEC.md` §10.

---

## M2 — Chat, and switch models (3–4 days)

### desktop
- [x] `conversationStore.ts` with atomic writes and corrupt-file tolerance
- [x] Chat pane: message list, bubbles, markdown, code copy, streaming cursor
- [x] Composer: Enter/Shift+Enter, autogrow, Stop button with real abort
- [x] `serverPoller.ts` adaptive polling → `models:stateChanged`
- [x] Conversation sidebar: create, list, rename, delete, date grouping
- [x] Reasoning block (collapsed `Thinking`)

**Exit (desktop):** A2, A3, A7, A10, A12.

---

## M3 — The dropdown (1–2 days, desktop)

- [x] `ModelDropdown` + `ModelStatusPill` fed by the catalog
- [x] `SwitchModelDialog` with the honest load-time warning
- [x] `LoadingBanner` with elapsed time and `progressHint`; composer disabled
- [x] Failure path: red banner, `lastError`, **View server logs** modal
- [x] `— switched to X —` divider in the transcript; per-message `modelId` label
- [x] `unreachable` state handling and automatic recovery

**Exit:** A4, A5, A6 — all covered by `e2e/switching.spec.ts`.

---

## M4 — Harden (2 days)

- [x] Idle-chunk timeout — **audited, already worked.** `sseStream` honours
      `SSE_IDLE_TIMEOUT_MS`, emits `stream_stalled`, and aborts the request; a
      test already proved it fires. Nothing to implement.
- [x] Retry on a failed message — **audited, was broken.** The button was gated on
      `message.error && stream`, but `fail()` clears `activeRequestId`, so the
      stream buffer is null exactly when a message has an error. Retry was
      unreachable in the only case it exists for. Now keyed on the message alone.
- [x] Error envelope → friendly copy (M2)
- [x] **Quit waits for in-flight writes.** Fixed in M4: `before-quit` aborts live
      streams through the Stop path and awaits the persists with a 2 s deadline.
      *(Original report below, for the record.)*
  > ~~Quit does not wait for in-flight writes — data loss, not a test problem.~~
      Nothing handles `before-quit`; `window-all-closed` calls `app.quit()`
      immediately, and `chat:send` launches the stream as `void streamReply(...)`
      with nothing tracking it. Quitting mid-reply kills the process before
      `persist()` runs, so the whole assistant message is lost. `atomicWrite`'s
      tmp→rename means the file is intact-but-stale rather than corrupt, so the
      damaged-conversation path never fires and nothing reports it. The
      conversation file and `index.json` are also two separate atomic writes, so
      a quit between them leaves a stale index that nothing detects.
      Fix: `before-quit` → `preventDefault()`, await outstanding persists with a
      short deadline, then `app.exit()`. Found while diagnosing the A7 flake.
- [x] **Server:** `/admin/logs` was empty on the Ollama backend — the ring buffer
      was fed only by the vLLM stdout pump, so "View server logs" rendered "no log
      lines" on the path we actually run. **Fixed in the server's M4**: the buffer
      now carries the control plane's own lifecycle records, and a failed
      activation names the phase, the backend's own words, and that nothing will
      retry.
- [x] Escalating backoff — 5 s, 15 s, then `unreachable` at 60 s. Worst case to
      confirm a dead control plane is now ~50 s, inside A6. SPEC §9 and the §10
      note updated. *(Original item below, for the record.)*
  > ~~Reconsider SPEC §9's flat 60s backoff after three failures.~~ It is correct as
      specified, but a user who has just fixed their own config waits up to a
      minute with no feedback. An escalating retry (5s, 15s, 30s, 60s) would keep
      the quiet-period benefit without the dead minute.

      Related, found during M3: detecting that the **control plane** has died
      takes up to 90 s — 30 s settled poll x 3 consecutive failures — which
      exceeds A6's "within 60 s". A dead *model* is fine, because the server
      reports `error` itself and the next poll sees it inside 30 s. Either the
      failure count or the settled interval has to come down for the
      client-side path to meet the criterion.

**Acceptance coverage.** A1, A2, A3, A7, A8, A9, A10 and A12 are covered by the e2e
harness and re-checked on every CI run. Manual verification from here is only for
criteria the harness cannot reach: **A11** (the dmg launching on a clean machine).
A4, A5 and A6 joined the harness in M3.

**Exit (desktop):** the items above. The B-list exit criteria are server-side.

---

## M5 — Ship (1 day)

- [ ] `electron-builder` dmg that launches on a clean macOS machine — **A11, the
      one criterion that needs a human.** The dmg builds; launching it on a machine
      that has never run it cannot be automated from here
- [x] End-to-end run of every acceptance criterion, recorded — A1–A10 and A12 run
      in the e2e harness on every CI run; A11 is the manual one above. B1–B14 are
      the server's, and are unrunnable without GPU quota
- [x] README finished: setup from zero, and an **Installing** section covering the
      Gatekeeper right-click-Open step — an unsigned build that looks broken on
      first launch is the most likely reason someone gives up
- [x] ADRs written for the decisions actually made — 0001–0004 were empty templates
      marked *proposed*; they now carry the reasoning and are *accepted*
- [ ] Tag `v0.1.0` in both repos
- [x] Post-MVP backlog groomed from everything deferred along the way

**Exit:** you can hand someone the dmg and the provision script and they get a
working private LLM.

---

## Deferred — the post-MVP list

Kept here so it stays out of the MVP. Roughly in the order it will matter.

1. Token counting and context-aware history trimming
2. SQLite persistence behind the existing repository interface
3. Conversation search and export
4. Two models resident at once; per-conversation model pinning. No longer a
   multi-GPU question — the 48 GB Mac already holds both catalog models
   simultaneously, which is precisely why the server *verifies* the unload rather
   than trusting it. The blocker is design, not hardware: desktop ADR-0004 assumes
   one active model throughout, so this is a UI rethink first
5. vLLM sleep mode for sub-10-second switching (revisits the **server's**
   ADR-0002; this repo's ADR-0002 is a different decision)
6. Tool calling / MCP
7. Vision input (Qwen 3.8 27B already supports it)
8. Prometheus + Grafana; vLLM metrics scraping
9. Entra ID auth, multi-user
10. Bicep/Terraform for the VM; a systemd template unit per model
11. Code signing and notarization, then auto-update. Until then every install
    needs the right-click-Open dance the README documents, which is the most
    likely reason someone abandons the app on first launch — it looks broken
    rather than unsigned. Needs a paid Apple Developer account
12. Scale-to-zero: deallocate the VM on idle, start it from the app
13. A hosted OpenAI-compatible provider as a second catalog entry — the desktop app
    already speaks the contract, so pointing it at a hosted endpoint is a config
    change. Useful as the everyday default with the VM reserved for private work.
14. Real cross-repo contract check. Today each repo verifies its own
    API-CONTRACT.md against its own stamp, which catches a local edit that skipped
    re-stamping but not divergence between the repos. A CI step fetching the other
    repo's `.api-contract.sha256` and comparing would close it.
15. Show the app version in the UI. `package.json` is the source, `app.getVersion()`
    reaches the server as `X-Harness-Client: llm-harness-desktop/<version>` and the
    main-process log, but **nothing surfaces it to the user** — so a bug report
    cannot say which build it came from. A line in Settings needs an IPC channel;
    it was not worth adding during a release PR.
16. The A7 flake. `e2e/chat.spec.ts`'s reopen-and-restore case has failed
    intermittently. M4 confirmed the underlying data-loss bug it was pointing at
    and fixed it (`before-quit` now awaits the persists), and Playwright now keeps
    artifacts from failed attempts as well as the final one — but the flake itself
    was never reproduced, and `retries: 1` in CI means a recurrence stays invisible
    unless someone reads the artifacts. If it returns, the evidence is now there.
17. The full e2e suite degrades on a long local run. Every spec passes in
    isolation — `azure-states.spec.ts` runs its six tests in 1.6 min, `first-run`
    its five in 2.4 s — but a full 43-test sequential run on this machine has taken
    24 min to 2.7 h, with individual tests reporting 15–18 min *against a 60 s
    test timeout*, failing a different three each time. Not disk (405 GB free),
    not orphaned processes (zero afterwards), and not the first-launch binary scan
    (it persists across runs). CI on a clean runner is currently the only
    trustworthy full-suite gate. Worth finding before it costs someone a day:
    start by giving each launch a `--disable-dev-shm-usage`-style constrained
    profile, or by having the fixture clean up its temp `userData` unconditionally
    (321 `harness-e2e-*` directories were left behind under `/var/folders`).
18. Derive the contract instead of duplicating it. FastAPI emits OpenAPI from the
    route definitions; publish that and generate the desktop's types from it. Replaces
    the byte-identical API-CONTRACT.md copies and their hash stamps — drift becomes
    impossible rather than merely detected, and a field rename becomes one PR.
