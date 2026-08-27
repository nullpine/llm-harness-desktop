import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      // Unit tests must not depend on the Electron *binary* being installed —
      // see the header of test/electron-stub.ts.
      electron: resolve(import.meta.dirname, 'test/electron-stub.ts'),
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
})
