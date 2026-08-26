import { useState } from 'react'

import type { ServerTestResult } from '@shared/ipc'
import { validateServerUrl } from '@shared/serverUrl'
import type { Settings } from '@shared/types'

import { errorCopy } from '../../lib/errorCopy'
import { useSettingsStore } from '../../stores/useSettingsStore'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { ConnectionSection } from './ConnectionSection'
import { GenerationSection } from './GenerationSection'

interface SettingsModalProps {
  /**
   * Always provided: Save closes the modal, and Save is what makes the app
   * configured in the first place. Gating this on "is configured" made Save a
   * no-op on first run, because the flag is still false at the moment it runs.
   */
  onClose: () => void
  /**
   * Whether the modal can be *dismissed* without saving. False on first run,
   * where there is nothing behind it to go back to (SPEC §8.5).
   */
  dismissable: boolean
  firstRun: boolean
}

/**
 * Mounted only while open, so the form seeds itself from `settings` on mount.
 *
 * The alternative — an `open` prop plus an effect that re-seeds the draft — is
 * the cascading-render pattern `react-hooks/set-state-in-effect` exists to catch,
 * and it has a real bug in it: the effect also refires whenever `settings`
 * changes, wiping whatever the user was mid-way through typing.
 */
export function SettingsModal({ onClose, dismissable, firstRun }: SettingsModalProps) {
  const { settings, save, setApiKey, saving } = useSettingsStore()

  const [draft, setDraft] = useState<Settings>(settings)
  const [apiKeyDraft, setApiKeyDraft] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ServerTestResult | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Derived from the machine's state, not from what the last save returned: a
  // warning stored in local state is discarded the moment Save closes the modal,
  // so nobody ever reads it.
  const keyWarning =
    settings.hasApiKey && !settings.credentialStoreAvailable
      ? 'This system has no secure credential store, so the key is kept in memory only. ' +
        'It will work until you quit, then you will need to enter it again.'
      : null

  const urlValidation = validateServerUrl(draft.serverUrl)
  const canSave = urlValidation.valid && !saving

  /**
   * Test what is in the form, not what was last saved — otherwise the button
   * tests the old URL and reports success for a server you are about to stop
   * pointing at. So the draft is persisted first.
   */
  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      if (urlValidation.valid) await save({ serverUrl: draft.serverUrl.trim() })
      if (apiKeyDraft !== null && apiKeyDraft !== '') {
        const result = await setApiKey(apiKeyDraft)
        if (!result.ok) {
          setTestResult({ ok: false, error: result.message ?? 'The key could not be saved.' })
          return
        }
        setApiKeyDraft(null)
      }
      const result = await window.api.server.test()
      setTestResult(result.ok ? result.value : { ok: false, error: errorCopy(result.error) })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaveError(null)
    if (apiKeyDraft !== null && apiKeyDraft !== '') {
      const keyResult = await setApiKey(apiKeyDraft)
      if (!keyResult.ok) {
        setSaveError(keyResult.message ?? 'The key could not be saved.')
        return
      }
      // A key that could not be persisted still works for this session, so the
      // user is let through rather than trapped in the modal. The warning above
      // renders from `credentialStoreAvailable` whenever Settings is open.
      setApiKeyDraft(null)
    }
    const saved = await save({
      serverUrl: draft.serverUrl.trim(),
      systemPrompt: draft.systemPrompt,
      temperature: draft.temperature,
      topP: draft.topP,
      maxTokens: draft.maxTokens,
      streamingEnabled: draft.streamingEnabled,
      theme: draft.theme,
    })
    if (!saved) {
      setSaveError('Those settings could not be saved.')
      return
    }
    onClose()
  }

  return (
    <Dialog
      open
      title="Settings"
      onClose={dismissable ? onClose : undefined}
      footer={
        <>
          {saveError ? (
            <span className="mr-auto text-sm text-[var(--color-danger)]">{saveError}</span>
          ) : null}
          {dismissable ? (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void handleSave()} disabled={!canSave}>
            Save
          </Button>
        </>
      }
    >
      {keyWarning ? (
        <p
          data-testid="key-warning"
          className="mb-4 rounded-md border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-text-muted)]"
        >
          {keyWarning}
        </p>
      ) : null}

      {firstRun ? (
        <p className="mb-4 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          Point this at your harness server to get started. Paste the URL and the API key it
          printed, then press <strong>Test connection</strong>.
        </p>
      ) : null}

      <div className="flex flex-col gap-6">
        <ConnectionSection
          serverUrl={draft.serverUrl}
          onServerUrlChange={(serverUrl) => setDraft((d) => ({ ...d, serverUrl }))}
          hasApiKey={settings.hasApiKey}
          apiKeyDraft={apiKeyDraft}
          onApiKeyDraftChange={setApiKeyDraft}
          urlError={draft.serverUrl.trim() === '' ? null : urlValidation.error}
          testing={testing}
          testResult={testResult}
          onTest={() => void runTest()}
        />

        <hr className="border-[var(--color-border-subtle)]" />

        <GenerationSection
          settings={draft}
          onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        />
      </div>
    </Dialog>
  )
}
