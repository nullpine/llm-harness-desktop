/**
 * Conversations on disk: one JSON file each, behind `ConversationRepository`
 * (`docs/ARCHITECTURE.md`, ADR-0003).
 *
 * The interface exists so the post-MVP move to SQLite touches one file. JSON was
 * chosen now purely to keep a native module out of the Electron build for a
 * single-user app with a few hundred conversations.
 *
 * **The conversation file is the source of truth; `index.json` is a cache.** They
 * are two separate atomic writes, so a process that dies between them leaves one
 * of two states — and the ordering below decides which. The conversation file is
 * always written first, so the survivable failure is a complete transcript with a
 * stale summary, never a summary promising a message the transcript lacks. A
 * stale entry is repaired lazily when the conversation is opened, because a
 * stale-but-valid index parses fine and nothing would otherwise notice.
 *
 * **A damaged file must never stop the app starting.** That is acceptance A10,
 * and it is the property most of this file is about: a conversation that fails to
 * parse is a logged warning and a skipped entry, and an unreadable `index.json`
 * is rebuilt from the directory rather than treated as fatal. Losing one
 * conversation is bad; refusing to open is unfixable by the user.
 */

import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { TITLE_MAX_LENGTH } from '@shared/constants'
import type { Conversation, ConversationSummary, Message } from '@shared/types'

import { atomicWrite } from '../lib/atomicWrite'
import { ulid } from '../lib/ulid'

export interface ConversationRepository {
  list(): Promise<ConversationSummary[]>
  get(id: string): Promise<Conversation | null>
  create(init: { title?: string | undefined; modelId: string }): Promise<Conversation>
  appendMessage(id: string, message: Message): Promise<void>
  rename(id: string, title: string): Promise<void>
  delete(id: string): Promise<void>
  /** Drop from the index; leave the file alone. */
  forget(id: string): Promise<void>
}

export interface ConversationStoreOptions {
  directory: string
  onWarn?: (message: string, meta?: unknown) => void
}

const INDEX_FILE = 'index.json'
const UNTITLED = 'New chat'

export class ConversationStore implements ConversationRepository {
  private readonly directory: string
  private readonly indexPath: string
  private readonly warn: (message: string, meta?: unknown) => void

  constructor(options: ConversationStoreOptions) {
    this.directory = options.directory
    this.indexPath = join(this.directory, INDEX_FILE)
    this.warn = options.onWarn ?? (() => {})
  }

  /**
   * Summaries, newest first.
   *
   * `index.json` is a cache, not the source of truth — the conversation files
   * are. So a damaged or missing index is rebuilt by reading the directory
   * rather than reported as an error.
   */
  async list(): Promise<ConversationSummary[]> {
    const indexed = await this.readIndex()
    if (indexed) return sortByUpdated(indexed)

    this.warn('rebuilding the conversation index from disk')
    const rebuilt = await this.rebuildIndex()
    await this.writeIndex(rebuilt)
    return sortByUpdated(rebuilt)
  }

  async get(id: string): Promise<Conversation | null> {
    if (!isSafeId(id)) {
      this.warn('refusing to read a conversation with an unsafe id', { id })
      return null
    }

    const conversation = await this.readConversation(id)
    if (conversation) await this.reconcileIndex(conversation)
    return conversation
  }

  /**
   * Repair this conversation's index entry if the file disagrees with it.
   *
   * The window is a quit between the two writes in `appendMessage`. Correcting
   * it here rather than with a transaction keeps the write path simple and puts
   * the cost on the rare case: opening a conversation already reads the file, so
   * the comparison is free and the write only happens when something is wrong.
   */
  private async reconcileIndex(conversation: Conversation): Promise<void> {
    const index = await this.readIndex()
    if (!index) return // A missing index is rebuilt wholesale elsewhere.

    const entry = index.find((row) => row.id === conversation.id)
    const summary = toSummary(conversation)
    if (
      entry &&
      entry.title === summary.title &&
      entry.updatedAt === summary.updatedAt &&
      entry.modelId === summary.modelId
    ) {
      return
    }

    this.warn('index entry disagreed with the conversation file; refreshing it', {
      id: conversation.id,
    })
    await this.writeIndex([...index.filter((row) => row.id !== conversation.id), summary])
  }

