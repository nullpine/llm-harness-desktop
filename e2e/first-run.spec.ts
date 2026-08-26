/**
 * First run and connection setup — SPEC §8.5 and acceptance **A1**.
 *
 * Verified by hand every milestone since M1. This is that check, automated.
 */

import {
  launchApp,
  expect,
  openSettings,
  test,
  testConnection,
  configure,
  waitForState,
} from './fixtures/app'
import { startMock } from './fixtures/mockServer'

test('A1: a fresh profile opens straight into Settings with the explainer', async ({
  appHandle,
}) => {
  const dialog = appHandle.window.getByRole('dialog', { name: 'Settings' })

  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Point this at your harness server')
  // Nothing to go back to, so first run offers no way out (SPEC §8.5).
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
})

test('A1: Test connection reports the contract version, and the header leaves unreachable', async ({
  appHandle,
  mock,
}) => {
  const { window } = appHandle
  await openSettings(window)

  await window.getByLabel('Server URL').fill(mock.url)
  await window.getByLabel('API key').fill(mock.apiKey)

  const outcome = await testConnection(window)
  expect(outcome).toContain('Connected')
  expect(outcome).toContain('contract v1.1')

  await window.getByRole('button', { name: 'Save' }).click()
  await waitForState(window, 'ready')
})

test('A1: an invalid URL blocks Save, and localhost is accepted', async ({ appHandle }) => {
  const { window } = appHandle
  await openSettings(window)
  const save = window.getByRole('button', { name: 'Save' })

  for (const bad of ['ftp://x', 'example.com', 'http://not-localhost.example.com']) {
    await window.getByLabel('Server URL').fill(bad)
    await expect(save, `"${bad}" must not be saveable`).toBeDisabled()
  }

  await window.getByLabel('Server URL').fill('http://localhost:8787')
  await expect(save).toBeEnabled()
})

test('A1: a wrong key surfaces unauthorized copy, not unreachable', async ({ appHandle, mock }) => {
  // An open question through M2: a 401 against a *healthy* server must not read
  // as "can't reach the server", which points the user at the wrong problem.
  const { window } = appHandle
  await openSettings(window)

  await window.getByLabel('Server URL').fill(mock.url)
  await window.getByLabel('API key').fill('definitely-the-wrong-key')

  const outcome = await testConnection(window)

  expect(outcome).not.toContain('Connected')
  expect(outcome.toLowerCase()).toMatch(/key|unauthor/)
  expect(outcome.toLowerCase()).not.toContain('reach the server')
})

test('A1: settings survive a restart', async () => {
  const mock = await startMock()
  const first = await launchApp()
  try {
    await configure(first.window, mock.url, mock.apiKey)
    await waitForState(first.window, 'ready')
  } finally {
    await first.close()
  }

  const second = await launchApp({ userDataDir: first.userDataDir })
  try {
    // No first-run modal this time: the URL is configured.
    await expect(second.window.getByRole('dialog', { name: 'Settings' })).toBeHidden()
    await waitForState(second.window, 'ready')
  } finally {
    await second.close()
    await mock.server.close()
  }
})
