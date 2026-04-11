/**
 * IM session key builders — shared between main process and renderer.
 *
 * The conversation-ID format is the single source of truth for session
 * isolation across all layers: runtime, event routing, store lookups, and
 * renderer subscriptions.  Both sides MUST use these functions instead of
 * constructing the key string inline, so that any future format change is
 * automatically reflected everywhere.
 */

/**
 * Build the virtual conversationId for the native Halo app-chat session.
 * Used for V2 session keying, active session tracking, and renderer event routing.
 *
 * Format: "app-chat:{appId}"
 */
export function getAppChatConversationId(appId: string): string {
  return `app-chat:${appId}`
}

/**
 * Build a fully-qualified session key for IM channel conversations.
 *
 * Format: "app-chat:{appId}:{channel}:{chatType}:{chatId}"
 *
 * This ensures complete session isolation across channels, chat types, and
 * individual chats.  The prefix "app-chat:" keeps the key in the same
 * namespace as native app-chat so the renderer's chat store can handle both
 * uniformly.
 */
export function buildImSessionKey(
  appId: string,
  channel: string,
  chatType: 'direct' | 'group',
  chatId: string
): string {
  return `app-chat:${appId}:${channel}:${chatType}:${chatId}`
}
