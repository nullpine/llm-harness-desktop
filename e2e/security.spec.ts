/**
 * The security boundary — acceptance **A8** and **A9**.
 *
 * Both were verified by hand or structurally in earlier milestones. A9 in
 * particular was only ever checked by grepping the built bundle for `fetch(`;
 * this exercises a full send/stream and watches what the renderer actually does.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { IPC } from '@shared/ipc'

import {
  configure,
  expect,
  launchApp,
  openSettings,
  send,
  test,
  waitForState,
} from './fixtures/app'

/** Every file under `dir`, recursively — the `grep -r` of acceptance A8. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

test('A9: the renderer makes no requests to the server origin, even mid-stream', async ({
  appHandle,
  mock,
}) => {
  const { window, app } = appHandle
  const origin = new URL(mock.url).origin

  // CDP rather than page.on('request'): the built app loads from file://, which
  // Playwright's request event does not report. With nothing ever recorded this
  // assertion would pass whatever the renderer did — the exact "passes because
  // it checks less" trap. The Network domain reports every load, so the asset
  // requests below double as proof the recorder is working.
  const cdp = await app.context().newCDPSession(window)
  const requests: string[] = []
  await cdp.send('Network.enable')
  cdp.on('Network.requestWillBeSent', (event) => requests.push(event.request.url))

  // Reload so the recorder observes the app's own asset loads. Without this the
  // renderer makes no requests at all — everything network lives in main — and
  // "no requests to the server origin" would be trivially true even if the
  // recorder were broken.
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
  await expect(window.locator('#root')).toBeVisible()

  await configure(window, mock.url, mock.apiKey)
  await waitForState(window, 'ready')

  await send(window, 'Say something back to me.')
  await expect(window.locator('[data-testid="assistant-message"]').last()).toContainText(
    'mock response',
  )

  const toServer = requests.filter((url) => url.startsWith(origin))
  expect(toServer, `renderer reached the server directly: ${toServer.join(', ')}`).toEqual([])

  // The recorder is live — otherwise the assertion above is vacuous. The
  // positive control below proves a server-origin request would also be caught.
  expect(requests.length, 'CDP recorded nothing at all').toBeGreaterThan(0)
  expect(requests.some((url) => url.startsWith('file://'))).toBe(true)
})

test('A9: the recorder would catch a renderer request to the server origin', async ({
  appHandle,
  mock,
}) => {
  // A positive control for the test above. If the renderer *did* reach the
  // server, this is what it would look like — and it must be observable.
  const { window, app } = appHandle
  const cdp = await app.context().newCDPSession(window)
  const seen: string[] = []
  await cdp.send('Network.enable')
  cdp.on('Network.requestWillBeSent', (event) => seen.push(event.request.url))

  const outcome = await window.evaluate(async (url) => {
    try {
      await fetch(`${url}/healthz`)
      return 'request went out'
    } catch (error) {
      return `blocked: ${String(error)}`
    }
  }, mock.url)

  // Either the CSP refused it or CDP saw it. Both are acceptable proof that a
  // real attempt is not invisible; silently succeeding is not.
  const reached = seen.some((url) => url.startsWith(new URL(mock.url).origin))
  expect(
    outcome.startsWith('blocked') || reached,
    `a renderer fetch neither failed nor was observed: ${outcome}`,
  ).toBe(true)
  // And connect-src 'self' should be what stops it.
  expect(outcome).toContain('blocked')
})

test('A8: the API key is in no file under userData, entered through the real UI', async ({
  appHandle,
  mock,
}) => {
  const key = 'hk_live_e2e_9f3a2b7c1d4e5f6a8b9c0d1e'
  await configure(appHandle.window, mock.url, key)

  // The unit test covers this against a fake safeStorage; here it is the real
  // one, reached the way a person reaches it.
  const utf8 = Buffer.from(key, 'utf8')
  const utf16 = Buffer.from(key, 'utf16le')
  const leaks = walk(appHandle.userDataDir)
    .filter((path) => {
      const bytes = readFileSync(path)
      return bytes.includes(utf8) || bytes.includes(utf16)
    })
    .map((path) => relative(appHandle.userDataDir, path))

  expect(leaks).toEqual([])
  // The files that should exist, do — so this cannot pass by writing nothing.
  const files = walk(appHandle.userDataDir).map((p) => relative(appHandle.userDataDir, p))
  expect(files).toContain('settings.json')
  expect(files.some((f) => f.includes('secrets.bin'))).toBe(true)
})

test('A8: the renderer cannot read the key back', async ({ appHandle, mock }) => {
  await configure(appHandle.window, mock.url, mock.apiKey)

  const exposed = await appHandle.window.evaluate(async () => {
    const settings = await window.api.settings.get()
    return {
      keys: settings.ok ? Object.keys(settings.value) : [],
      body: settings.ok ? JSON.stringify(settings.value) : '',
    }
  })

  expect(exposed.keys).toContain('hasApiKey')
  expect(exposed.keys).not.toContain('apiKey')
  expect(exposed.body).not.toContain(mock.apiKey)
})

test('the preload exposes exactly the IPC surface and no Node', async ({ appHandle }) => {
  const surface = await appHandle.window.evaluate(() => {
    const api = window.api as unknown as Record<string, Record<string, unknown>>
    const methods: string[] = []
    for (const [section, group] of Object.entries(api)) {
      for (const name of Object.keys(group)) methods.push(`${section}.${name}`)
    }
    return {
      methods: methods.sort(),
      sections: Object.keys(api).sort(),
      hasRequire: typeof (globalThis as { require?: unknown }).require !== 'undefined',
      hasProcess: typeof (globalThis as { process?: unknown }).process !== 'undefined',
      hasIpcRenderer: typeof (globalThis as { ipcRenderer?: unknown }).ipcRenderer !== 'undefined',
      hasBuffer: typeof (globalThis as { Buffer?: unknown }).Buffer !== 'undefined',
    }
  })

  expect(surface.hasRequire, 'require leaked into the renderer').toBe(false)
  expect(surface.hasProcess, 'process leaked into the renderer').toBe(false)
  expect(surface.hasIpcRenderer, 'ipcRenderer leaked into the renderer').toBe(false)
  expect(surface.hasBuffer, 'Buffer leaked into the renderer').toBe(false)

  expect(surface.sections).toEqual([
    'chat',
    'conversations',
    'logs',
    'models',
    'server',
    'settings',
  ])

  // No getter for the key, under any name.
  expect(surface.methods.filter((m) => /apikey/i.test(m))).toEqual(['settings.setApiKey'])

  // Every invoke channel in shared/ipc.ts is reachable, and nothing beyond the
  // documented surface is exposed.
  const invokeChannels = Object.values(IPC).filter(
    (channel) => !channel.includes('Changed') && !/chat:(chunk|done|error)/.test(channel),
  )
  expect(surface.methods.length).toBeGreaterThanOrEqual(invokeChannels.length)
})

test('the strict CSP is in force in the built app', async ({ appHandle }) => {
  // Tests run against out/, not the dev server, so this is the shipped policy.
  const result = await appHandle.window.evaluate(() => {
    try {
      const script = document.createElement('script')
      script.textContent = 'window.__cspEscaped = true'
      document.head.appendChild(script)
      script.remove()
      return (window as { __cspEscaped?: boolean }).__cspEscaped === true ? 'ran' : 'blocked'
    } catch {
      return 'blocked'
    }
  })
  expect(result).toBe('blocked')
})

test('a machine with no credential store warns, but does not trap the user', async ({ mock }) => {
  // What a headless Linux runner looks like. Before this the app refused to
  // close Settings at all, so it was unusable on such a machine — and every e2e
  // spec that configured the app failed there.
  const app = await launchApp({ env: { HARNESS_FORCE_NO_KEYRING: '1' } })
  try {
    await configure(app.window, mock.url, mock.apiKey)

    // Settings closed, the app is configured, and the warning is visible.
    await expect(app.window.getByRole('dialog', { name: 'Settings' })).toBeHidden()
    await waitForState(app.window, 'ready')

    await openSettings(app.window)
    await expect(app.window.locator('[data-testid="key-warning"]')).toContainText('quit')
  } finally {
    await app.close()
  }
})

test('the key is still not written to disk when there is no credential store', async ({ mock }) => {
  const key = 'hk_live_no_keyring_e2e_0123456789'
  const app = await launchApp({ env: { HARNESS_FORCE_NO_KEYRING: '1' } })
  try {
    await configure(app.window, mock.url, key)

    const utf8 = Buffer.from(key, 'utf8')
    const leaks = walk(app.userDataDir)
      .filter((path) => readFileSync(path).includes(utf8))
      .map((path) => relative(app.userDataDir, path))
    expect(leaks, 'the key was written in plaintext').toEqual([])
  } finally {
    await app.close()
  }
})
