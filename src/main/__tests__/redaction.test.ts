/**
 * The API key must never reach a log file (SPEC acceptance A8).
 *
 * Redaction lives in the logger rather than at call sites, so these tests push
 * the key through every shape a caller might plausibly use — a message, a meta
 * object, a nested field, an `Error` — and then read the file back off disk.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Logger, REDACTED, Redactor } from '../lib/logger'

const KEY = 'hk_live_9f3a2b7c1d4e5f6a8b9c0d1e2f3a4b5c'

let directory: string
let logger: Logger

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'harness-log-'))
  logger = new Logger({ directory, level: 'debug' })
  logger.redactor.add(KEY)
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const logFile = (): string => readFileSync(join(directory, 'main.log'), 'utf8')

// --- the end-to-end guarantee -----------------------------------------------

describe('the key never reaches the log file', () => {
  it('scrubs it from a message', () => {
    logger.info(`connecting with ${KEY}`)
    expect(logFile()).not.toContain(KEY)
    expect(logFile()).toContain(REDACTED)
  })

  it('scrubs it from a meta object', () => {
    logger.info('request', { headers: { Authorization: `Bearer ${KEY}` } })
    expect(logFile()).not.toContain(KEY)
  })

  it('scrubs it from a deeply nested field', () => {
    logger.error('failed', { a: { b: { c: [{ key: KEY }] } } })
    expect(logFile()).not.toContain(KEY)
  })

  it('scrubs it from an Error message', () => {
    logger.error('boom', new Error(`request to https://x/?token=${KEY} failed`))
    expect(logFile()).not.toContain(KEY)
  })

  it('scrubs it from a URL query string', () => {
    logger.warn(`GET https://harness.example.com/v1/models?api_key=${KEY}`)
    expect(logFile()).not.toContain(KEY)
  })

  it('survives the key appearing many times in one record', () => {
    logger.info(`${KEY} ${KEY}`, { first: KEY, second: `x${KEY}y` })
    expect(logFile()).not.toContain(KEY)
  })

  it('redacts a field named like a secret even when the value is unknown to us', () => {
    // A key we were never told about — a second server, a pasted token.
    logger.info('settings', { apiKey: 'some-other-key-entirely' })
    expect(logFile()).not.toContain('some-other-key-entirely')
  })

  it('redacts a bearer header for a key it was never told about', () => {
    logger.info('Authorization: Bearer sk-someone-elses-token-value')
    expect(logFile()).not.toContain('sk-someone-elses-token-value')
  })
})

// --- it must still be a useful log ------------------------------------------

describe('ordinary logging still works', () => {
  it('keeps non-secret content intact', () => {
    logger.info('model glm-4.7-flash is ready', { latencyMs: 42 })
    const line = logFile()
    expect(line).toContain('glm-4.7-flash is ready')
    expect(line).toContain('42')
  })

  it('writes one JSON object per line', () => {
    logger.info('one')
    logger.info('two')
    const lines = logFile().trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(() => JSON.parse(line) as unknown).not.toThrow()
    }
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'info', message: 'one' })
  })

  it('respects the level threshold', () => {
    const quiet = new Logger({ directory, level: 'warn' })
    quiet.debug('nope')
    quiet.info('nope')
    quiet.warn('yes')
    expect(logFile()).toContain('yes')
    expect(logFile()).not.toContain('nope')
  })

  it('does not throw when the meta object has a cycle', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(() => logger.info('cyclic', cyclic)).not.toThrow()
  })
})

// --- rotation ---------------------------------------------------------------

describe('rotation', () => {
  it('rolls the file over at the size limit and keeps a bounded number', () => {
    const rotating = new Logger({ directory, level: 'debug', maxBytes: 400, maxFiles: 3 })
    for (let i = 0; i < 60; i += 1) rotating.info(`line ${i} ${'x'.repeat(40)}`)

    const files = readdirSync(directory).filter((f) => f.startsWith('main.log'))
    expect(files.length).toBeGreaterThan(1)
    expect(files.length).toBeLessThanOrEqual(3)
  })

  it('keeps redacting across a rotation', () => {
    const rotating = new Logger({ directory, level: 'debug', maxBytes: 300, maxFiles: 3 })
    rotating.redactor.add(KEY)
    for (let i = 0; i < 40; i += 1) rotating.info(`attempt ${i} with ${KEY}`)

    for (const file of readdirSync(directory)) {
      expect(readFileSync(join(directory, file), 'utf8')).not.toContain(KEY)
    }
  })
})

// --- the redactor on its own -------------------------------------------------

describe('Redactor', () => {
  it('ignores secrets too short to be meaningful', () => {
    const redactor = new Redactor()
    redactor.add('abc')
    redactor.add('')
    expect(redactor.text('abc is a normal word')).toBe('abc is a normal word')
  })

  it('forgets a secret once removed', () => {
    const redactor = new Redactor()
    redactor.add(KEY)
    expect(redactor.text(KEY)).toBe(REDACTED)
    redactor.remove(KEY)
    expect(redactor.text(KEY)).toBe(KEY)
  })

  it('handles a null or undefined secret', () => {
    const redactor = new Redactor()
    expect(() => {
      redactor.add(null)
      redactor.add(undefined)
    }).not.toThrow()
  })

  it('stops at a depth limit rather than recursing forever', () => {
    const redactor = new Redactor()
    let nested: Record<string, unknown> = { value: 'leaf' }
    for (let i = 0; i < 20; i += 1) nested = { nested }
    expect(() => redactor.value(nested)).not.toThrow()
  })
})
