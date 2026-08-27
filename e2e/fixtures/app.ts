/**
 * The app under test: a real Electron process, a fresh profile, and helpers
 * that drive it the way a person would.
 *
 * Every test gets its own temp `userData` directory. That is what makes the
 * suite order-independent — no test can see another's conversations or key —
 * and it is why running these can never touch your real profile.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  _electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

import { startMock, type RunningMock } from './mockServer'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')

export interface LaunchOptions {
  /** Reuse an existing profile — for restart tests (A7). */
  userDataDir?: string
  /** Extra env for the main process. */
  env?: Record<string, string>
}

export interface AppHandle {
  app: ElectronApplication
  window: Page
  userDataDir: string
  close: () => Promise<void>
}

/**
 * Launch the built app.
 *
 * `--user-data-dir` rather than an env var because Electron reads it before any
 * of our code runs, so there is no window in which the real profile could be
 * touched.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<AppHandle> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'harness-e2e-'))

  const app = await _electron.launch({
    args: [join(REPO_ROOT, 'out', 'main', 'index.js'), `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: 'production', ...options.env } as Record<string, string>,
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  return {
    app,
    window,
    userDataDir,
    close: async () => {
      await app.close()
    },
  }
}

/** Open Settings from the title bar. */
export async function openSettings(window: Page): Promise<void> {
  const dialog = window.getByRole('dialog', { name: 'Settings' })
  if (await dialog.isVisible().catch(() => false)) return
  await window.getByRole('button', { name: 'Settings' }).click()
  await expect(dialog).toBeVisible()
}

/**
 * Type an API key into Settings.
 *
 * Once a key is set the field shows `••••` and a **Replace** button rather than
 * an input (SPEC §8.4) — the key is never readable, by design — so changing one
 * takes an extra click.
 */
export async function fillApiKey(window: Page, key: string): Promise<void> {
  // Wait for the modal before probing: `isVisible()` does not auto-wait, so on a
  // just-opened dialog it answers "no" and the Replace click gets skipped.
  await expect(window.getByRole('dialog', { name: 'Settings' })).toBeVisible()

  const input = window.locator('[data-testid="api-key"]')
  if ((await input.count()) === 0) {
    await window.getByRole('button', { name: 'Replace' }).click()
    await expect(input).toBeVisible()
  }
  await input.fill(key)
}

/** Fill in the server URL and key the way a person would, and save. */
export async function configure(window: Page, url: string, key: string): Promise<void> {
  await openSettings(window)
  await window.getByLabel('Server URL').fill(url)
  await fillApiKey(window, key)
  await window.getByRole('button', { name: 'Save' }).click()
  await expect(window.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

/** Press Test connection and return what the modal reports. */
export async function testConnection(window: Page): Promise<string> {
  await window.getByRole('button', { name: 'Test connection' }).click()
  const outcome = window.locator('[data-testid="test-outcome"]')
  await expect(outcome).toBeVisible()
  return (await outcome.innerText()).trim()
}

/**
 * Start a conversation, the way a person does.
 *
 * The composer is disabled until one exists — it says "Start a new chat to send
 * a message" — so this is a real prerequisite, not test scaffolding.
 */
export async function newChat(window: Page): Promise<void> {
  await window.getByRole('button', { name: '+ New chat' }).click()
  await expect(window.getByRole('textbox', { name: 'Message' })).toBeEnabled()
}

/**
 * Type into the composer and send.
 *
 * Starts a conversation only when there genuinely is not one — the composer is
 * also disabled while a model loads, and clicking "+ New chat" then would
 * silently start a *second* conversation and lose the transcript under test.
 */
export async function send(window: Page, text: string): Promise<void> {
  const composer = window.getByRole('textbox', { name: 'Message' })
  const reason = window.locator('[data-testid="composer-disabled"]')

  if (await reason.isVisible().catch(() => false)) {
    const explanation = (await reason.innerText()).toLowerCase()
    if (explanation.includes('new chat')) await newChat(window)
  }

  // Whatever the reason was, wait it out rather than typing into a dead box.
  await expect(composer).toBeEnabled()
  await composer.fill(text)
  await composer.press('Enter')
}

/** Select a conversation from the sidebar by its title. */
export async function openConversation(window: Page, title: string | RegExp): Promise<void> {
  // The row also carries rename and delete buttons whose accessible names
  // contain the title, so match the select button specifically.
  await window.locator('[data-testid="conversation-select"]', { hasText: title }).first().click()
}

/** Wait for the header pill to report a state. */
export async function waitForState(window: Page, state: string, timeout = 30_000): Promise<void> {
  await expect(window.locator('[data-testid="model-status"]')).toHaveText(new RegExp(state), {
    timeout,
  })
}

/**
 * SPEC §9: after three consecutive failures the poller backs off to 60 s. So
 * recovery from `unreachable` is *specified* to take up to a minute when nothing
 * else prompts a poll.
 */
export const UNREACHABLE_RECOVERY_MS = 90_000

interface Fixtures {
  mock: RunningMock
  appHandle: AppHandle
  /** A launched app already pointed at the mock and ready to chat. */
  configuredApp: AppHandle
}

export const test = base.extend<Fixtures>({
  mock: async ({}, use) => {
    const running = await startMock()
    await use(running)
    await running.server.close()
  },

  appHandle: async ({}, use) => {
    const handle = await launchApp()
    await use(handle)
    await handle.close()
    rmSync(handle.userDataDir, { recursive: true, force: true })
  },

  configuredApp: async ({ mock }, use) => {
    const handle = await launchApp()
    await configure(handle.window, mock.url, mock.apiKey)
    await waitForState(handle.window, 'ready')
    await use(handle)
    await handle.close()
    rmSync(handle.userDataDir, { recursive: true, force: true })
  },
})

export { expect } from '@playwright/test'
