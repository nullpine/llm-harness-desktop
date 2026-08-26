/**
 * IPC registration, and the one place a handler's exception is caught.
 *
 * Nothing throws across the boundary (`.claude/rules/streaming-and-ipc.md`), so
 * every handler is wrapped: a thrown error becomes `Result.err` rather than an
 * unhandled rejection in the renderer's `invoke`.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import { appError, type AppError } from '@shared/errors'
import { err, ok, type InvokeChannel, type Result } from '@shared/ipc'

import type { Logger } from '../lib/logger'

export type Handler<Request, Response> = (
  request: Request,
  event: IpcMainInvokeEvent,
) => Promise<Response> | Response

/**
 * Register one channel. The handler returns a plain value; the wrapper turns it
 * into a `Result` and converts anything thrown into one too.
 */
export function handle<Request, Response>(
  channel: InvokeChannel,
  logger: Logger,
  handler: Handler<Request, Response>,
): void {
  ipcMain.handle(channel, async (event, request: Request): Promise<Result<Response>> => {
    try {
      return ok(await handler(request, event))
    } catch (cause) {
      const carried = carriedAppError(cause)
      if (carried) {
        // A server error that a handler chose to propagate. Expected, not a bug —
        // and its code has to survive, because `errorCopy.ts` branches on it.
        logger.warn(`${channel} failed`, { code: carried.code, message: carried.message })
        return err(carried)
      }
      // Anything else reaching here is a bug, and is reported as one.
      logger.error(`unhandled error in ${channel}`, cause)
      return err(
        appError(
          'internal',
          cause instanceof Error ? cause.message : 'an unexpected error occurred',
        ),
      )
    }
  })
}

/**
 * Attach an `AppError` to a thrown error so `handle` can report it faithfully.
 *
 * Handlers `throw failWith(error)` for expected server failures; the alternative
 * — every handler returning a `Result` that `handle` then has to unwrap — puts
 * the same branch in every single one.
 */
export function failWith(error: AppError): Error {
  return Object.assign(new Error(error.message), { [APP_ERROR]: error })
}

const APP_ERROR = Symbol.for('harness.appError')

function carriedAppError(cause: unknown): AppError | null {
  if (typeof cause !== 'object' || cause === null) return null
  const carried = (cause as Record<symbol, unknown>)[APP_ERROR]
  return carried && typeof carried === 'object' ? (carried as AppError) : null
}

/**
 * Register a channel that is declared but not implemented in this milestone.
 *
 * Declaring the whole table in `shared/ipc.ts` and answering `not_implemented`
 * beats leaving the channel unregistered: `invoke` on a missing channel rejects
 * with an opaque Electron error, which is the one thing this boundary promises
 * never to do.
 */
export function handleUnimplemented(channel: InvokeChannel, milestone: string): void {
  ipcMain.handle(channel, async (): Promise<Result<never>> =>
    err(appError('internal', `${channel} is not implemented yet (lands in ${milestone})`)),
  )
}
