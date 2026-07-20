/**
 * Memory IPC — renderer-facing read/clear of what Halo has learned about the
 * user (the global user-memory.md). Read-only surface for transparency ("what
 * do you know about me?") plus a clear action, so the user stays in control.
 *
 * user-memory is global (not space-scoped), so this reads the file directly
 * rather than going through the scope/permission-aware MemoryService.
 */

import { ipcMain } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getHaloDir } from '../foundation/config.service'

function userMemoryPath(): string {
  return join(getHaloDir(), 'user-memory.md')
}

/** The learned "about you" lines, without the append metadata comments. */
function readUserMemoryAtoms(): string[] {
  const path = userMemoryPath()
  if (!existsSync(path)) return []
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('- '))
      .map(l => l.slice(2).trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function registerMemoryHandlers(): void {
  ipcMain.handle('memory:get-user', async () => {
    return { success: true, data: readUserMemoryAtoms() }
  })

  ipcMain.handle('memory:clear-user', async () => {
    try {
      writeFileSync(userMemoryPath(), '', 'utf-8')
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  console.log('[Memory] User-memory IPC handlers registered')
}
