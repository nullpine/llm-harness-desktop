/**
 * Settings and secrets on disk.
 *
 * The two properties that matter: a damaged file never stops the app starting,
 * and the API key is never in `settings.json` no matter how it got there.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '@shared/constants'
import { SecretStore, type SafeStorageLike } from '../services/secretStore'
import { SettingsStore } from '../services/settingsStore'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'harness-settings-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const settingsFile = () => join(directory, 'settings.json')

// --- SettingsStore ----------------------------------------------------------

describe('SettingsStore', () => {
  it('returns defaults when nothing is stored', async () => {
    const store = new SettingsStore({ directory })
    expect(await store.get(false)).toEqual({ ...DEFAULT_SETTINGS, hasApiKey: false })
  })

  it('persists a patch and reads it back from disk', async () => {
    const store = new SettingsStore({ directory })
    await store.set({ serverUrl: 'https://harness.example.com', temperature: 0.2 }, false)

    const reopened = new SettingsStore({ directory })
    const settings = await reopened.get(true)
    expect(settings.serverUrl).toBe('https://harness.example.com')
    expect(settings.temperature).toBe(0.2)
    expect(settings.hasApiKey).toBe(true)
  })

  it('writes the file atomically, leaving no temp files behind', async () => {
    const store = new SettingsStore({ directory })
    await store.set({ serverUrl: 'https://a.example.com' }, false)
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(directory).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('never writes an API key, even if one is passed in', async () => {
    const store = new SettingsStore({ directory })
    // `Settings` has no apiKey field, so this can only come from a bad caller.
    await store.set({ serverUrl: 'https://a.example.com', apiKey: 'leaked' } as never, false)
    expect(readFileSync(settingsFile(), 'utf8')).not.toContain('leaked')
  })

  it('strips an API key that somehow ended up in the file', async () => {
    writeFileSync(
      settingsFile(),
      JSON.stringify({ serverUrl: 'https://a.example.com', apiKey: 'leaked-from-an-old-build' }),
    )
    const store = new SettingsStore({ directory })
    const settings = await store.get(false)
    expect(JSON.stringify(settings)).not.toContain('leaked-from-an-old-build')

    await store.set({ temperature: 0.5 }, false)
    expect(readFileSync(settingsFile(), 'utf8')).not.toContain('leaked-from-an-old-build')
  })

  it('has no hasApiKey field on disk — it is derived, not stored', async () => {
    const store = new SettingsStore({ directory })
    await store.set({ serverUrl: 'https://a.example.com' }, true)
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8'))).not.toHaveProperty('hasApiKey')
  })

  it('records a schema version for future migrations', async () => {
    const store = new SettingsStore({ directory })
    await store.set({}, false)
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8')).version).toBe(1)
  })
})

describe('SettingsStore resilience', () => {
  it('falls back to defaults on corrupt JSON and warns', async () => {
    writeFileSync(settingsFile(), '{ not json at all')
    const onWarn = vi.fn()
    const store = new SettingsStore({ directory, onWarn })

    expect(await store.get(false)).toEqual({ ...DEFAULT_SETTINGS, hasApiKey: false })
    expect(onWarn).toHaveBeenCalledOnce()
  })

  it('replaces individual bad fields rather than the whole file', async () => {
    writeFileSync(
      settingsFile(),
      JSON.stringify({ serverUrl: 'https://keep.example.com', temperature: 'hot', theme: 'neon' }),
    )
    const settings = await new SettingsStore({ directory }).get(false)

    expect(settings.serverUrl).toBe('https://keep.example.com')
    expect(settings.temperature).toBe(DEFAULT_SETTINGS.temperature)
    expect(settings.theme).toBe('system')
  })

  it('clamps out-of-range numbers instead of rejecting them', async () => {
    writeFileSync(settingsFile(), JSON.stringify({ temperature: 99, topP: -3, maxTokens: 0.5 }))
    const settings = await new SettingsStore({ directory }).get(false)

    expect(settings.temperature).toBe(2)
    expect(settings.topP).toBe(0)
    expect(settings.maxTokens).toBe(1)
  })

  it('tolerates a file that is valid JSON but not an object', async () => {
    writeFileSync(settingsFile(), '"a string"')
    expect(await new SettingsStore({ directory }).get(false)).toEqual({
      ...DEFAULT_SETTINGS,
      hasApiKey: false,
    })
  })
})

// --- SecretStore ------------------------------------------------------------

/**
 * A stand-in for Electron's safeStorage.
 *
 * The transform is a XOR, not a prefix: it has to actually obscure the plaintext,
 * or the "never stores the key in plaintext" test below would be asserting a
 * property of this fake rather than of `SecretStore`.
 */
