/**
 * Acceptance A8, automated: "The API key is not present in plaintext anywhere
 * under `userData` (grep the directory)."
 *
 * This is a filesystem assertion, not an end-to-end concern — it needs a real
 * directory and a real walk of it, but not a running app — so it belongs in the
 * unit suite where it runs on every commit rather than in an e2e run nobody
 * triggers locally.
 *
 * What it does: drive the *real* stores against a temp `userData`, exercise the
 * paths that could plausibly leak (a settings write, a key change, log lines that
 * deliberately contain the key), then walk every byte of every file.
 *
 * What it does **not** cover: Electron's real `safeStorage`. Vitest runs in plain
 * Node, so the ciphertext here comes from a stand-in. That makes this a test of
 * *our* code — that nothing we write puts the key on disk in the clear, and that
 * we only ever persist what `safeStorage` handed back. Whether the real keychain
 * encrypts properly is Electron's problem, and confirming it on a real machine is
 * still a manual step.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Logger } from '../lib/logger'
import { SecretStore, type SafeStorageLike } from '../services/secretStore'
import { SettingsStore } from '../services/settingsStore'

/** Distinctive enough that a match cannot be a coincidence. */
const KEY = 'hk_live_A8_c4f9e1b7d2a850396fbe1c7d4a9e0b25'
const OLD_KEY = 'hk_live_A8_old_e7b1c93f04a6d258bc1e7f30a95d642c'

let userData: string

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'harness-a8-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

/**
 * A stand-in for Electron's `safeStorage`.
 *
 * The transform has to actually obscure its input — a reversible prefix would
 * leave the plaintext on disk and make the assertion below fail for the wrong
 * reason, or worse, pass for one.
 */
const MAGIC = Buffer.from('HKSS', 'utf8')
const MASK = 0x5a

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) =>
    Buffer.concat([MAGIC, Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ MASK))]),
  decryptString: (buf) => {
    if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not our ciphertext')
    return Buffer.from(Buffer.from(buf.subarray(MAGIC.length)).map((b) => b ^ MASK)).toString(
      'utf8',
    )
  },
}

/** Every file under `dir`, recursively. The `grep -r` of acceptance A8. */
function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...walk(path))
    else found.push(path)
  }
  return found
}

/**
 * Files containing `needle`, checked as bytes rather than as text.
 *
 * UTF-16 as well as UTF-8: a key written through an API that widens strings would
 * be invisible to a UTF-8-only search while sitting there perfectly readable in a
 * hex editor.
 */
function filesContaining(dir: string, needle: string): string[] {
  const utf8 = Buffer.from(needle, 'utf8')
  const utf16 = Buffer.from(needle, 'utf16le')
  return walk(dir)
    .filter((path) => {
      const bytes = readFileSync(path)
      return bytes.includes(utf8) || bytes.includes(utf16)
    })
    .map((path) => relative(dir, path))
}

/** Everything a running app would do that could put the key somewhere. */
async function exerciseTheApp(key: string): Promise<{ logger: Logger }> {
  const logger = new Logger({ directory: join(userData, 'logs'), level: 'debug' })
  logger.info('main process ready', { packaged: false })

  const settings = new SettingsStore({
    directory: userData,
    onWarn: (m, meta) => logger.warn(m, meta),
  })
  const secrets = new SecretStore({
    directory: userData,
    safeStorage,
    onWarn: (m, meta) => logger.warn(m, meta),
  })

  await secrets.setApiKey(key)
  logger.redactor.add(key)

  await settings.set(
    { serverUrl: 'https://harness.example.com', systemPrompt: 'be brief', temperature: 0.3 },
    await secrets.hasApiKey(),
  )

  // Read it back the way the app does before every request.
  expect(await secrets.getApiKey()).toBe(key)

  return { logger }
}

describe('A8: the API key is not in plaintext anywhere under userData', () => {
  it('after a normal configure-and-use cycle', async () => {
    await exerciseTheApp(KEY)
    expect(filesContaining(userData, KEY)).toEqual([])
  })

  it('even though the files it should be in do exist', async () => {
    // Guard against the assertion passing because nothing was written at all.
    await exerciseTheApp(KEY)
    const files = walk(userData).map((p) => relative(userData, p))
    expect(files).toContain('settings.json')
    expect(files).toContain('secrets.bin')
    expect(files.some((f) => f.startsWith('logs'))).toBe(true)
  })

  it('when the key is logged on purpose, repeatedly', async () => {
    const { logger } = await exerciseTheApp(KEY)
    // The shapes a careless call site would produce.
    logger.info(`connecting with ${KEY}`)
    logger.warn('request failed', { headers: { Authorization: `Bearer ${KEY}` } })
    logger.error('boom', new Error(`GET https://x/?api_key=${KEY}`))
    logger.debug('settings', { nested: { deeply: { apiKey: KEY } } })

    expect(filesContaining(userData, KEY)).toEqual([])
  })

  it('after the key is replaced — the old one must not linger', async () => {
    // Replacing a key rewrites secrets.bin; a partial write or an append would
    // leave the previous key recoverable.
    await exerciseTheApp(OLD_KEY)
    await exerciseTheApp(KEY)

    expect(filesContaining(userData, KEY)).toEqual([])
    expect(filesContaining(userData, OLD_KEY)).toEqual([])
  })

  it('after the key is cleared', async () => {
    const secrets = new SecretStore({ directory: userData, safeStorage })
    await secrets.setApiKey(KEY)
    await secrets.setApiKey('')

    expect(filesContaining(userData, KEY)).toEqual([])
    expect(await secrets.getApiKey()).toBeNull()
  })

  it('across a log rotation', async () => {
    const logger = new Logger({
      directory: join(userData, 'logs'),
      level: 'debug',
      maxBytes: 400,
      maxFiles: 3,
    })
    logger.redactor.add(KEY)
    await new SecretStore({ directory: userData, safeStorage }).setApiKey(KEY)

    // Enough traffic to roll the file over several times.
    for (let i = 0; i < 80; i += 1) logger.info(`attempt ${i} with ${KEY}`)

    expect(filesContaining(userData, KEY)).toEqual([])
  })

  it('when no secure store is available, because nothing is persisted at all', async () => {
    // The Linux-without-a-keyring path: SecretStore refuses to write rather than
    // falling back to plaintext, which is exactly what A8 forbids.
    const unavailable: SafeStorageLike = { ...safeStorage, isEncryptionAvailable: () => false }
    const secrets = new SecretStore({ directory: userData, safeStorage: unavailable })

    const result = await secrets.setApiKey(KEY)
    expect(result.ok).toBe(false)
    expect(filesContaining(userData, KEY)).toEqual([])
  })
})

describe('the A8 walk itself works', () => {
  it('finds a plaintext key that really is on disk', async () => {
    // Without this, every assertion above could be passing because the search is
    // broken rather than because the key is absent.
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(join(userData, 'nested', 'deeper'), { recursive: true })
    writeFileSync(join(userData, 'nested', 'deeper', 'leak.json'), `{"apiKey":"${KEY}"}`)

    expect(filesContaining(userData, KEY)).toEqual([join('nested', 'deeper', 'leak.json')])
  })

  it('finds a key written as UTF-16', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(userData, 'wide.bin'), Buffer.from(KEY, 'utf16le'))

    expect(filesContaining(userData, KEY)).toEqual(['wide.bin'])
  })
})
