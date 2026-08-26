/**
 * The API key, encrypted at rest via Electron's `safeStorage` (SPEC §4).
 *
 * `safeStorage.isEncryptionAvailable()` returns false on some Linux desktops —
 * no libsecret, no keyring daemon. When it does, this **refuses to persist**
 * rather than falling back to plaintext. A key in a readable file is exactly the
 * outcome acceptance A8 exists to prevent, and silently degrading to it would be
 * the worst kind of helpful.
 */

import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { atomicWrite } from '../lib/atomicWrite'

/** The slice of Electron's `safeStorage` this needs. Injected, so it is testable. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface SecretStoreOptions {
  directory: string
  safeStorage: SafeStorageLike
  onWarn?: (message: string, meta?: unknown) => void
}

export type SetKeyResult =
  { ok: true } | { ok: false; reason: 'encryption_unavailable' | 'write_failed'; message: string }

export class SecretStore {
  private readonly file: string
  private readonly safeStorage: SafeStorageLike
  private readonly warn: (message: string, meta?: unknown) => void
  /** Held in memory so every request does not hit the keychain. */
  private cached: string | null = null
  private loaded = false

  constructor(options: SecretStoreOptions) {
    this.file = join(options.directory, 'secrets.bin')
    this.safeStorage = options.safeStorage
    this.warn = options.onWarn ?? (() => {})
  }

  get encryptionAvailable(): boolean {
    try {
      return this.safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  async setApiKey(key: string): Promise<SetKeyResult> {
    const trimmed = key.trim()

    if (trimmed === '') {
      await this.clear()
      return { ok: true }
    }

    if (!this.encryptionAvailable) {
      // Keep it usable for this session, but nothing touches the disk.
      this.cached = trimmed
      this.loaded = true
      this.warn(
        'safeStorage reports encryption is unavailable; the API key will be kept in memory ' +
          'for this session only and will not be written to disk',
      )
      return {
        ok: false,
        reason: 'encryption_unavailable',
        message:
          'This system has no secure credential store available, so the key cannot be saved. ' +
          'It will work until you quit, then you will need to enter it again.',
      }
    }

    try {
      await atomicWrite(this.file, this.safeStorage.encryptString(trimmed))
    } catch (cause) {
      this.warn('could not write secrets.bin', cause)
      return { ok: false, reason: 'write_failed', message: 'The API key could not be saved.' }
    }

    this.cached = trimmed
    this.loaded = true
    return { ok: true }
  }

  /** The key, or null. Main-process callers only — this never crosses IPC. */
  async getApiKey(): Promise<string | null> {
    if (this.loaded) return this.cached

    this.loaded = true
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.file)
    } catch {
      this.cached = null
      return null
    }

    if (!this.encryptionAvailable) {
      this.warn('secrets.bin exists but safeStorage cannot decrypt it on this system')
      this.cached = null
      return null
    }

    try {
      this.cached = this.safeStorage.decryptString(encrypted)
    } catch (cause) {
      // Usually a keychain entry from another machine or a different user.
      this.warn('secrets.bin could not be decrypted; treating the key as unset', cause)
      this.cached = null
    }
    return this.cached
  }

  async hasApiKey(): Promise<boolean> {
    return (await this.getApiKey()) !== null
  }

  async clear(): Promise<void> {
    this.cached = null
    this.loaded = true
    await rm(this.file, { force: true })
  }
}
