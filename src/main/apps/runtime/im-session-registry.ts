/**
 * apps/runtime -- IM Session Registry
 *
 * Manages all known IM channel sessions across digital humans (Apps).
 * Sessions are automatically registered when a user messages the bot,
 * and the `proactive` flag is toggled by the user in Halo's settings UI.
 *
 * Persistence: JSON file on disk, loaded at startup, written on every mutation.
 * Data volume is small (a few to tens of sessions per app), so full-file
 * writes are acceptable.
 *
 * Thread safety: All mutations are synchronous (single Node.js event loop),
 * but disk writes are fire-and-forget async to avoid blocking.
 */

import { readFileSync, writeFile, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { ImSessionRecord } from '../../../shared/types/im-channel'

// ============================================
// Types
// ============================================

/** Composite key for session lookup */
type SessionKey = string

// ============================================
// Registry Implementation
// ============================================

export class ImSessionRegistry {
  /** In-memory session store, keyed by "{appId}:{channel}:{chatId}" */
  private sessions = new Map<SessionKey, ImSessionRecord>()

  /** File path for JSON persistence */
  private filePath: string

  /** Whether a write is currently pending (coalesce rapid mutations) */
  private writePending = false

  constructor(filePath: string) {
    this.filePath = filePath
    this.load()
  }

  // ── Core Operations ──────────────────────────────────

  /**
   * Register or update a session.
   *
   * Called by dispatch-inbound after routing succeeds. Idempotent:
   * - New session: creates with proactive=false, sets displayName once
   * - Existing session: updates lastActiveAt, lastSender, lastMessage only
   *   (never overwrites displayName or customName)
   */
  register(
    appId: string,
    channel: string,
    chatId: string,
    chatType: 'direct' | 'group',
    instanceId: string,
    opts?: { displayName?: string; lastSender?: string; lastMessage?: string }
  ): void {
    const key = this.buildKey(appId, channel, chatId)
    const existing = this.sessions.get(key)

    if (existing) {
      // displayName is intentionally NOT updated — stable after first registration
      existing.lastActiveAt = Date.now()
      existing.instanceId = instanceId // Always update to latest instance
      if (opts?.lastSender !== undefined) existing.lastSender = opts.lastSender
      if (opts?.lastMessage !== undefined) existing.lastMessage = opts.lastMessage.slice(0, 50)
    } else {
      this.sessions.set(key, {
        appId,
        channel,
        instanceId,
        chatId,
        chatType,
        displayName: opts?.displayName || chatId,
        proactive: false,
        lastActiveAt: Date.now(),
        lastSender: opts?.lastSender,
        lastMessage: opts?.lastMessage?.slice(0, 50),
      })
    }

    this.schedulePersist()
  }

  /**
   * Set a user-defined custom name for a session.
   * customName has the highest display priority in the UI.
   *
   * @returns true if the session was found and updated
   */
  setCustomName(appId: string, channel: string, chatId: string, name: string): boolean {
    const key = this.buildKey(appId, channel, chatId)
    const session = this.sessions.get(key)
    if (!session) return false

    session.customName = name || undefined // empty string clears it
    this.schedulePersist()
    return true
  }

  /**
   * Set the proactive flag for a session.
   *
   * @deprecated Proactive push is replaced by AI-driven `notify_bot` tool.
   * The `proactive` field on ImSessionRecord is deprecated and no longer
   * toggled by the UI. This method is retained only for backward compatibility
   * with persisted data; it should not be called from new code.
   *
   * @returns true if the session was found and updated
   */
  setProactive(appId: string, channel: string, chatId: string, proactive: boolean): boolean {
    const key = this.buildKey(appId, channel, chatId)
    const session = this.sessions.get(key)
    if (!session) return false

    session.proactive = proactive
    this.schedulePersist()
    return true
  }

  /**
   * Get all sessions with proactive=true for a given app.
   *
   * @deprecated Proactive push is replaced by AI-driven `notify_bot` tool.
   * Since `proactive` is always false for new sessions and the UI toggle has
   * been removed, this method always returns an empty array. Callers should
   * use `getAllSessions()` instead to get the full contact list for notify_bot.
   */
  getProactiveSessions(appId: string): ImSessionRecord[] {
    const result: ImSessionRecord[] = []
    for (const session of this.sessions.values()) {
      if (session.appId === appId && session.proactive) {
        result.push({ ...session })
      }
    }
    return result
  }

  /**
   * Get all known sessions for a given app.
   * Used by the settings UI to display the session list.
   */
  getAllSessions(appId: string): ImSessionRecord[] {
    const result: ImSessionRecord[] = []
    for (const session of this.sessions.values()) {
      if (session.appId === appId) {
        result.push({ ...session })
      }
    }
    // Sort by lastActiveAt descending (most recent first)
    result.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    return result
  }

  /**
   * Get ALL sessions across all apps.
   * Used by the global settings UI to display a complete session overview.
   */
  listAll(): ImSessionRecord[] {
    const result = Array.from(this.sessions.values()).map(s => ({ ...s }))
    result.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    return result
  }

  /**
   * Remove a session from the registry.
   * Optional cleanup operation for the settings UI.
   *
   * @returns true if the session was found and removed
   */
  removeSession(appId: string, channel: string, chatId: string): boolean {
    const key = this.buildKey(appId, channel, chatId)
    const deleted = this.sessions.delete(key)
    if (deleted) {
      this.schedulePersist()
    }
    return deleted
  }

  /**
   * Remove all sessions for a given app.
   * Called when an app is deleted.
   */
  removeAllForApp(appId: string): number {
    let count = 0
    for (const [key, session] of this.sessions) {
      if (session.appId === appId) {
        this.sessions.delete(key)
        count++
      }
    }
    if (count > 0) {
      this.schedulePersist()
    }
    return count
  }

  // ── Persistence ──────────────────────────────────────

  private buildKey(appId: string, channel: string, chatId: string): SessionKey {
    return `${appId}:${channel}:${chatId}`
  }

  /** Load sessions from disk. Silent on missing/corrupt file. */
  private load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const records: ImSessionRecord[] = JSON.parse(raw)
      if (!Array.isArray(records)) return

      for (const r of records) {
        if (r.appId && r.channel && r.chatId) {
          // Backward compat: old sessions may lack instanceId
          if (!r.instanceId) {
            r.instanceId = ''
          }
          const key = this.buildKey(r.appId, r.channel, r.chatId)
          this.sessions.set(key, r)
        }
      }
      console.log(`[ImSessionRegistry] Loaded ${this.sessions.size} sessions from disk`)
    } catch {
      // File doesn't exist or is corrupt — start fresh
      console.log('[ImSessionRegistry] No existing sessions file, starting fresh')
    }
  }

  /**
   * Schedule an async write to disk.
   * Coalesces rapid mutations into a single write via microtask.
   */
  private schedulePersist(): void {
    if (this.writePending) return
    this.writePending = true

    queueMicrotask(() => {
      this.writePending = false
      this.persist()
    })
  }

  /** Write all sessions to disk (fire-and-forget). */
  private persist(): void {
    const records = Array.from(this.sessions.values())
    const json = JSON.stringify(records, null, 2)

    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
    } catch {
      // Directory likely already exists
    }

    writeFile(this.filePath, json, 'utf8', (err) => {
      if (err) {
        console.error('[ImSessionRegistry] Failed to persist sessions:', err)
      }
    })
  }
}

// ============================================
// Module-level Singleton
// ============================================

let registryInstance: ImSessionRegistry | null = null

/** Set the global registry instance. Called during runtime initialization. */
export function setImSessionRegistry(registry: ImSessionRegistry): void {
  registryInstance = registry
}

/** Get the global registry instance. Returns null before initialization. */
export function getImSessionRegistry(): ImSessionRegistry | null {
  return registryInstance
}
