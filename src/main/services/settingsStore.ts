/**
 * `settings.json` in `userData` (SPEC §7).
 *
 * Two things it must never do: carry the API key (that is `secretStore.ts`), and
 * fail to start because the file on disk is damaged. A corrupt or partially
 * migrated settings file falls back to defaults with a warning — an app that
 * refuses to open because of its own preferences file is unfixable by the user.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '@shared/constants'
import type { Settings, Theme } from '@shared/types'

import { atomicWrite } from '../lib/atomicWrite'

// Both omitted fields are *derived* — one from the secret store, one from the
// machine — so neither belongs on disk.
interface StoredSettings extends Omit<Settings, 'hasApiKey' | 'credentialStoreAvailable'> {
  /** Present so a future shape change has something to branch on. */
  version: number
}

export interface SettingsStoreOptions {
  directory: string
  onWarn?: (message: string, meta?: unknown) => void
}

const THEMES: Theme[] = ['system', 'light', 'dark']

export class SettingsStore {
  private readonly file: string
  private readonly warn: (message: string, meta?: unknown) => void
  private cache: StoredSettings | null = null

  constructor(options: SettingsStoreOptions) {
    this.file = join(options.directory, 'settings.json')
    this.warn = options.onWarn ?? (() => {})
  }

  /**
   * Read settings, with `hasApiKey` filled in by the caller.
   *
   * The key itself is not a parameter and cannot be: this returns the object that
   * crosses IPC, and `Settings` has no field for it (CLAUDE.md rule 3).
   */
  async get(hasApiKey: boolean, credentialStoreAvailable = true): Promise<Settings> {
    const stored = await this.load()
    const { version: _version, ...rest } = stored
    return { ...rest, hasApiKey, credentialStoreAvailable }
  }

  /** Merge a patch and persist. Unknown and unsettable keys are dropped. */
  async set(
    patch: Partial<Settings>,
    hasApiKey: boolean,
    credentialStoreAvailable = true,
  ): Promise<Settings> {
    const current = await this.load()
    const next = sanitise({ ...current, ...patch })
    this.cache = next
    await atomicWrite(this.file, `${JSON.stringify(next, null, 2)}\n`)
    const { version: _version, ...rest } = next
    return { ...rest, hasApiKey, credentialStoreAvailable }
  }

  private async load(): Promise<StoredSettings> {
    if (this.cache) return this.cache

    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch {
      this.cache = sanitise(DEFAULT_SETTINGS)
      return this.cache
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (cause) {
      // Defaults beat a dead app. The file is replaced on the next write.
      this.warn('settings.json is not valid JSON; falling back to defaults', cause)
      this.cache = sanitise(DEFAULT_SETTINGS)
      return this.cache
    }

    this.cache = sanitise(parsed)
    return this.cache
  }
}

/**
 * Coerce anything into a valid `StoredSettings`.
 *
 * Every field is validated individually rather than trusting the file wholesale:
 * a hand-edited `temperature: "hot"` should cost one default, not the whole file.
 */
function sanitise(input: unknown): StoredSettings {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const apiKeyLike = Object.keys(raw).find((k) => /api_?key/i.test(k))
  if (apiKeyLike) {
    // Should be impossible, but if an old build or a hand edit put a key here it
    // must not survive a round trip back to disk.
    delete raw[apiKeyLike]
  }

  return {
    version: SETTINGS_SCHEMA_VERSION,
    serverUrl: typeof raw.serverUrl === 'string' ? raw.serverUrl : DEFAULT_SETTINGS.serverUrl,
    systemPrompt:
      typeof raw.systemPrompt === 'string' ? raw.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
    temperature: clampNumber(raw.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    topP: clampNumber(raw.topP, 0, 1, DEFAULT_SETTINGS.topP),
    maxTokens: Math.round(clampNumber(raw.maxTokens, 1, 131_072, DEFAULT_SETTINGS.maxTokens)),
    streamingEnabled:
      typeof raw.streamingEnabled === 'boolean'
        ? raw.streamingEnabled
        : DEFAULT_SETTINGS.streamingEnabled,
    theme: THEMES.includes(raw.theme as Theme) ? (raw.theme as Theme) : DEFAULT_SETTINGS.theme,
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
