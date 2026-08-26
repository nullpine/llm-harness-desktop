import { MAX_TOKENS_RANGE, TEMPERATURE_RANGE, TOP_P_RANGE } from '@shared/constants'
import type { Settings, Theme } from '@shared/types'

const THEMES: Theme[] = ['system', 'light', 'dark']

interface GenerationSectionProps {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}

export function GenerationSection({ settings, onChange }: GenerationSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">System prompt</span>
        <textarea
          rows={3}
          value={settings.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          className="resize-y rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <Slider
        label="Temperature"
        value={settings.temperature}
        range={TEMPERATURE_RANGE}
        onChange={(temperature) => onChange({ temperature })}
      />
      <Slider
        label="Top P"
        value={settings.topP}
        range={TOP_P_RANGE}
        onChange={(topP) => onChange({ topP })}
      />

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">Max tokens</span>
        <input
          type="number"
          min={MAX_TOKENS_RANGE.min}
          max={MAX_TOKENS_RANGE.max}
          value={settings.maxTokens}
          onChange={(e) => onChange({ maxTokens: Number(e.target.value) })}
          className="w-40 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-3 py-2 outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.streamingEnabled}
          onChange={(e) => onChange({ streamingEnabled: e.target.checked })}
        />
        <span className="text-sm">Stream responses</span>
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">Theme</span>
        <div className="flex gap-1 rounded-md bg-[var(--color-surface-overlay)] p-1">
          {THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => onChange({ theme })}
              className={`flex-1 rounded px-3 py-1 text-sm capitalize transition ${
                settings.theme === theme
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {theme}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

interface SliderProps {
  label: string
  value: number
  range: { readonly min: number; readonly max: number; readonly step: number }
  onChange: (value: number) => void
}

function Slider({ label, value, range, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-xs font-medium text-[var(--color-text-muted)]">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[var(--color-accent)]"
      />
    </label>
  )
}
