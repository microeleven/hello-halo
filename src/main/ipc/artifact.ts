/**
 * Artifact IPC Handlers - Handle artifact-related requests from renderer
 *
 * PERFORMANCE OPTIMIZED:
 * - Uses async functions for non-blocking I/O
 * - Supports lazy loading for tree view
 * - Provides incremental updates via file watcher events
 */

import { ipcMain, shell } from 'electron'
import {
  listArtifacts,
  listArtifactsTree,
  loadTreeChildren,
  initArtifactWatcher,
  reconcileArtifacts,
  readArtifactContent,
  saveArtifactContent,
  detectFileType,
  createFile,
  createFolder,
  trashArtifact,
  renameArtifact,
  moveArtifact
} from '../services/artifact.service'

// Register all artifact handlers
export function registerArtifactHandlers(): void {
  // List artifacts in a space (flat list for card view)
  ipcMain.handle('artifact:list', async (_event, spaceId: string, maxDepth?: number) => {
    try {
      const artifacts = await listArtifacts(spaceId, maxDepth)
      return { success: true, data: artifacts }
    } catch (error) {
      console.error('[IPC] artifact:list error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // List artifacts as tree structure (for developer view)
  // Returns { workspaceRoot, nodes } so the frontend knows the authoritative root path
  ipcMain.handle('artifact:list-tree', async (_event, spaceId: string) => {
    try {
      const result = await listArtifactsTree(spaceId)
      return { success: true, data: result }
    } catch (error) {
      console.error('[IPC] artifact:list-tree error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Load children for lazy tree expansion
  ipcMain.handle('artifact:load-children', async (_event, spaceId: string, dirPath: string) => {
    try {
      console.log(`[IPC] artifact:load-children - spaceId: ${spaceId}, path: ${dirPath}`)
      const children = await loadTreeChildren(spaceId, dirPath)
      return { success: true, data: children }
    } catch (error) {
      console.error('[IPC] artifact:load-children error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Initialize file watcher for a space
  ipcMain.handle('artifact:init-watcher', async (_event, spaceId: string) => {
    try {
      console.log(`[IPC] artifact:init-watcher - spaceId: ${spaceId}`)
      await initArtifactWatcher(spaceId)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:init-watcher error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Reconcile artifact cache against filesystem (push + pull recovery)
  ipcMain.handle('artifact:reconcile', async (_event, spaceId: string) => {
    try {
      console.log(`[IPC] artifact:reconcile - spaceId: ${spaceId}`)
      await reconcileArtifacts(spaceId)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:reconcile error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Open file or folder with system default application
  ipcMain.handle('artifact:open', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:open - path: ${filePath}`)
      const error = await shell.openPath(filePath)
      if (error) {
        console.error('[IPC] artifact:open error:', error)
        return { success: false, error }
      }
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:open error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Show file in folder (highlight in file manager)
  ipcMain.handle('artifact:show-in-folder', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:show-in-folder - path: ${filePath}`)
      shell.showItemInFolder(filePath)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:show-in-folder error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Read file content for Content Canvas
  ipcMain.handle('artifact:read-content', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:read-content - path: ${filePath}`)
      const content = await readArtifactContent(filePath)
      return { success: true, data: content }
    } catch (error) {
      console.error('[IPC] artifact:read-content error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Save file content from Content Canvas (edit mode)
  ipcMain.handle('artifact:save-content', async (_event, filePath: string, content: string) => {
    try {
      console.log(`[IPC] artifact:save-content - path: ${filePath}`)
      await saveArtifactContent(filePath, content)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:save-content error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Detect file type for Canvas viewability
  ipcMain.handle('artifact:detect-file-type', async (_event, filePath: string) => {
    try {
      console.log(`[IPC] artifact:detect-file-type - path: ${filePath}`)
      const fileTypeInfo = await detectFileType(filePath)
      return { success: true, data: fileTypeInfo }
    } catch (error) {
      console.error('[IPC] artifact:detect-file-type error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // ===== File Operations (delegated to artifact.service with path validation) =====

  ipcMain.handle('artifact:create-file', async (_event, spaceId: string, parentPath: string, name: string, content: string = '') => {
    try {
      const resolvedPath = await createFile(spaceId, parentPath, name, content)
      return { success: true, data: { path: resolvedPath } }
    } catch (error) {
      console.error('[IPC] artifact:create-file error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('artifact:create-folder', async (_event, spaceId: string, parentPath: string, name: string) => {
    try {
      const resolvedPath = await createFolder(spaceId, parentPath, name)
      return { success: true, data: { path: resolvedPath } }
    } catch (error) {
      console.error('[IPC] artifact:create-folder error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('artifact:delete', async (_event, spaceId: string, targetPath: string) => {
    try {
      await trashArtifact(spaceId, targetPath)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:delete error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('artifact:rename', async (_event, spaceId: string, oldPath: string, newName: string) => {
    try {
      await renameArtifact(spaceId, oldPath, newName)
      return { success: true }
    } catch (error) {
      console.error('[IPC] artifact:rename error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('artifact:move', async (_event, spaceId: string, oldPath: string, newParentPath: string) => {
    try {
      const resolvedPath = await moveArtifact(spaceId, oldPath, newParentPath)
      return { success: true, data: { path: resolvedPath } }
    } catch (error) {
      console.error('[IPC] artifact:move error:', error)
      return { success: false, error: (error as Error).message }
    }
  })
}
