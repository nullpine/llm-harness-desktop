/**
 * The browser window, locked down (SPEC §5, `.claude/rules/network-boundary.md`).
 *
 * None of these options are negotiable. The renderer displays markdown produced
 * by a language model; treat that as hostile content and everything here follows:
 * no Node in the renderer, an isolated context, a sandboxed process, a CSP that
 * forbids reaching the network at all, and no way to navigate or open a window
 * away from the app.
 */

import { join } from 'node:path'

import { BrowserWindow, shell, session, type BrowserWindowConstructorOptions } from 'electron'

/**
 * `connect-src 'self'` is the belt to the renderer's braces: even if something
 * did call `fetch`, the request would not leave. Network access is the main
 * process's job (ADR-0002).
 */
/**
 * The Content-Security-Policy, built for the environment it will run in.
 *
 * Applied from main via `onHeadersReceived`, not as a `<meta>` tag. Two reasons:
 * a meta tag is baked into the HTML and so cannot differ between dev and a
 * packaged build, and it covers only the document carrying it rather than every
 * response in the session.
 *
 * `connect-src 'self'` is the belt to the renderer's braces: even if something
 * did call `fetch`, the request would not leave. Network access is the main
 * process's job (ADR-0002).
 */
export function contentSecurityPolicy(devServerUrl?: string | undefined): string {
  const directives = [
    "default-src 'self'",
    "img-src 'self' data:",
    // Tailwind injects styles at runtime, so 'unsafe-inline' is unavoidable.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ]

  // Everything below is dev-only and gated on an actual dev server URL, which a
  // packaged build never has. A packaged app therefore cannot receive the
  // loosened policy even if this function were called by mistake.
  if (devServerUrl) {
    const origin = originOf(devServerUrl)
    directives.push(
      // Vite injects the react-refresh preamble as an inline <script>. There is
      // no nonce to attach to it, so HMR needs 'unsafe-inline' here.
      "script-src 'self' 'unsafe-inline'",
      // The dev server serves the bundle over http and pushes HMR updates over
      // a websocket on the same origin.
      `connect-src 'self' ${origin} ${origin.replace(/^http/, 'ws')}`,
    )
  } else {
    directives.push("script-src 'self'", "connect-src 'self'")
  }

  return directives.join('; ')
}

/** The strict, packaged policy — SPEC §5. Exported so a test can assert it. */
export const PACKAGED_CSP = contentSecurityPolicy()

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

export interface CreateWindowOptions {
  preloadPath: string
  /** The dev server URL, when electron-vite is running one. */
  devServerUrl?: string | undefined
  rendererFile: string
  onOpenExternal?: (url: string) => void
}

export function windowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      // The renderer has no business spawning anything.
      webviewTag: false,
    },
  }
}

export function createWindow(options: CreateWindowOptions): BrowserWindow {
  const window = new BrowserWindow(windowOptions(options.preloadPath))

  window.once('ready-to-show', () => window.show())

  applyNavigationPolicy(window, options.onOpenExternal)

  if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl)
  } else {
    void window.loadFile(options.rendererFile)
  }

  return window
}

/**
 * Nothing navigates, nothing opens a window.
 *
 * A model can emit a link, and a user can click it. That must go to the system
 * browser, and only for `https:` — `file:` would open local content inside the
 * app, and a custom scheme could hand the click to another application.
 */
export function applyNavigationPolicy(
  window: BrowserWindow,
  onOpenExternal: (url: string) => void = defaultOpenExternal,
): void {
  window.webContents.on('will-navigate', (event, url) => {
    // In dev the renderer legitimately lives on the vite dev server.
    if (isInternal(url, window)) return
    event.preventDefault()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) onOpenExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

function isInternal(url: string, window: BrowserWindow): boolean {
  const current = window.webContents.getURL()
  if (!current) return false
  try {
    return new URL(url).origin === new URL(current).origin
  } catch {
    return false
  }
}

function defaultOpenExternal(url: string): void {
  void shell.openExternal(url)
}

/**
 * Apply the CSP to the default session, so it covers the renderer and any
 * subframe rather than only the document that carries a meta tag.
 *
 * `devServerUrl` is the *only* thing that loosens it, and a packaged build never
 * has one.
 */
export function applyContentSecurityPolicy(devServerUrl?: string | undefined): void {
  const policy = contentSecurityPolicy(devServerUrl)

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })

  // The app needs no camera, microphone, geolocation or notifications. Denying
  // by default means a future feature has to ask deliberately.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

export const rendererEntry = (appPath: string): string =>
  join(appPath, 'out', 'renderer', 'index.html')
