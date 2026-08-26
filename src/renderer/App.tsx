import { useEffect, useState } from 'react'

import { SettingsModal } from './components/settings/SettingsModal'
import { AppShell, EmptyMainPane } from './components/layout/AppShell'
import { TitleBar } from './components/layout/TitleBar'
import { useSettingsStore } from './stores/useSettingsStore'

export function App() {
  const { settings, loaded, load } = useSettingsStore()
  const [settingsRequested, setSettingsRequested] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const configured = settings.serverUrl.trim() !== ''
  const firstRun = loaded && !configured

  // SPEC §8.5: with no server configured there is nothing to show but Settings.
  // Derived, not set from an effect — "unconfigured" *is* "Settings is open",
  // and keeping them as one value means they cannot disagree for a frame.
  const settingsOpen = settingsRequested || firstRun

  if (!loaded) return <div className="h-full bg-[var(--color-surface)]" />

  return (
    <>
      <AppShell
        titleBar={
          <TitleBar
            onOpenSettings={() => setSettingsRequested(true)}
            serverLabel={configured ? settings.serverUrl : 'not configured'}
            connected={configured && settings.hasApiKey}
          />
        }
      >
        <EmptyMainPane
          hint={
            configured
              ? 'Connected. There is nothing to say to it yet.'
              : 'Add your server URL and API key to get started.'
          }
        />
      </AppShell>

      {settingsOpen ? (
        <SettingsModal
          firstRun={firstRun}
          // First run has nothing behind it, so the modal cannot be dismissed.
          onClose={firstRun ? undefined : () => setSettingsRequested(false)}
        />
      ) : null}
    </>
  )
}
