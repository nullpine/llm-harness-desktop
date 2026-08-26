/**
 * Atomic file writes: `tmp` → `fsync` → `rename` (SPEC §7).
 *
 * The failure this prevents is a power cut or a crash mid-write leaving a
 * half-written `settings.json` or conversation file. `rename` within a directory
 * is atomic on every platform we ship to, so a reader sees either the old file or
 * the new one, never a truncated one.
 */

import { randomBytes } from 'node:crypto'
import { open, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function atomicWrite(filePath: string, data: string | Uint8Array): Promise<void> {
  const directory = dirname(filePath)
  await mkdir(directory, { recursive: true })

  // A random suffix, not a fixed `.tmp`: two writers racing on the same path must
  // not clobber each other's temp file and rename a mixture of both.
  const tempPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`

  let handle
  try {
    handle = await open(tempPath, 'wx', 0o600)
    await handle.writeFile(data)
    // Without the fsync the rename can land before the bytes do, which on a
    // crash leaves an atomically-renamed empty file — the worst of both worlds.
    await handle.sync()
  } finally {
    await handle?.close()
  }

  try {
    await rename(tempPath, filePath)
  } catch (cause) {
    await unlink(tempPath).catch(() => {})
    throw cause
  }
}
