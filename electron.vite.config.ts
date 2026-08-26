import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// `src/shared` is imported by all three targets, so every one of them gets the alias.
const shared = resolve(import.meta.dirname, 'src/shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      lib: { entry: resolve(import.meta.dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      lib: { entry: resolve(import.meta.dirname, 'src/preload/index.ts') },
      rollupOptions: {
        // A sandboxed preload cannot be ESM. Because package.json says
        // "type": "module", electron-vite would otherwise emit index.mjs and
        // Electron would fail it with "Cannot use import statement outside a
        // module" — leaving `window.api` undefined and the window blank, with
        // the error visible only in the renderer console.
        //
        // The fix is the module format, never `sandbox: false`
        // (`.claude/rules/network-boundary.md`).
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/renderer/index.html'),
      },
    },
  },
})
