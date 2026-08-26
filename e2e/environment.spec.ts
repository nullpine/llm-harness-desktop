/**
 * What this machine can actually do — reported, not asserted.
 *
 * `safeStorage` is the one genuinely platform-specific thing in the app, and
 * when it is unavailable a third of the suite fails in ways that look like
 * product bugs (they are not: the key cannot persist, so nothing survives a
 * restart). Working that out from a red CI run took two round trips, so the
 * facts now go in the log every time.
 *
 * This spec never fails. It is a diagnostic.
 */

import { launchApp, test } from './fixtures/app'

test('report the credential store this machine offers', async () => {
  const app = await launchApp()
  try {
    const report = await app.app.evaluate(({ safeStorage }) => ({
      available: safeStorage.isEncryptionAvailable(),
      // Linux only; undefined elsewhere. `basic_text` means Electron found no
      // keyring and would "encrypt" with a well-known key — which is why the
      // app treats availability, not the backend, as the thing to trust.
      backend:
        process.platform === 'linux' && 'getSelectedStorageBackend' in safeStorage
          ? safeStorage.getSelectedStorageBackend()
          : 'n/a',
      platform: process.platform,
    }))

    console.log(
      `\n  credential store: available=${report.available} backend=${report.backend} platform=${report.platform}\n` +
        (report.available
          ? '  → persistence-dependent specs (A7, restarts) will run normally\n'
          : '  → NO credential store: the key cannot persist, so restart specs will fail.\n' +
            '    On Linux CI this means the secret service did not come up.\n'),
    )
  } finally {
    await app.close()
  }
})
