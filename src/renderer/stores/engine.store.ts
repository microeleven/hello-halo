/**
 * Engine Capabilities Store
 *
 * Caches the active agent engine's capability descriptor so any UI component
 * can branch on flags without a per-render IPC call. Capabilities only change
 * when the user switches engines AND restarts (engine selection is process-
 * bound; see resolved-sdk.ts), so a single load on bootstrap is sufficient
 * for the lifetime of the renderer.
 *
 * Renderer code MUST NOT branch on `engineId` directly — branch on
 * capability flags. The badge component is the only allowed reader of the
 * raw engine string.
 */

import { create } from 'zustand'
import { api } from '../api'
import type { EngineCapabilities, EngineId } from '../types'

interface EngineStoreState {
  capabilities: EngineCapabilities | null
  loading: boolean
  load: () => Promise<void>
  /** Force a reload — used after Settings → engine switch + restart. */
  reload: () => Promise<void>
}

export const useEngineStore = create<EngineStoreState>((set, get) => ({
  capabilities: null,
  loading: false,
  load: async () => {
    if (get().capabilities || get().loading) return
    set({ loading: true })
    try {
      const result = await api.getEngineCapabilities()
      if (result?.success && result.data) {
        set({ capabilities: result.data as EngineCapabilities, loading: false })
      } else {
        set({ loading: false })
        console.warn('[engine.store] Failed to load engine capabilities:', result?.error)
      }
    } catch (err) {
      set({ loading: false })
      console.warn('[engine.store] getEngineCapabilities threw:', err)
    }
  },
  reload: async () => {
    set({ capabilities: null, loading: false })
    await get().load()
  },
}))

/**
 * Hook returning the current engine capabilities, loading them on first use.
 * Returns `null` while loading (callers must guard or use a loading
 * sentinel — typically by rendering a neutral fallback).
 *
 * Components should treat `null` as "use CC defaults" rather than blocking
 * UI: every flag has a CC-shaped fallback and missing capabilities should
 * never break rendering.
 */
export function useEngineCapabilities(): EngineCapabilities | null {
  const caps = useEngineStore((s) => s.capabilities)
  const load = useEngineStore((s) => s.load)
  if (!caps) {
    void load()
  }
  return caps
}

/** Read the engine id directly. Allowed only by EngineBadge / settings UI. */
export function useEngineId(): EngineId | null {
  const caps = useEngineCapabilities()
  return caps?.engineId ?? null
}
