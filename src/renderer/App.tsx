import { useCallback, useEffect, useState } from 'react'

import type { ServerState } from '@shared/types'

import { ChatPane } from './components/chat/ChatPane'
import { AppShell } from './components/layout/AppShell'
import { Sidebar } from './components/layout/Sidebar'
import { TitleBar } from './components/layout/TitleBar'
import { ServerLogsModal } from './components/logs/ServerLogsModal'
import { GpuIndicator } from './components/models/GpuIndicator'
import { LoadingBanner } from './components/models/LoadingBanner'
import { ModelDropdown } from './components/models/ModelDropdown'
import { SwitchModelDialog } from './components/models/SwitchModelDialog'
import { SettingsModal } from './components/settings/SettingsModal'
import { useIpcEvent } from './hooks/useIpcEvent'
import { useAbort, useChatEvents, useSendMessage } from './hooks/useStreamingMessage'
import { useChatStore } from './stores/useChatStore'
import { useConversationStore } from './stores/useConversationStore'
import { useServerStore } from './stores/useServerStore'
import { findModel, useModelStore } from './stores/useModelStore'
import { useSettingsStore } from './stores/useSettingsStore'

export function App() {
  const { loaded, load } = useSettingsStore()

  useEffect(() => {
    void load()
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!loaded) return <div className="h-full bg-[var(--color-surface)]" />

  // Remounted only when settings finish loading, so `Workspace` can seed its
  // own state from a `firstRun` value that is actually known.
  return <Workspace />
}

/**
 * The app proper, mounted once settings are loaded.
 *
 * Split out so that "is Settings open?" can be seeded from `firstRun` in a
 * `useState` initialiser. Deriving it as `settingsRequested || firstRun` looked
 * tidier and was wrong: on first run, saving the server URL flips `firstRun`
 * false, which unmounted the modal *while the user was still in it* — Test
 * connection could never show its result. Once the modal is open, only the user
 * closes it.
 */
function Workspace() {
  const { settings } = useSettingsStore()
  const configured = settings.serverUrl.trim() !== ''
  const [settingsOpen, setSettingsOpen] = useState(!configured)
  // Whether this session began unconfigured — for the explainer copy, which
  // should not disappear the moment a URL is typed.
  const [firstRun] = useState(!configured)

  const { server, setServer, initialise } = useServerStore()
  const models = useModelStore()
  const conversations = useConversationStore()
  const [logsOpen, setLogsOpen] = useState(false)
  const { streams, activeRequestId } = useChatStore()

  const send = useSendMessage()
  const abort = useAbort()
  useChatEvents()

  // The renderer never polls; it listens (SPEC §9).
  useIpcEvent<ServerState>(window.api.models.onStateChanged, setServer)

  useEffect(() => {
    void initialise()
    void models.load()
    void conversations.loadList()
    // Once, on mount. The stores are module singletons, so re-running this on
    // every render would refetch the world.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stream = activeRequestId ? (streams[activeRequestId] ?? null) : null
  const activeModel = findModel(models.models, server.activeModelId)
  const modelLabel = activeModel?.displayName ?? server.activeModelId ?? 'No model'

  /** Catalog id -> display name, for message labels and transcript dividers. */
  const displayName = useCallback(
    (modelId: string) => findModel(models.models, modelId)?.displayName ?? modelId,
    [models.models],
  )

  // The catalog is fetched once at startup, but a switch changes which entry is
  // active and whether one is newly available — so re-read it when the server
  // settles. Cheap, and it keeps the dropdown honest.
  useEffect(() => {
    if (server.state === 'ready' || server.state === 'error') {
      void models.load()
      models.finishSwitch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.state])

  const onSend = useCallback(
    async (content: string) => {
      // Sending with nothing open should create somewhere to put it, rather
      // than doing nothing and looking broken.
      if (!conversations.active) {
        const created = await conversations.create(server.activeModelId ?? '')
        if (!created) return
      }
      await send(content)
    },
    [conversations, send, server.activeModelId],
  )

  const onStop = useCallback(() => {
    if (activeRequestId) void abort(activeRequestId)
  }, [abort, activeRequestId])

  return (
    <>
      <AppShell
        titleBar={
          <TitleBar
            onOpenSettings={() => setSettingsOpen(true)}
            serverLabel={configured ? settings.serverUrl : 'not configured'}
            connected={server.state === 'ready'}
          >
            <ModelDropdown
              models={models.models}
              server={server}
              onSelect={(model) => models.propose(model)}
              disabled={server.state === 'loading' || server.state === 'stopping'}
            />
            {/* Nothing at all on the Ollama path, where `gpu` is always []. */}
            <GpuIndicator gpus={server.gpu} />
          </TitleBar>
        }
      >
        <div className="flex h-full">
          <Sidebar
            summaries={conversations.summaries}
            activeId={conversations.active?.id ?? conversations.damagedActiveId}
            damagedIds={conversations.damaged}
            onNew={() => void conversations.create(server.activeModelId ?? '')}
            onSelect={(id) => void conversations.open(id)}
            onRename={(id, title) => void conversations.rename(id, title)}
            onDelete={(id) => void conversations.remove(id)}
          />
          <div className="flex-1 overflow-hidden">
            <ChatPane
              conversation={conversations.active}
              damagedId={conversations.damagedActiveId}
              onForget={() => {
                if (conversations.damagedActiveId)
                  void conversations.forget(conversations.damagedActiveId)
              }}
              stream={stream}
              server={server}
              modelLabel={modelLabel}
              displayName={displayName}
              banner={
                <LoadingBanner
                  server={server}
                  startedAt={models.switchStartedAt}
                  onViewLogs={() => setLogsOpen(true)}
                />
              }
              onSend={(content) => void onSend(content)}
              onStop={onStop}
            />
          </div>
        </div>
      </AppShell>

      {models.pending ? (
        <SwitchModelDialog
          target={models.pending}
          current={activeModel}
          streaming={stream?.status === 'streaming'}
          onCancel={() => models.propose(null)}
          onConfirm={() => void models.confirm()}
        />
      ) : null}

      {logsOpen ? <ServerLogsModal onClose={() => setLogsOpen(false)} /> : null}

      {settingsOpen ? (
        <SettingsModal
          firstRun={firstRun}
          // Dismissable only once a server URL exists — first run has nothing
          // behind it (SPEC §8.5). Save always closes, whatever the state.
          dismissable={configured}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  )
}
