/**
 * Server state, pushed from the main process.
 *
 * The renderer never polls (SPEC §9) — it renders whatever the last
 * `models:stateChanged` said. `initialise()` asks once at startup so the first
 * paint is not "unreachable" while waiting for the first tick.
 */

import { create } from 'zustand'

import type { ServerState } from '@shared/types'

const UNKNOWN: ServerState = {
  reachable: false,
  state: 'unreachable',
  activeModelId: null,
  progressHint: null,
  lastError: null,
  gpu: [],
}

interface ServerStoreState {
  server: ServerState
  /** False until the first answer, so the UI can avoid flashing an error. */
  known: boolean
  setServer: (state: ServerState) => void
  initialise: () => Promise<void>
}

export const useServerStore = create<ServerStoreState>((set) => ({
  server: UNKNOWN,
  known: false,

  setServer: (server) => set({ server, known: true }),

  initialise: async () => {
    const result = await window.api.models.state()
    if (result.ok) set({ server: result.value, known: true })
    else set({ known: true })
  },
}))

/** Can a message be sent right now? Everything else disables the composer. */
export function canSend(server: ServerState): boolean {
  return server.state === 'ready' && server.activeModelId !== null
}