  async create(init: { title?: string | undefined; modelId: string }): Promise<Conversation> {
    const now = new Date().toISOString()
    const conversation: Conversation = {
      id: ulid(),
      title: init.title?.trim() || UNTITLED,
      createdAt: now,
      updatedAt: now,
      modelId: init.modelId,
      systemPrompt: null,
      messages: [],
    }
    await this.writeConversation(conversation)
    await this.touchIndex(conversation)
    return conversation
  }

  /**
   * Append and persist.
   *
   * Called before the request opens as well as after it finishes, so a crash
   * mid-stream still leaves what the user typed on disk.
   */
  async appendMessage(id: string, message: Message): Promise<void> {
    const conversation = await this.requireConversation(id)

    // Re-appending the same id is an update, not a duplicate: the assistant
    // message is written once when streaming ends and again if it is retried.
    const existing = conversation.messages.findIndex((m) => m.id === message.id)
    if (existing === -1) conversation.messages.push(message)
    else conversation.messages[existing] = message

    conversation.updatedAt = new Date().toISOString()
    if (conversation.title === UNTITLED) {
      conversation.title = deriveTitle(conversation.messages) ?? UNTITLED
    }

    // Transcript first, cache second. A kill between these two writes must leave
    // a complete transcript with a stale summary — not a summary promising a
    // message the transcript does not have.
    await this.writeConversation(conversation)
    await this.touchIndex(conversation)
  }

  async rename(id: string, title: string): Promise<void> {
    const conversation = await this.requireConversation(id)
    conversation.title = title.trim() || UNTITLED
    conversation.updatedAt = new Date().toISOString()
    await this.writeConversation(conversation)
    await this.touchIndex(conversation)
  }

  async delete(id: string): Promise<void> {
    if (!isSafeId(id)) throw new Error(`unsafe conversation id: ${id}`)
    await rm(this.conversationPath(id), { force: true })
    const index = (await this.readIndex()) ?? (await this.rebuildIndex())
    await this.writeIndex(index.filter((entry) => entry.id !== id))
  }

  /**
   * Remove an entry from the index without deleting anything.
   *
   * For a damaged conversation: the user wants it gone from the sidebar, but the
   * file may still be recoverable by hand and destroying it is not ours to
   * decide. A rebuild would resurrect the entry, so this is a bit leaky by
   * design — the alternative is silently deleting someone's data.
   */
  async forget(id: string): Promise<void> {
    const index = (await this.readIndex()) ?? (await this.rebuildIndex())
    await this.writeIndex(index.filter((entry) => entry.id !== id))
  }

  // --- files ----------------------------------------------------------------

  private conversationPath(id: string): string {
    return join(this.directory, `${id}.json`)
  }

  private async requireConversation(id: string): Promise<Conversation> {
    const conversation = await this.get(id)
    if (!conversation) throw new Error(`no conversation ${id}`)
    return conversation
  }

  private async readConversation(id: string): Promise<Conversation | null> {
    let raw: string
    try {
      raw = await readFile(this.conversationPath(id), 'utf8')
    } catch {
      return null
    }

    try {
      return parseConversation(JSON.parse(raw), id)
    } catch (cause) {
      // A10: skipped, logged, never thrown at startup.
      this.warn(`conversation ${id} is unreadable and was skipped`, cause)
      return null
    }
  }

  private async writeConversation(conversation: Conversation): Promise<void> {
    await atomicWrite(
      this.conversationPath(conversation.id),
      `${JSON.stringify(conversation, null, 2)}\n`,
    )
  }

