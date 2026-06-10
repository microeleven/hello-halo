/**
 * Tlon IPC Handlers — knowledge base management.
 *
 * All channels delegate to tlon.controller (shared with HTTP routes).
 * The file picker (tlon:pick-files) opens the OS dialog here in the handler.
 */

import { ipcMain, dialog } from 'electron'
import * as tlonController from '../controllers/tlon.controller'
import type { CreateKBInput, UpdateKBInput } from '../../shared/types/tlon'

export function registerTlonHandlers(): void {
  ipcMain.handle('tlon:create', async (_event, input: CreateKBInput) => {
    return tlonController.createKB(input)
  })

  ipcMain.handle('tlon:list', async () => {
    return tlonController.listKBs()
  })

  ipcMain.handle('tlon:list-for-space', async (_event, spaceId: string) => {
    return tlonController.listKBsForSpace(spaceId)
  })

  ipcMain.handle('tlon:get', async (_event, kbId: string) => {
    return tlonController.getKB(kbId)
  })

  ipcMain.handle('tlon:update', async (_event, kbId: string, updates: UpdateKBInput) => {
    return tlonController.updateKB(kbId, updates)
  })

  ipcMain.handle('tlon:delete', async (_event, kbId: string) => {
    return tlonController.deleteKB(kbId)
  })

  ipcMain.handle('tlon:set-default', async (_event, kbId: string | null) => {
    return tlonController.setDefaultKB(kbId)
  })

  ipcMain.handle('tlon:bind-space', async (_event, kbId: string, spaceId: string) => {
    return tlonController.bindToSpace(kbId, spaceId)
  })

  ipcMain.handle('tlon:unbind-space', async (_event, kbId: string, spaceId: string) => {
    return tlonController.unbindFromSpace(kbId, spaceId)
  })

  ipcMain.handle('tlon:bind-app', async (_event, kbId: string, appId: string) => {
    return tlonController.bindToApp(kbId, appId)
  })

  ipcMain.handle('tlon:unbind-app', async (_event, kbId: string, appId: string) => {
    return tlonController.unbindFromApp(kbId, appId)
  })

  ipcMain.handle(
    'tlon:add-linked-dir',
    async (_event, kbId: string, dir: { path: string; label: string }) => {
      return tlonController.addLinkedDir(kbId, dir)
    }
  )

  ipcMain.handle('tlon:remove-linked-dir', async (_event, kbId: string, linkId: string) => {
    return tlonController.removeLinkedDir(kbId, linkId)
  })

  ipcMain.handle('tlon:add-files', async (_event, kbId: string, filePaths: string[]) => {
    return tlonController.addRawFiles(kbId, filePaths)
  })

  ipcMain.handle('tlon:list-raw', async (_event, kbId: string) => {
    return tlonController.listRawFiles(kbId)
  })

  ipcMain.handle('tlon:remove-raw', async (_event, kbId: string, relativePath: string) => {
    return tlonController.removeRawFile(kbId, relativePath)
  })

  ipcMain.handle('tlon:list-wiki', async (_event, kbId: string) => {
    return tlonController.listWikiPages(kbId)
  })

  ipcMain.handle('tlon:read-wiki', async (_event, kbId: string, pagePath: string) => {
    return tlonController.readWikiPage(kbId, pagePath)
  })

  ipcMain.handle('tlon:read-index', async (_event, kbId: string) => {
    return tlonController.readIndexMd(kbId)
  })

  ipcMain.handle('tlon:trigger-ingest', async (_event, kbId: string) => {
    return tlonController.triggerIngest(kbId)
  })

  ipcMain.handle('tlon:get-ingest-status', async (_event, kbId: string) => {
    return tlonController.getIngestStatus(kbId)
  })

  // File picker — must open the OS dialog here so the renderer never accesses
  // the local filesystem directly. Text files only.
  ipcMain.handle('tlon:pick-files', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Add files to knowledge base',
        properties: ['openFile', 'multiSelections'],
        buttonLabel: 'Add',
      })
      return { success: true, data: { filePaths: result.filePaths, canceled: result.canceled } }
    } catch (error: unknown) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(
    'tlon:pick-folder',
    async (_event, options?: { title?: string; buttonLabel?: string }) => {
      try {
        const result = await dialog.showOpenDialog({
          title: options?.title || 'Link a folder to watch',
          properties: ['openDirectory'],
          buttonLabel: options?.buttonLabel || 'Link',
        })
        return { success: true, data: { filePaths: result.filePaths, canceled: result.canceled } }
      } catch (error: unknown) {
        return { success: false, error: (error as Error).message }
      }
    }
  )
}
