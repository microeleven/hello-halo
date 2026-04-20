/**
 * apps/runtime -- IM Permission Registry
 *
 * Session-scoped registry that maps conversationId → sender permission context.
 *
 * Architecture:
 *   dispatch-inbound.ts  → set()   (writes sender identity + resolved policy)
 *   permission-handler.ts → get()  (reads context for canUseTool interception)
 *   app-chat.ts (clear)   → clear() (cleans up on session reset)
 *
 * This registry decouples the IM identity/permission context from the generic
 * AppChatRequest and CanUseToolDeps interfaces. Only IM-originated sessions
 * have entries here; native Halo chat and automation runs are unaffected.
 *
 * Lifecycle:
 *   - Entry is set (or overwritten) on every inbound IM message dispatch.
 *     This ensures the context always reflects the LATEST message sender
 *     (critical for group chats where multiple users share a session).
 *   - Entry is cleared when the session is explicitly reset (/halo-clear).
 *   - Entries are NOT persisted — they exist only while the process is alive.
 *     On restart, the next inbound message re-creates the entry.
 */

import type { GuestPolicy } from '../../../shared/types/im-channel'

// Re-export GuestPolicy so consumers can import from a single location
export type { GuestPolicy }

// ============================================
// Types
// ============================================

/**
 * Per-message permission context stored in the registry.
 *
 * Updated on every inbound dispatch — always reflects the latest sender.
 */
export interface ImPermissionContext {
  /** Platform-side user ID of the message sender */
  senderId: string
  /** Display name of the sender */
  senderName: string
  /** Whether this sender is in the channel instance's owners list */
  isOwner: boolean
  /** Resolved guest policy (from channel instance config). Only meaningful when !isOwner. */
  guestPolicy?: GuestPolicy
  /** Owner user IDs for security prompt injection. Present when owners are configured. */
  ownerNames?: string[]
}

// ============================================
// Registry (module-level singleton)
// ============================================

const registry = new Map<string, ImPermissionContext>()

/**
 * Set (or overwrite) the permission context for a conversation.
 * Called by dispatch-inbound.ts on every inbound IM message.
 */
export function setImPermissionContext(conversationId: string, ctx: ImPermissionContext): void {
  registry.set(conversationId, ctx)
}

/**
 * Get the current permission context for a conversation.
 * Returns undefined for non-IM sessions (native chat, automation runs).
 */
export function getImPermissionContext(conversationId: string): ImPermissionContext | undefined {
  return registry.get(conversationId)
}

/**
 * Clear the permission context for a conversation.
 * Called on session reset (/halo-clear) and session removal.
 */
export function clearImPermissionContext(conversationId: string): void {
  registry.delete(conversationId)
}

/**
 * Clear all permission contexts. Used during shutdown cleanup.
 */
export function clearAllImPermissionContexts(): void {
  registry.clear()
}