  // --- the index ------------------------------------------------------------

  /** Null when the index is missing or unusable — the caller rebuilds. */
  private async readIndex(): Promise<ConversationSummary[] | null> {
    let raw: string
    try {
      raw = await readFile(this.indexPath, 'utf8')
    } catch {
      return null
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error('index.json is not an array')
      return parsed.filter(isSummary)
    } catch (cause) {
      this.warn('index.json is unreadable; it will be rebuilt from the directory', cause)
      return null
    }
  }

  private async writeIndex(summaries: ConversationSummary[]): Promise<void> {
    await atomicWrite(this.indexPath, `${JSON.stringify(sortByUpdated(summaries), null, 2)}\n`)
  }

  /** Read every conversation file and summarise it. Damaged ones are skipped. */
  private async rebuildIndex(): Promise<ConversationSummary[]> {
    let entries: string[]
    try {
      entries = await readdir(this.directory)
    } catch {
      return []
    }

    const summaries: ConversationSummary[] = []
    for (const entry of entries) {
      if (entry === INDEX_FILE || !entry.endsWith('.json')) continue
      const id = entry.slice(0, -'.json'.length)
      const conversation = await this.readConversation(id)
      if (conversation) summaries.push(toSummary(conversation))
    }
    return summaries
  }

  private async touchIndex(conversation: Conversation): Promise<void> {
    const index = (await this.readIndex()) ?? (await this.rebuildIndex())
    const summary = toSummary(conversation)
    const without = index.filter((entry) => entry.id !== conversation.id)
    await this.writeIndex([...without, summary])
  }
}

// --- parsing ------------------------------------------------------------------

/**
 * Validate a conversation read from disk.
 *
 * Strict on the structure and lenient within it: a message missing `content` is
 * dropped, but that does not condemn the whole conversation. A file that is not a
 * conversation at all throws, and the caller skips it.
 */
function parseConversation(raw: unknown, expectedId: string): Conversation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('not an object')
  }
  const row = raw as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : expectedId
  const createdAt = typeof row.createdAt === 'string' ? row.createdAt : new Date(0).toISOString()

  if (!Array.isArray(row.messages)) throw new Error('messages is not an array')

  return {
    id,
    title: typeof row.title === 'string' && row.title.trim() !== '' ? row.title : UNTITLED,
    createdAt,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : createdAt,
    modelId: typeof row.modelId === 'string' ? row.modelId : '',
    systemPrompt: typeof row.systemPrompt === 'string' ? row.systemPrompt : null,
    messages: row.messages.filter(isMessage),
  }
}

function isMessage(raw: unknown): raw is Message {
  if (typeof raw !== 'object' || raw === null) return false
  const row = raw as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    (row.role === 'user' || row.role === 'assistant' || row.role === 'system') &&
    typeof row.content === 'string' &&
    typeof row.createdAt === 'string'
  )
}

function isSummary(raw: unknown): raw is ConversationSummary {
  if (typeof raw !== 'object' || raw === null) return false
  const row = raw as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.title === 'string' &&
    typeof row.updatedAt === 'string' &&
    typeof row.modelId === 'string'
  )
}

function toSummary(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    modelId: conversation.modelId,
  }
}

function sortByUpdated(summaries: ConversationSummary[]): ConversationSummary[] {
  return [...summaries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** The first 48 characters of the first user message (SPEC §7). */
export function deriveTitle(messages: Message[]): string | null {
  const first = messages.find((m) => m.role === 'user' && m.content.trim() !== '')
  if (!first) return null
  const flattened = first.content.trim().replace(/\s+/g, ' ')
  return flattened.length <= TITLE_MAX_LENGTH
    ? flattened
    : `${flattened.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`
}

/**
 * Ids come from `ulid()`, but they also arrive over IPC from the renderer, so a
 * traversal like `../../settings` must not reach the filesystem.
 */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id)
}
