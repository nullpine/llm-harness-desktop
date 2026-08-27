/**
 * Where "— switched to X —" goes in a transcript (SPEC §8.1).
 *
 * Derived from the messages themselves rather than recorded as events: each
 * assistant message already carries the `modelId` that produced it, so the
 * transitions are a property of the transcript and survive a reload. Storing
 * separate divider entries would mean two sources of truth that can disagree.
 */

import type { Message } from '@shared/types'

export interface TranscriptItem {
  kind: 'message' | 'divider'
  message?: Message
  /** For a divider: the model that everything after it was answered by. */
  modelId?: string
}

/**
 * Interleave dividers into a message list.
 *
 * A divider appears before the first assistant message produced by a model that
 * differs from the previous one. The *first* model is not announced — there is
 * nothing to have switched from.
 */
export function withDividers(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let current: string | null = null

  for (const message of messages) {
    const modelId = message.role === 'assistant' ? message.modelId : undefined

    if (modelId && modelId !== current) {
      if (current !== null) {
        items.push({ kind: 'divider', modelId })
      }
      current = modelId
    }
    items.push({ kind: 'message', message })
  }

  return items
}
