/**
 * Types for the mock server, so `harnessClient.test.ts` can drive it under
 * `strict` without an `any` (CLAUDE.md rule 6).
 *
 * Hand-written rather than generated: the mock is deliberately plain `.mjs` so it
 * runs with `node scripts/dev-mock-server.mjs` and no build step.
 */

export declare const CONTRACT_VERSION: string
export declare const SERVICE_VERSION: string
export declare const DEFAULT_PORT: number
export declare const DEFAULT_API_KEY: string

export interface MockServerState {
  state: 'idle' | 'loading' | 'ready' | 'stopping' | 'error'
  activeModelId: string | null
  previousModelId: string | null
  since: string
  progressHint: string | null
  lastError: string | null
}

export interface MockServerOptions {
  /** How long a simulated activation takes. Keep it small in tests. */
  loadMs?: number
  tokenDelayMs?: number
  apiKey?: string
  activeModelId?: string
  /** What to end a stream with. `'length'` exercises the truncation note. */
  finishReason?: 'stop' | 'length' | 'content_filter'
  /** Stream reasoning only — a reasoning model that ran out of budget. */
  emptyContent?: boolean
  /** Make every activation end in `error`, for the failure banner and logs modal. */
  activationFails?: boolean
  /**
   * Accelerators for `/admin/state`. Empty by default — what Ollama produces.
   * A vLLM deployment populates it, so this covers that path in advance.
   */
  gpu?: GpuReading[]
  /** How many lines `/admin/logs` returns. Default 20; large values exercise scrolling. */
  logLines?: number
}

export interface GpuReading {
  index: number
  name: string
  memory_used_mb: number
  memory_total_mb: number
  utilization_pct: number
}

export interface MockServer {
  readonly apiKey: string
  readonly state: MockServerState
  /** Force a state, to exercise a guard without waiting on a timer. */
  setState(next: Partial<MockServerState>): void
  /** Make subsequent activations fail. */
  setActivationFails(value: boolean): void
  /** Change the reported accelerators mid-session. */
  setGpu(next: GpuReading[]): void
  listen(port?: number, host?: string): Promise<string>
  close(): Promise<void>
}

export declare function createMockServer(options?: MockServerOptions): MockServer
