/**
 * IM Channels IPC Handlers
 *
 * Multi-instance IM channel management for the Settings UI.
 * Provides status queries, reconnect, and config reload for all IM channel instances.
 */

import { ipcMain } from 'electron'
import { getImChannelManager } from '../apps/runtime'
import { getConfig } from '../services/config.service'
import { dispatchInboundMessage, invalidateImSessions } from '../apps/runtime'
import { getImChannelsPermissionDefaults } from '../services/ai-sources/auth-loader'
import type { ImChannelInstanceStatus } from '../../shared/types/im-channel'

export function registerImChannelHandlers(): void {
  // Get status of all IM channel instances
  ipcMain.handle('im-channels:status', async (): Promise<{ success: boolean; data?: ImChannelInstanceStatus[]; error?: string }> => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: true, data: [] }
      }
      return { success: true, data: manager.getAllStatuses() }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Get status of a specific instance
  ipcMain.handle('im-channels:instance-status', async (_event, instanceId: string) => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: false, error: 'ImChannelManager not initialized' }
      }
      const status = manager.getInstanceStatus(instanceId)
      if (!status) {
        return { success: false, error: `Instance "${instanceId}" not found` }
      }
      return { success: true, data: status }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Reconnect a specific instance
  ipcMain.handle('im-channels:reconnect', async (_event, instanceId: string) => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: false, error: 'ImChannelManager not initialized' }
      }
      const ok = manager.reconnectInstance(instanceId)
      if (!ok) {
        return { success: false, error: `Instance "${instanceId}" not found or not running` }
      }
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Reload all instances from current config (called after saving settings)
  ipcMain.handle('im-channels:reload', async () => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: false, error: 'ImChannelManager not initialized' }
      }
      const config = getConfig()
      const instances = config.imChannels?.instances ?? []
      manager.applyConfig(instances, (instanceId, appId, msg, reply) => {
        dispatchInboundMessage(msg, reply, appId, instanceId)
      })
      // Invalidate existing IM sessions so permission/config changes take effect
      // on the next inbound message without requiring a manual /halo-clear.
      invalidateImSessions()
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Get available provider types and their config field definitions
  ipcMain.handle('im-channels:providers', async () => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: true, data: [] }
      }
      const providers = manager.getAllProviders().map(p => ({
        type: p.type,
        displayName: p.displayName,
        description: p.description,
        direction: p.direction,
        configFields: p.configFields,
        defaultConfig: p.defaultConfig,
      }))
      return { success: true, data: providers }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // Get product-level permission defaults for new instance initialization
  ipcMain.handle('im-channels:permission-defaults', async () => {
    try {
      const defaults = getImChannelsPermissionDefaults()
      return { success: true, data: defaults ?? null }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  console.log('[ImChannels] IPC handlers registered')
}
