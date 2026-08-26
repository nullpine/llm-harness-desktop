# LLM Harness — MVP Roadmap

Desktop milestones only. The server side of each milestone lives in
[llm-harness-server/docs/BACKLOG.md](https://github.com/nullpine/llm-harness-server/blob/main/docs/BACKLOG.md).
Milestone numbering is shared; contents are per-repo.

---

## M0 — Foundations (½ day, both repos)

Nothing runs yet; everything is in place to start.

- [ ] Create both GitHub repos, private, with the directory trees from
      `docs/PROJECT-STRUCTURE.md` (empty files with a one-line docstring are fine)
- [ ] Commit `SPEC.md`, `API-CONTRACT.md`, `PROJECT-STRUCTURE.md`, `CLAUDE.md`,
      `README.md` to each
- [ ] Toolchain: `package.json` / `pyproject.toml`, lint, format, typecheck, test
      runner — all wired and passing on an empty codebase
- [ ] CI green on both repos
- [ ] GitHub milestones M1–M5 created; the issues below filed against them

**Exit:** `npm run typecheck && npm run lint && npm run test` and
`make lint && make test` both pass on a repo with no features.

---

## M1 — Serve one model / stand up the shell (2–3 days)

### desktop
- [ ] `src/shared/types.ts`, `ipc.ts`, `constants.ts`
- [ ] `scripts/dev-mock-server.mjs` implementing the full contract, incl. fake loads
- [ ] `harnessClient.ts` + `sseStream.ts`, unit-tested against the mock
- [ ] `settingsStore.ts` + `secretStore.ts`
- [ ] Window with security hardening, preload bridge, empty React shell
- [ ] Settings modal with Test connection working end to end
- [ ] Mock server serves both /healthz versions (`version` = contract, `service_version` = build) and the renamed /admin/models fields (`model_ref`, `available`)
- [ ] `sseStream.ts` tolerates `delta.reasoning` (Ollama) as well as `delta.reasoning_content` (vLLM) — Ollama is the local MVP path, so this is the one that actually fires
- [ ] Nothing keys off a chunk's `model` field; responses correlate by requestId only
- [x] e2e harness: `playwright.config.ts` and `e2e/` now drive the built app via `_electron`, covering A1, A2, A3, A7, A8, A9, A10 and A12. Runs in CI after `build`.

**Exit (desktop):** A1, A8, A9 from `SPEC.md` §10.

---

## M2 — Chat, and switch models (3–4 days)

### desktop
- [ ] `conversationStore.ts` with atomic writes and corrupt-file tolerance
- [ ] Chat pane: message list, bubbles, markdown, code copy, streaming cursor
- [ ] Composer: Enter/Shift+Enter, autogrow, Stop button with real abort
- [ ] `serverPoller.ts` adaptive polling → `models:stateChanged`
- [ ] Conversation sidebar: create, list, rename, delete, date grouping
- [ ] Reasoning block (collapsed `Thinking`)

**Exit (desktop):** A2, A3, A7, A10, A12.

---

## M3 — The dropdown (1–2 days, desktop)

- [ ] `ModelDropdown` + `ModelStatusPill` fed by the catalog
- [ ] `SwitchModelDialog` with the honest load-time warning
- [ ] `LoadingBanner` with elapsed time and `progressHint`; composer disabled
- [ ] Failure path: red banner, `lastError`, **View server logs** modal
- [ ] `— switched to X —` divider in the transcript; per-message `modelId` label
- [ ] `unreachable` state handling and automatic recovery

**Exit:** A4, A5, A6.

---

## M4 — Harden (2 days)

- [ ] Idle-chunk timeout, retry on a failed message, error envelope → friendly copy

**Acceptance coverage.** A1, A2, A3, A7, A8, A9, A10 and A12 are covered by the e2e
harness and re-checked on every CI run. Manual verification from here is only for
criteria the harness cannot reach: **A4, A5, A6** (the dropdown, which needs a real
second model loaded on real hardware) and **A11** (the dmg launching on a clean
machine).

**Exit (desktop):** the items above. The B-list exit criteria are server-side.

---

## M5 — Ship (1 day)

- [ ] `electron-builder` dmg that launches on a clean macOS machine
- [ ] End-to-end run of every acceptance criterion, A1–A12 and B1–B14, recorded
- [ ] READMEs finished: setup from zero, cost warning, teardown
- [ ] ADRs written for the decisions actually made
- [ ] Tag `v0.1.0` in both repos
- [ ] Post-MVP backlog groomed from everything deferred along the way

**Exit:** you can hand someone the dmg and the provision script and they get a
working private LLM.

---

## Deferred — the post-MVP list

Kept here so it stays out of the MVP. Roughly in the order it will matter.

1. Token counting and context-aware history trimming
2. SQLite persistence behind the existing repository interface
3. Conversation search and export
4. Two models resident on a multi-GPU VM; per-conversation model pinning
5. vLLM sleep mode for sub-10-second switching (ADR-0002 revisit)
6. Tool calling / MCP
7. Vision input (Qwen 3.8 27B already supports it)
8. Prometheus + Grafana; vLLM metrics scraping
9. Entra ID auth, multi-user
10. Bicep/Terraform for the VM; a systemd template unit per model
11. Auto-update for the desktop app; code signing and notarization
12. Scale-to-zero: deallocate the VM on idle, start it from the app
13. A hosted OpenAI-compatible provider as a second catalog entry — the desktop app
    already speaks the contract, so pointing it at a hosted endpoint is a config
    change. Useful as the everyday default with the VM reserved for private work.
14. Real cross-repo contract check. Today each repo verifies its own
    API-CONTRACT.md against its own stamp, which catches a local edit that skipped
    re-stamping but not divergence between the repos. A CI step fetching the other
    repo's `.api-contract.sha256` and comparing would close it.
15. Derive the contract instead of duplicating it. FastAPI emits OpenAPI from the
    route definitions; publish that and generate the desktop's types from it. Replaces
    the byte-identical API-CONTRACT.md copies and their hash stamps — drift becomes
    impossible rather than merely detected, and a field rename becomes one PR.
