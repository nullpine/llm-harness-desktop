# llm-harness-desktop — Repository Structure

```
llm-harness-desktop/
├── .claude/                          # ← how Claude Code picks this project up
│   ├── rules/                        # path-scoped; load when matching files are opened
│   │   ├── network-boundary.md       # renderer↛network, key stays in main
│   │   └── streaming-and-ipc.md      # SSE parsing, abort, Result<T,E> convention
│   ├── settings.json                 # committed: allowed/denied tool permissions
│   └── settings.local.json           # gitignored: personal overrides
│
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug.yml
│   │   └── task.yml
│   ├── pull_request_template.md
│   └── workflows/
│       ├── ci.yml                    # typecheck → lint → unit → build (ubuntu) → e2e (macos)
│       └── release.yml               # tag v* → electron-builder → GH release (manual trigger for MVP)
│
├── .vscode/
│   ├── extensions.json
│   └── launch.json                   # attach to main + renderer
│
├── build/                            # electron-builder assets (NOT build output)
│   ├── icon.icns
│   ├── icon.ico
│   ├── icon.png
│   └── entitlements.mac.plist
│
├── docs/
│   ├── SPEC.md                       # ← the MVP spec
│   ├── ARCHITECTURE.md               # process model, data flow, decisions
│   ├── API-CONTRACT.md               # ← identical copy of the shared contract
│   ├── BACKLOG.md                    # milestones + issue-sized tasks
│   └── adr/
│       ├── 0001-electron-vite.md
│       ├── 0002-main-process-owns-network.md
│       ├── 0003-json-file-persistence.md
│       └── 0004-single-active-model.md
│
├── resources/                        # runtime assets copied into the app
│   └── tray-icon@2x.png
│
├── src/
│   ├── main/                         # Node context — has fs, net, secrets
│   │   ├── index.ts                  # app lifecycle, window creation, security hardening
│   │   ├── window.ts                 # BrowserWindow factory, CSP, nav guards
│   │   ├── menu.ts                   # application menu + shortcuts
│   │   ├── ipc/
│   │   │   ├── index.ts              # registers every handler; single import point
│   │   │   ├── settings.handlers.ts
│   │   │   ├── models.handlers.ts
│   │   │   ├── chat.handlers.ts
│   │   │   ├── conversations.handlers.ts
│   │   │   └── logs.handlers.ts
│   │   ├── services/
│   │   │   ├── harnessClient.ts      # the ONLY place that talks HTTP to the server
│   │   │   ├── sseStream.ts          # SSE line parser + abort + idle timeout
│   │   │   ├── serverPoller.ts       # adaptive /admin/state polling loop
│   │   │   ├── settingsStore.ts      # settings.json read/write, defaults, migration
│   │   │   ├── secretStore.ts        # safeStorage wrapper for the API key
│   │   │   └── conversationStore.ts  # atomic JSON persistence behind an interface
│   │   ├── lib/
│   │   │   ├── logger.ts             # rotating file logger with key redaction
│   │   │   ├── atomicWrite.ts
│   │   │   ├── ulid.ts
│   │   │   └── result.ts             # Result<T,E> helper — no throwing across IPC
│   │   └── __tests__/
│   │       ├── sseStream.test.ts
│   │       ├── harnessClient.test.ts # against a mock server (msw / undici MockAgent)
│   │       ├── conversationStore.test.ts
│   │       └── redaction.test.ts
│   │
│   ├── preload/
│   │   ├── index.ts                  # contextBridge.exposeInMainWorld('api', …)
│   │   └── api.d.ts                  # ambient declaration of window.api
│   │
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── styles/
│   │   │   ├── globals.css           # tailwind directives + CSS vars for theming
│   │   │   └── highlight.css
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppShell.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── TitleBar.tsx
│   │   │   ├── chat/
│   │   │   │   ├── ChatPane.tsx
│   │   │   │   ├── MessageList.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── MarkdownContent.tsx   # throttled parse, code copy button
│   │   │   │   ├── ReasoningBlock.tsx
│   │   │   │   ├── Composer.tsx
│   │   │   │   ├── StreamingCursor.tsx
│   │   │   │   └── JumpToLatest.tsx
│   │   │   ├── models/
│   │   │   │   ├── ModelDropdown.tsx
│   │   │   │   ├── ModelStatusPill.tsx
│   │   │   │   ├── SwitchModelDialog.tsx
│   │   │   │   └── LoadingBanner.tsx
│   │   │   ├── conversations/
│   │   │   │   ├── ConversationList.tsx
│   │   │   │   └── ConversationItem.tsx
│   │   │   ├── settings/
│   │   │   │   ├── SettingsModal.tsx
│   │   │   │   ├── ConnectionSection.tsx
│   │   │   │   └── GenerationSection.tsx
│   │   │   ├── logs/
│   │   │   │   └── ServerLogsModal.tsx
│   │   │   └── ui/                   # dumb primitives
│   │   │       ├── Button.tsx
│   │   │       ├── Dialog.tsx
│   │   │       ├── Select.tsx
│   │   │       ├── Toast.tsx
│   │   │       └── Spinner.tsx
│   │   ├── stores/
│   │   │   ├── useSettingsStore.ts
│   │   │   ├── useServerStore.ts     # ServerState + model catalog, fed by IPC events
│   │   │   ├── useConversationStore.ts
│   │   │   └── useChatStore.ts       # in-flight stream buffers keyed by requestId
│   │   ├── hooks/
│   │   │   ├── useStreamingMessage.ts
│   │   │   ├── useAutoScroll.ts
│   │   │   └── useIpcEvent.ts
│   │   ├── lib/
│   │   │   ├── format.ts             # relative time, token counts, byte sizes
│   │   │   └── groupConversations.ts # Today / Yesterday / Earlier
│   │   └── __tests__/
│   │       ├── MessageBubble.test.tsx
│   │       └── groupConversations.test.ts
│   │
│   └── shared/                       # imported by ALL THREE targets — keep it pure
│       ├── types.ts                  # Message, Conversation, Settings, ModelInfo, ServerState
│       ├── ipc.ts                    # channel names + request/response type map
│       ├── errors.ts                 # error codes mirrored from the API contract
│       └── constants.ts              # defaults, timeouts, poll intervals
│
├── e2e/
│   ├── fixtures/
│   │   └── mockServer.ts             # tiny express app implementing the contract
│   ├── smoke.spec.ts                 # launch → settings → send → stream → restart
│   └── modelSwitch.spec.ts
│
├── scripts/
│   ├── check-contract-hash.mjs       # fails if docs/API-CONTRACT.md drifts from the server repo
│   └── dev-mock-server.mjs           # run the mock server standalone for UI work
│
├── .editorconfig
├── .env.example                      # HARNESS_DEV_SERVER_URL for local dev only
├── .eslintrc.cjs
├── .gitignore
├── .nvmrc
├── .prettierrc
├── CHANGELOG.md
├── CLAUDE.md                         # ← instructions for Claude working in this repo
├── LICENSE
├── README.md
├── electron-builder.yml
├── electron.vite.config.ts
├── package.json
├── playwright.config.ts
├── tailwind.config.ts
├── tsconfig.json                     # references the three below
├── tsconfig.node.json                # main + preload
├── tsconfig.web.json                 # renderer
└── vitest.config.ts
```

## Key files, in the order they should be written

1. `src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/constants.ts` — the vocabulary
2. `src/main/services/harnessClient.ts` + `sseStream.ts` — the server boundary, fully unit-tested against a mock
3. `src/main/services/settingsStore.ts` + `secretStore.ts`
4. `src/main/ipc/*` + `src/preload/index.ts` — the bridge
5. `src/renderer` — UI on top of a bridge that already works
6. `e2e/` — last

## Conventions

- **No `any`.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` all on.
- **Nothing throws across IPC.** Handlers return `Result<T, AppError>`; the renderer
  branches on it. Uncaught exceptions in a handler are a bug.
- **One HTTP client.** If a file other than `harnessClient.ts` calls `fetch` against
  the server origin, that is a review failure.
- Components are presentational; all IPC lives in stores/hooks.
- File naming: `PascalCase.tsx` for components, `camelCase.ts` for everything else.
- Every exported function in `src/main/services` and `src/shared` has a unit test.
