/**
 * Main process entry: wire the services, register the IPC surface, open a window.
 *
 * The order matters. Settings and secrets come up before anything that could log,
 * so the API key is registered with the redactor before it can appear in a line.
 */

import { join } from 'node:path'

import { app, BrowserWindow, safeStorage } from 'electron'

import { IPC } from '@shared/ipc'
import { registerChatHandlers } from './ipc/chat.handlers'
import { registerConversationHandlers } from './ipc/conversations.handlers'
import { registerLogsHandlers } from './ipc/logs.handlers'
import { registerModelHandlers } from './ipc/models.handlers'
import { registerSettingsHandlers } from './ipc/settings.handlers'
import { Logger } from './lib/logger'
import { ConversationStore } from './services/conversationStore'
import { HarnessClient } from './services/harnessClient'
import { SecretStore } from './services/secretStore'
import { ServerPoller } from './services/serverPoller'
import { SettingsStore } from './services/settingsStore'
import { applyContentSecurityPolicy, createWindow } from './window'

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
  const conversations = new ConversationStore({
    directory: join(userData, 'conversations'),
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

  let window: BrowserWindow | null = null
  const webContents = (): BrowserWindow['webContents'] | null =>
    window && !window.isDestroyed() ? window.webContents : null

  const poller = new ServerPoller({
    client,
    logger,
    onChange: (state) => {
      const contents = webContents()
      if (contents && !contents.isDestroyed()) contents.send(IPC.modelsStateChanged, state)
    },
  })

  registerSettingsHandlers({
    settings,
    secrets,
    logger,
    onSettingsChanged: () => {
      void refreshConfig().then(() => poller.refresh())
    },
  })
  registerModelHandlers({ client, logger, refreshState: () => poller.refresh() })
  registerConversationHandlers({
    conversations,
    logger,
    defaultModelId: () => poller.state.activeModelId ?? '',
  })
  registerChatHandlers({
    client,
    conversations,
    logger,
    settings: async () => settings.get(await secrets.hasApiKey()),
    activeModelId: () => poller.state.activeModelId,
    webContents,
  })
  registerLogsHandlers({ client, logger })

  // The dev server URL is the only thing that loosens the policy, and a
  // packaged build never has one.
  applyContentSecurityPolicy(process.env.ELECTRON_RENDERER_URL)

  const open = (): void => {
    window = createWindow({
      // .cjs, not .mjs: a sandboxed preload must be CommonJS. The format is
      // forced in electron.vite.config.ts.
      preloadPath: join(import.meta.dirname, '../preload/index.cjs'),
      devServerUrl: process.env.ELECTRON_RENDERER_URL,
      rendererFile: join(import.meta.dirname, '../renderer/index.html'),
      onOpenExternal: (url) => logger.info('opening external link', { url }),
    })
    // Focus is the cheapest signal that the user is looking at stale state.
    window.on('focus', () => poller.refresh())
  }

  open()
  poller.start()
  logger.info('main process ready', { version: app.getVersion(), packaged: app.isPackaged })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) open()
  })

  app.on('window-all-closed', () => {
    poller.stop()
    if (process.platform !== 'darwin') app.quit()
  })
}

void app.whenReady().then(main)