const MAGIC = Buffer.from('HKSS', 'utf8')
const MASK = 0x5a

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) =>
      Buffer.concat([MAGIC, Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ MASK))]),
    decryptString: (buf) => {
      if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not our ciphertext')
      const plain = Buffer.from(buf.subarray(MAGIC.length)).map((b) => b ^ MASK)
      return Buffer.from(plain).toString('utf8')
    },
  }
}

const KEY = 'hk_live_9f3a2b7c1d4e5f6a'

describe('SecretStore', () => {
  it('round-trips the key through safeStorage', async () => {
    const store = new SecretStore({ directory, safeStorage: fakeSafeStorage() })
    expect(await store.setApiKey(KEY)).toEqual({ ok: true })
    expect(await store.getApiKey()).toBe(KEY)
    expect(await store.hasApiKey()).toBe(true)
  })

  it('reads a key written by a previous run', async () => {
    await new SecretStore({ directory, safeStorage: fakeSafeStorage() }).setApiKey(KEY)
    const reopened = new SecretStore({ directory, safeStorage: fakeSafeStorage() })
    expect(await reopened.getApiKey()).toBe(KEY)
  })

  it('never stores the key in plaintext', async () => {
    const store = new SecretStore({ directory, safeStorage: fakeSafeStorage() })
    await store.setApiKey(KEY)
    // A8: grep the whole userData directory and find nothing.
    const { readdirSync } = await import('node:fs')
    for (const file of readdirSync(directory)) {
      expect(readFileSync(join(directory, file), 'utf8')).not.toContain(KEY)
    }
  })

  it('clears the key on an empty string', async () => {
    const store = new SecretStore({ directory, safeStorage: fakeSafeStorage() })
    await store.setApiKey(KEY)
    await store.setApiKey('   ')
    expect(await store.getApiKey()).toBeNull()
    expect(existsSync(join(directory, 'secrets.bin'))).toBe(false)
  })

  it('reports no key when nothing has been stored', async () => {
    const store = new SecretStore({ directory, safeStorage: fakeSafeStorage() })
    expect(await store.getApiKey()).toBeNull()
    expect(await store.hasApiKey()).toBe(false)
  })
})

describe('SecretStore without encryption', () => {
  it('refuses to persist rather than writing plaintext', async () => {
    // Some Linux desktops have no keyring. Degrading to plaintext would defeat A8.
    const onWarn = vi.fn()
    const store = new SecretStore({ directory, safeStorage: fakeSafeStorage(false), onWarn })

    const result = await store.setApiKey(KEY)
    expect(result).toMatchObject({ ok: false, reason: 'encryption_unavailable' })
    expect(existsSync(join(directory, 'secrets.bin'))).toBe(false)
    expect(onWarn).toHaveBeenCalled()
  })

  it('still works for the current session', async () => {
    const store = new SecretStore({ directory, safeStorage: fakeSafeStorage(false) })
    await store.setApiKey(KEY)
    expect(await store.getApiKey()).toBe(KEY)
  })

  it('explains the consequence in the message it returns', async () => {
    const store = new SecretStore({ directory, safeStorage: fakeSafeStorage(false) })
    const result = await store.setApiKey(KEY)
    if (result.ok) throw new Error('expected a refusal')
    expect(result.message).toMatch(/quit/i)
  })

  it('treats an undecryptable file as no key rather than crashing', async () => {
    // What a secrets.bin copied from another machine looks like.
    const onWarn = vi.fn()
    await new SecretStore({ directory, safeStorage: fakeSafeStorage() }).setApiKey(KEY)
    writeFileSync(join(directory, 'secrets.bin'), 'garbage from another keychain')

    const store = new SecretStore({ directory, safeStorage: fakeSafeStorage(), onWarn })
    expect(await store.getApiKey()).toBeNull()
    expect(onWarn).toHaveBeenCalled()
  })

  it('survives safeStorage throwing outright', async () => {
    const throwing: SafeStorageLike = {
      isEncryptionAvailable: () => {
        throw new Error('dbus is not running')
      },
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    }
    const store = new SecretStore({ directory, safeStorage: throwing })
    expect(store.encryptionAvailable).toBe(false)
    expect((await store.setApiKey(KEY)).ok).toBe(false)
  })
})
