/** `conv:*` — the renderer's view of the persisted transcript (SPEC §6). */

import { appError } from '@shared/errors'
import { IPC } from '@shared/ipc'
import type { Conversation, ConversationSummary, Message } from '@shared/types'

import type { Logger } from '../lib/logger'
import type { ConversationRepository } from '../services/conversationStore'
import { failWith, handle } from './index'

export interface ConversationHandlerDeps {
  conversations: ConversationRepository
  logger: Logger
  /** The model to stamp on a new conversation when the renderer does not say. */
  defaultModelId: () => string
}

export function registerConversationHandlers(deps: ConversationHandlerDeps): void {
  const { conversations, logger } = deps

  handle<void, ConversationSummary[]>(IPC.convList, logger, () => conversations.list())

  handle<{ id: string }, Conversation>(IPC.convGet, logger, async ({ id }) => {
    const conversation = await conversations.get(id)
    if (!conversation) {
      // A10 in the foreground: a conversation skipped at load time is simply
      // absent, and the renderer says so rather than hanging.
      // The renderer turns this into a distinct "damaged" pane rather than the
      // empty state, which otherwise looks like an ordinary empty chat.
      throw failWith(
        appError('not_found', "This conversation's file is damaged and couldn't be opened."),
      )
    }
    return conversation
  })

  handle<{ title?: string; modelId: string }, Conversation>(
    IPC.convCreate,
    logger,
    ({ title, modelId }) =>
      conversations.create({ title, modelId: modelId || deps.defaultModelId() }),
  )

  handle<{ id: string; message: Message }, void>(IPC.convAppendMessage, logger, ({ id, message }) =>
    conversations.appendMessage(id, message),
  )

  handle<{ id: string; title: string }, void>(IPC.convRename, logger, ({ id, title }) =>
    conversations.rename(id, title),
  )

  handle<{ id: string }, void>(IPC.convDelete, logger, ({ id }) => conversations.delete(id))

  handle<{ id: string }, void>(IPC.convForget, logger, ({ id }) => conversations.forget(id))
}
