import { useCallback, useEffect, useState } from 'react'

import type { ServerState } from '@shared/types'

import { ChatPane } from './components/chat/ChatPane'
import { AppShell } from './components/layout/AppShell'
import { Sidebar } from './components/layout/Sidebar'
import { TitleBar } from './components/layout/TitleBar'
import { ModelStatusPill } from './components/models/ModelStatusPill'
import { SettingsModal } from './components/settings/SettingsModal'
import { useIpcEvent } from './hooks/useIpcEvent'
import { useAbort, useChatEvents, useSendMessage } from './hooks/useStreamingMessage'
import { useChatStore } from './stores/useChatStore'
import { useConversationStore } from './stores/useConversationStore'
import { useServerStore } from './stores/useServerStore'
import { useSettingsStore } from './stores/useSettingsStore'

export function App() {
  const { settings, loaded, load } = useSettingsStore()
  const [settingsRequested, setSettingsRequested] = useState(false)

  const { server, setServer, initialise } = useServerStore()
  const conversations = useConversationStore()
  const { streams, activeRequestId } = useChatStore()

  const send = useSendMessage()
  const abort = useAbort()
  useChatEvents()

  // The renderer never polls; it listens (SPEC §9).
  useIpcEvent<ServerState>(window.api.models.onStateChanged, setServer)

  useEffect(() => {
    void load()
    void initialise()
    void conversations.loadList()
    // Once, on mount. The stores are module singletons, so re-running this on
    // every render would refetch the world.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const configured = settings.serverUrl.trim() !== ''
  const firstRun = loaded && !configured
  const settingsOpen = settingsRequested || firstRun

  const stream = activeRequestId ? (streams[activeRequestId] ?? null) : null
  const modelLabel = server.activeModelId ?? 'No model'

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

  if (!loaded) return <div className="h-full bg-[var(--color-surface)]" />

  return (
    <>
      <AppShell
        titleBar={
          <TitleBar
            onOpenSettings={() => setSettingsRequested(true)}
            serverLabel={configured ? settings.serverUrl : 'not configured'}
            connected={server.state === 'ready'}
          >
            <span className="flex items-center gap-2 text-sm">
              <span className="font-medium">{modelLabel}</span>
              <ModelStatusPill server={server} />
            </span>
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
              onSend={(content) => void onSend(content)}
              onStop={onStop}
            />
          </div>
        </div>
      </AppShell>

      {settingsOpen ? (
        <SettingsModal
          firstRun={firstRun}
          onClose={firstRun ? undefined : () => setSettingsRequested(false)}
        />
      ) : null}
    </>
  )
}
