import { useState } from 'react'

import type { ServerTestResult } from '@shared/ipc'

import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

export interface ConnectionSectionProps {
  serverUrl: string
  onServerUrlChange: (value: string) => void
  hasApiKey: boolean
  apiKeyDraft: string | null
  onApiKeyDraftChange: (value: string | null) => void
  urlError: string | null
  testing: boolean
  testResult: ServerTestResult | null
  onTest: () => void
}

export function ConnectionSection(props: ConnectionSectionProps) {
  const [replacing, setReplacing] = useState(false)
  const showKeyInput = !props.hasApiKey || replacing || props.apiKeyDraft !== null

  return (
    <section className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">Server URL</span>
        <input
          type="url"
          aria-label="Server URL"
          data-testid="server-url"
          value={props.serverUrl}
          placeholder="https://harness.example.com"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => props.onServerUrlChange(e.target.value)}
          className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
        />
        {props.urlError ? (
          <span className="text-xs text-[var(--color-danger)]">{props.urlError}</span>
        ) : null}
      </label>

      {/*
        A <label> only when there is an input to label. `<button>` is a labelable
        element, so wrapping the ••• / Replace pair in one made the *button's*
        accessible name "API key" — mislabelling it for screen readers, and for
        anything else that asks the accessibility tree what that control is.
      */}
      {showKeyInput ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">API key</span>
          <input
            type="password"
            aria-label="API key"
            data-testid="api-key"
            value={props.apiKeyDraft ?? ''}
            placeholder="paste the key from the server"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => props.onApiKeyDraftChange(e.target.value)}
            className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
          />
        </label>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">API key</span>
          <div className="flex items-center gap-3">
            {/* The key is never readable from here — main will not hand it back. */}
            <span className="font-mono text-[var(--color-text-muted)]">••••••••••••</span>
            <Button
              variant="ghost"
              onClick={() => {
                setReplacing(true)
                props.onApiKeyDraftChange('')
              }}
            >
              Replace
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={props.onTest} disabled={props.testing}>
          Test connection
        </Button>
        {props.testing ? <Spinner label="Contacting the server…" /> : null}
        {!props.testing && props.testResult ? <TestOutcome result={props.testResult} /> : null}
      </div>
    </section>
  )
}

function TestOutcome({ result }: { result: ServerTestResult }) {
  if (!result.ok) {
    return (
      <span data-testid="test-outcome" className="text-sm text-[var(--color-danger)]">
        ✕ {result.error}
      </span>
    )
  }
  return (
    <span data-testid="test-outcome" className="text-sm text-[var(--color-success)]">
      ✓ Connected · contract v{result.version} · {result.latencyMs} ms
    </span>
  )
}
