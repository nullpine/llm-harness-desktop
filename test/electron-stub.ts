/**
 * `electron` for unit tests.
 *
 * Importing the real package runs `node_modules/electron/index.js`, which reads
 * `path.txt` and **throws** if the binary download did not complete — so a pure
 * string test like `contentSecurityPolicy` could fail because of a network race
 * during `npm ci`, which is exactly what happened during the v0.1.0 release run:
 *
 *     FAIL src/main/__tests__/buildRequestBody.test.ts
 *     Error: Electron failed to install correctly.
 *
 * Nothing under `src/**\/__tests__` needs the runtime. Tests that need behaviour
 * from a member (`ipcMain.handle`, `safeStorage`) still `vi.mock('electron', …)`
 * for themselves; this only has to make the import resolve.
 *
 * Deliberately inert rather than clever: a test that reaches a real Electron API
 * by accident should fail loudly on `undefined`, not quietly get a fake.
 */

const notStubbed =
  (name: string) =>
  (...args: unknown[]): never => {
    void args
    throw new Error(
      `electron.${name} was called in a unit test. Either mock it with ` +
        `vi.mock('electron', …) or move the assertion to an e2e spec.`,
    )
  }

export const app = {
  getVersion: () => '0.0.0-test',
  getPath: notStubbed('app.getPath'),
  on: () => undefined,
  quit: notStubbed('app.quit'),
  exit: notStubbed('app.exit'),
  isPackaged: false,
}

export const ipcMain = { handle: () => undefined, on: () => undefined }
export const ipcRenderer = { invoke: notStubbed('ipcRenderer.invoke'), on: () => undefined }
export const contextBridge = { exposeInMainWorld: () => undefined }
export const shell = { openExternal: notStubbed('shell.openExternal') }
export const session = { defaultSession: undefined }
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: notStubbed('safeStorage.encryptString'),
  decryptString: notStubbed('safeStorage.decryptString'),
}
export class BrowserWindow {
  constructor() {
    throw new Error('BrowserWindow was constructed in a unit test; use an e2e spec')
  }
}

export default {
  app,
  ipcMain,
  ipcRenderer,
  contextBridge,
  shell,
  session,
  safeStorage,
  BrowserWindow,
}
