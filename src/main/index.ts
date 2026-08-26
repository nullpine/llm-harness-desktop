/**
 * Main process entry: wire the services, register the IPC surface, open a window.
 *
 * The order matters. Settings and secrets come up before anything that could log,
 * so the API key is registered with the redactor before it can appear in a line.
 */

import { app, BrowserWindow, safeStorage } from 'electron'
import { join } from 'node:path'

import { IPC } from '@shared/ipc'
import { handleUnimplemented } from './ipc/index'
import { registerModelHandlers } from './ipc/models.handlers'
import { registerSettingsHandlers } from './ipc/settings.handlers'
import { Logger } from './lib/logger'
import { HarnessClient } from './services/harnessClient'
import { SecretStore } from './services/secretStore'
import { SettingsStore } from './services/settingsStore'
import { applyContentSecurityPolicy, createWindow } from './window'

/** Channels declared in `shared/ipc.ts` whose handlers land in M2. */
const M2_CHANNELS = [
  IPC.chatSend,
  IPC.chatAbort,
  IPC.convList,
  IPC.convGet,
  IPC.convCreate,
  IPC.convAppendMessage,
  IPC.convRename,
  IPC.convDelete,
  IPC.logsFetch,
] as const

async function main(): Promise<void> {
  const userData = app.getPath('userData')

  const logger = new Logger({
    directory: join(userData, 'logs'),
    level: app.isPackaged ? 'info' : 'debug',
    console: !app.isPackaged,
  })

  const settings = new SettingsStore({
    directory: userData,
    onWarn: (message, meta) => logger.warn(message, meta),
  })
  const secrets = new SecretStore({
    directory: userData,
    safeStorage,
    onWarn: (message, meta) => logger.warn(message, meta),
  })

  // Before anything else can log: a key already on disk must be redactable from
  // the first line, not from the first time the user re-enters it.
  const existingKey = await secrets.getApiKey()
  logger.redactor.add(existingKey)

  // Cached rather than read per request: the client's config provider is
  // synchronous by design, so a request never waits on the disk.
  let currentServerUrl = ''
  let currentApiKey = ''

  const client = new HarnessClient(
    () => ({ serverUrl: currentServerUrl, apiKey: currentApiKey }),
    app.getVersion(),
  )

  const refreshConfig = async (): Promise<void> => {
    const current = await settings.get(false)
    currentServerUrl = current.serverUrl
    currentApiKey = (await secrets.getApiKey()) ?? ''
  }
  await refreshConfig()

  registerSettingsHandlers({
    settings,
    secrets,
    logger,
    onSettingsChanged: () => void refreshConfig(),
  })
  registerModelHandlers({ client, logger })
  for (const channel of M2_CHANNELS) handleUnimplemented(channel, 'M2')

  applyContentSecurityPolicy()

  const open = (): void => {
    createWindow({
      preloadPath: join(import.meta.dirname, '../preload/index.mjs'),
      devServerUrl: process.env.ELECTRON_RENDERER_URL,
      rendererFile: join(import.meta.dirname, '../renderer/index.html'),
      onOpenExternal: (url) => logger.info('opening external link', { url }),
    })
  }

  open()
  logger.info('main process ready', { version: app.getVersion(), packaged: app.isPackaged })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) open()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

void app.whenReady().then(main)
