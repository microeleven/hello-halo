/**
 * IM Sessions IPC Handlers
 *
 * Provides session list and management for the Settings UI.
 * The registry is populated automatically by dispatch-inbound when
 * users message the bot; these handlers expose read, rename, and remove.
 *
 * Note: The `im-sessions:set-proactive` handler is deprecated.
 * Proactive push is replaced by AI-driven `notify_bot` tool.
 */

import { ipcMain } from 'electron'
import { getImSessionRegistry } from '../apps/runtime/im-session-registry'

export function registerImSessionHandlers(): void {
  // List IM sessions — if appId is provided, filter by app; otherwise return all
  ipcMain.handle('im-sessions:list', async (_event, appId?: string) => {
    try {
      const registry = getImSessionRegistry()
      if (!registry) {
        return { success: true, data: [] }
      }
      const sessions = appId ? registry.getAllSessions(appId) : registry.listAll()
      return { success: true, data: sessions }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  // @deprecated — Proactive push replaced by AI-driven notify_bot tool.
  // Retained for backward compatibility; no UI calls this handler anymore.
  ipcMain.handle(
    'im-sessions:set-proactive',
    async (_event, input: { appId: string; channel: string; chatId: string; proactive: boolean }) => {
      try {
        const registry = getImSessionRegistry()
        if (!registry) {
          return { success: false, error: 'IM session registry not initialized' }
        }
        const updated = registry.setProactive(input.appId, input.channel, input.chatId, input.proactive)
        if (!updated) {
          return { success: false, error: 'Session not found' }
        }
        return { success: true }
      } catch (error: unknown) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // Remove a session from the registry
  ipcMain.handle(
    'im-sessions:remove',
    async (_event, input: { appId: string; channel: string; chatId: string }) => {
      try {
        const registry = getImSessionRegistry()
        if (!registry) {
          return { success: false, error: 'IM session registry not initialized' }
        }
        const removed = registry.removeSession(input.appId, input.channel, input.chatId)
        return { success: true, data: { removed } }
      } catch (error: unknown) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  // Set a custom display name for a session
  ipcMain.handle(
    'im-sessions:set-custom-name',
    async (_event, input: { appId: string; channel: string; chatId: string; name: string }) => {
      try {
        const registry = getImSessionRegistry()
        if (!registry) {
          return { success: false, error: 'IM session registry not initialized' }
        }
        const updated = registry.setCustomName(input.appId, input.channel, input.chatId, input.name)
        if (!updated) {
          return { success: false, error: 'Session not found' }
        }
        return { success: true }
      } catch (error: unknown) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  console.log('[ImSessions] IPC handlers registered')
}
