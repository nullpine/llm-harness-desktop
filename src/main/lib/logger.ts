/**
 * Rotating file logger with redaction at the centre.
 *
 * Redaction is a property of the logger, not a discipline expected of callers.
 * Anything registered as a secret is scrubbed from every record before it is
 * written, because the alternative — remembering not to log the key at each of
 * fifty call sites — fails exactly once and then the key is in a file forever
 * (CLAUDE.md rule 3, SPEC acceptance A8).
 */

import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { LOG_MAX_BYTES, LOG_MAX_FILES } from '@shared/constants'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export const REDACTED = '[redacted]'

/** Below this length a "secret" is more likely to be a substring of real text. */
const MIN_SECRET_LENGTH = 8

/** Token-shaped things, whether or not we were told about them. */
const PATTERNS: RegExp[] = [
  /\bbearer\s+[A-Za-z0-9\-._~+/]{8,}={0,2}/gi,
  /\b(api[_-]?key|apikey|token|authorization|secret)\b(\s*[=:]\s*)"?[^\s"',}]{8,}/gi,
]

export class Redactor {
  private readonly secrets = new Set<string>()

  add(secret: string | null | undefined): void {
    if (typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH) this.secrets.add(secret)
  }

  remove(secret: string): void {
    this.secrets.delete(secret)
  }

  clear(): void {
    this.secrets.clear()
  }

  /** Scrub a string. Exact secrets first, then anything token-shaped. */
  text(value: string): string {
    let out = value
    for (const secret of this.secrets) out = out.split(secret).join(REDACTED)
    for (const pattern of PATTERNS) {
      out = out.replace(pattern, (match) => {
        const separator = match.search(/[\s=:]/)
        return separator === -1 ? REDACTED : `${match.slice(0, separator + 1)}${REDACTED}`
      })
    }
    return out
  }

  /** Scrub anything, structurally — an Error, an object, an array, a primitive. */
  value(input: unknown, depth = 0): unknown {
    if (depth > 6) return '[depth limit]'
    if (typeof input === 'string') return this.text(input)
    if (input === null || typeof input !== 'object') return input
    if (input instanceof Error) {
      return { name: input.name, message: this.text(input.message) }
    }
    if (Array.isArray(input)) return input.map((item) => this.value(item, depth + 1))

    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      // A field *named* like a secret is redacted whatever it holds — a key we
      // were never told about still must not reach the disk.
      out[key] = /^(api_?key|apikey|token|secret|authorization|password)$/i.test(key)
        ? REDACTED
        : this.value(val, depth + 1)
    }
    return out
  }
}

export interface LoggerOptions {
  directory: string
  level?: LogLevel
  maxBytes?: number
  maxFiles?: number
  /** Also mirror to the console. On in dev, off in a packaged app. */
  console?: boolean
}

export class Logger {
  readonly redactor = new Redactor()
  private readonly file: string
  private readonly level: number
  private readonly maxBytes: number
  private readonly maxFiles: number
  private readonly mirrorToConsole: boolean

  constructor(private readonly options: LoggerOptions) {
    this.file = join(options.directory, 'main.log')
    this.level = LEVEL_ORDER[options.level ?? 'info']
    this.maxBytes = options.maxBytes ?? LOG_MAX_BYTES
    this.maxFiles = options.maxFiles ?? LOG_MAX_FILES
    this.mirrorToConsole = options.console ?? false
    mkdirSync(options.directory, { recursive: true })
  }

  debug = (message: string, meta?: unknown) => this.write('debug', message, meta)
  info = (message: string, meta?: unknown) => this.write('info', message, meta)
  warn = (message: string, meta?: unknown) => this.write('warn', message, meta)
  error = (message: string, meta?: unknown) => this.write('error', message, meta)

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] < this.level) return

    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      message: this.redactor.text(message),
    }
    if (meta !== undefined) record.meta = this.redactor.value(meta)

    // One last pass over the serialised line. Belt and braces: a secret reachable
    // only through some exotic toJSON would still be caught here.
    const line = `${this.redactor.text(JSON.stringify(record))}\n`

    this.rotateIfNeeded(Buffer.byteLength(line))
    try {
      appendFileSync(this.file, line, { mode: 0o600 })
    } catch {
      // A logger that throws takes the app down with it. Losing a line is better.
    }
    if (this.mirrorToConsole) {
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
      console[method](line.trimEnd())
    }
  }

  private rotateIfNeeded(incoming: number): void {
    let size = 0
    try {
      size = statSync(this.file).size
    } catch {
      return // No file yet, so nothing to rotate.
    }
    if (size + incoming <= this.maxBytes) return

    try {
      // main.log.4 falls off the end; the rest shift up one.
      rmSync(`${this.file}.${this.maxFiles - 1}`, { force: true })
      for (let i = this.maxFiles - 2; i >= 1; i -= 1) {
        try {
          renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`)
        } catch {
          /* that generation does not exist yet */
        }
      }
      renameSync(this.file, `${this.file}.1`)
    } catch {
      /* rotation is best-effort; never fail a log call over it */
    }
  }

  get filePath(): string {
    return this.file
  }

  get directory(): string {
    return this.options.directory
  }
}
