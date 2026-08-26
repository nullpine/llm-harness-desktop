/**
 * Storing an API key when there is nowhere secure to put it.
 *
 * Some Linux desktops have no keyring, so `safeStorage.isEncryptionAvailable()`
 * is false. `SecretStore` deliberately refuses to write plaintext and keeps the
 * key in memory for the session instead — the app works until quit.
 *
 * The handler used to report that as a hard failure, which left the user unable
 * to close Settings at all: trapped in a modal on a machine where the app would
 * otherwise have worked fine. Every e2e spec that configured the app failed this
 * way on a headless CI runner, which is how it was found.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IPC, type Result, type SetApiKeyResult } from '@shared/ipc'
// A type-only import is erased, so it does not race the electron mock below.
import type { SafeStorageLike } from '../services/secretStore'

type Handler = (event: unknown, request: unknown) => Promise<Result<unknown>>
const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  },
}))

const { registerSettingsHandlers } = await import('../ipc/settings.handlers')
const { SecretStore } = await import('../services/secretStore')
const { SettingsStore } = await import('../services/settingsStore')
const { Logger } = await import('../lib/logger')

const KEY = 'hk_live_no_keyring_here_0123456789'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'harness-setkey-'))
  handlers.clear()
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const workingStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`ENC${plain}`, 'utf8'),
  decryptString: (buf) => buf.toString('utf8').slice(3),
}

const noKeyring: SafeStorageLike = {
  ...workingStorage,
  isEncryptionAvailable: () => false,
}

function register(safeStorage: SafeStorageLike) {
  const logger = new Logger({ directory: join(directory, 'logs'), level: 'error' })
  registerSettingsHandlers({
    settings: new SettingsStore({ directory }),
    secrets: new SecretStore({ directory, safeStorage }),
    logger,
  })
}

async function setApiKey(key: string): Promise<Result<SetApiKeyResult>> {
  const handler = handlers.get(IPC.settingsSetApiKey)
  if (!handler) throw new Error('settings:setApiKey was not registered')
  return (await handler({}, { key })) as Result<SetApiKeyResult>
}

describe('with a working credential store', () => {
  it('reports the key as persisted', async () => {
    register(workingStorage)
    const result = await setApiKey(KEY)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({ ok: true, persisted: true })
  })
})

describe('with no credential store', () => {
  it('succeeds with a warning rather than failing', async () => {
    // The whole point: usable now, gone after quit. Not an error.
    register(noKeyring)
    const result = await setApiKey(KEY)

    expect(result.ok, 'a missing keyring was reported as a failure').toBe(true)
    if (!result.ok) return
    expect(result.value.persisted).toBe(false)
    expect(result.value.warning).toMatch(/quit/i)
  })

  it('leaves the key usable for this session', async () => {
    register(noKeyring)
    await setApiKey(KEY)

    const getHandler = handlers.get(IPC.settingsGet)
    const settings = (await getHandler?.({}, undefined)) as Result<{ hasApiKey: boolean }>
    expect(settings.ok && settings.value.hasApiKey).toBe(true)
  })

  it('still writes nothing to disk', async () => {
    // The warning must not become an excuse to persist it anyway.
    register(noKeyring)
    await setApiKey(KEY)

    const { readdirSync, readFileSync } = await import('node:fs')
    for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const contents = readFileSync(join(entry.parentPath, entry.name))
      expect(contents.includes(Buffer.from(KEY, 'utf8'))).toBe(false)
    }
  })
})

describe('when the disk refuses the write', () => {
  it('is still a hard failure', async () => {
    // Nothing works in this case, so blocking the user is correct.
    const throwing: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error('disk on fire')
      },
      decryptString: () => '',
    }
    register(throwing)

    const result = await setApiKey(KEY)
    expect(result.ok).toBe(false)
  })
})
