/** `logs:fetch` — the server's own logs, for the failure-diagnosis modal. */

import { IPC, type LogsRequest } from '@shared/ipc'

import type { Logger } from '../lib/logger'
import type { HarnessClient } from '../services/harnessClient'
import { failWith, handle } from './index'

export interface LogsHandlerDeps {
  client: HarnessClient
  logger: Logger
}

export function registerLogsHandlers(deps: LogsHandlerDeps): void {
  handle<LogsRequest, { lines: string[] }>(IPC.logsFetch, deps.logger, async (request) => {
    const result = await deps.client.getLogs(request.source, request.lines)
    if (!result.ok) throw failWith(result.error)
    return result.value
  })
}
