import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(import.meta.dirname, 'src/shared') },
  },
  test: {
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    // M0 only: the scaffolded test files are empty placeholders. Drop this in M1
    // when the first real tests land, so an empty suite fails again.
    passWithNoTests: true,
  },
})
