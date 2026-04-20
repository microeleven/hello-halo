/**
 * IPC handlers for model capability queries.
 *
 * Channels (all request/response via ipcMain.handle):
 *   model-capabilities:resolve   — resolve final capability (preset + user overrides)
 *   model-capabilities:preset    — get raw preset for a single model
 *   model-capabilities:all       — get all presets (for UI browsing)
 */

import { ipcMain } from 'electron'
import { modelCapabilitiesService } from '../services/model-capabilities.service'
import type { ModelCapabilityOverride } from '../../shared/types/model-capabilities'

export function registerModelCapabilitiesHandlers(): void {
  /**
   * Resolve the effective capability of a model.
   * Merges preset data with the caller-supplied user overrides.
   *
   * Args: modelId: string, overrides?: Record<string, ModelCapabilityOverride>
   */
  ipcMain.handle(
    'model-capabilities:resolve',
    (_event, modelId: string, overrides?: Record<string, ModelCapabilityOverride>) => {
      try {
        return {
          success: true,
          data: modelCapabilitiesService.resolve(modelId, overrides)
        }
      } catch (error) {
        console.error('[ModelCapabilities] resolve error:', error)
        return { success: false, error: String(error) }
      }
    }
  )

  /**
   * Return the raw preset for a single model (no user overrides applied).
   * Returns null when no preset entry exists.
   *
   * Args: modelId: string
   */
  ipcMain.handle('model-capabilities:preset', (_event, modelId: string) => {
    try {
      return {
        success: true,
        data: modelCapabilitiesService.getPreset(modelId)
      }
    } catch (error) {
      console.error('[ModelCapabilities] preset error:', error)
      return { success: false, error: String(error) }
    }
  })

  /**
   * Return all preset entries as a flat map (modelId → ModelCapability).
   * Used by the UI to browse known models.
   */
  ipcMain.handle('model-capabilities:all', () => {
    try {
      return {
        success: true,
        data: modelCapabilitiesService.getAllPresets()
      }
    } catch (error) {
      console.error('[ModelCapabilities] all error:', error)
      return { success: false, error: String(error) }
    }
  })

  console.log('[ModelCapabilities] IPC handlers registered')
}
