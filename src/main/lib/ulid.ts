/**
 * ULIDs for message and conversation ids (SPEC §7).
 *
 * Lexicographically sortable by creation time, which is what makes
 * `conversations/` browsable and the message order stable without a separate
 * index. Small enough not to justify a dependency.
 */

import { randomBytes } from 'node:crypto'

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32
const TIME_CHARS = 10
const RANDOM_CHARS = 16

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom()
}

function encodeTime(now: number): string {
  let remaining = now
  let out = ''
  for (let i = 0; i < TIME_CHARS; i += 1) {
    out = ENCODING[remaining % 32] + out
    remaining = Math.floor(remaining / 32)
  }
  return out
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_CHARS)
  let out = ''
  for (const byte of bytes) out += ENCODING[byte % 32]
  return out
}
