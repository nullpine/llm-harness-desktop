/**
 * The mock harness server, started **in-process**.
 *
 * `scripts/dev-mock-server.mjs` already exports a factory, so there is no reason
 * to shell out: importing it means no orphaned child process when a test fails,
 * no port-file dance, and the ability to drive its state directly from a test
 * (`setState`) rather than through an HTTP back door it would otherwise need.
 *
 * Port 0 gets a free port from the OS, so tests never collide with a dev server
 * or with each other.
 */

import {
  createMockServer,
  type MockServer,
  type MockServerOptions,
} from '../../scripts/dev-mock-server.mjs'

export interface RunningMock {
  url: string
  apiKey: string
  server: MockServer
}

/**
 * A load slow enough that `loading` is observable but fast enough not to pad
 * every test by eight seconds.
 */
export const TEST_LOAD_MS = 600

/** A token gap that lets a test see a stream in progress without dragging. */
export const TEST_TOKEN_DELAY_MS = 25

export interface StartMockOptions extends MockServerOptions {
  /**
   * Bind a specific port. Only for the recovery tests, which need a server to
   * appear on a port the app is already failing to reach. Everything else uses
   * port 0 so tests cannot collide.
   */
  port?: number
}

export async function startMock(options: StartMockOptions = {}): Promise<RunningMock> {
  const { port = 0, ...mockOptions } = options
  const server = createMockServer({
    loadMs: TEST_LOAD_MS,
    tokenDelayMs: TEST_TOKEN_DELAY_MS,
    activeModelId: 'glm-4.7-flash',
    ...mockOptions,
  })
  const url = await server.listen(port, '127.0.0.1')
  return { url, apiKey: server.apiKey, server }
}
