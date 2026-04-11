/**
 * apps/runtime -- Inbound Dispatch
 *
 * Unified entry point for all inbound IM messages. The ImChannelManager
 * calls dispatchInboundMessage() with a normalized InboundMessage + ReplyHandle
 * plus the pre-resolved appId and instanceId (from the instance's binding).
 *
 * This module handles:
 *   1. App validation — ensure the bound App exists and has a spaceId
 *   2. Session key construction — per-app, per-channel, per-chat isolation
 *   3. Session registration — track IM sessions in the registry
 *   4. Execution — delegates to app-chat.ts for conversational AI
 *
 * Design principles:
 * - No routing logic — appId is provided by the caller (ImChannelManager)
 * - No IM protocol details — only works with InboundMessage + ReplyHandle
 * - No direct dependency on any specific adapter
 */

import type { InboundMessage, ReplyHandle } from '../../../shared/types/inbound-message'
import { getAppManager } from '../manager'
import { sendAppChatMessage, buildImSessionKey } from './app-chat'
import { getImSessionRegistry } from './im-session-registry'
import { sendToRenderer } from '../../services/window.service'
import { broadcastToAll } from '../../http/websocket'
import { stopGeneration } from '../../services/agent/control'
import { activeSessions } from '../../services/agent/session-manager'

// ============================================
// Constants
// ============================================

const LOG_TAG = '[Dispatch]'

/** Maximum reply length (platform-safe limit for most IM channels) */
const MAX_REPLY_LENGTH = 4000

/**
 * Commands that abort the current generation.
 * Slash-prefixed to avoid false triggers from normal conversation.
 */
const STOP_COMMANDS = new Set(['/halo-stop', '/halo-cancel'])

/** Check whether a message is a stop command (case-insensitive, trimmed). */
function isStopCommand(body: string): boolean {
  return STOP_COMMANDS.has(body.trim().toLowerCase())
}

// ============================================
// Dispatch
// ============================================

/**
 * Dispatch an inbound IM message to a specific digital human.
 *
 * Called by the ImChannelManager's onInbound callback, which provides
 * the pre-resolved appId and instanceId from the instance's config binding.
 *
 * @param msg - Normalized inbound message from the channel adapter
 * @param reply - Reply handle for sending responses back to the IM channel
 * @param appId - Bound digital human App ID (from instance config)
 * @param instanceId - IM channel instance ID (for session tracking)
 */
export async function dispatchInboundMessage(
  msg: InboundMessage,
  reply: ReplyHandle,
  appId: string,
  instanceId: string
): Promise<void> {
  const manager = getAppManager()
  if (!manager) {
    console.warn(`${LOG_TAG} App manager not initialized`)
    return
  }

  const app = manager.getApp(appId)
  if (!app) {
    console.log(
      `${LOG_TAG} No app found for appId="${appId}": ` +
      `channel=${msg.channel}, chatId=${msg.chatId}, instanceId=${instanceId}`
    )
    return
  }

  if (!app.spaceId) {
    console.warn(`${LOG_TAG} App "${app.spec.name}" (${app.id}) has no spaceId — cannot dispatch`)
    return
  }

  // Build isolated session key
  const conversationId = buildImSessionKey(app.id, msg.channel, msg.chatType, msg.chatId)

  // Register session in ImSessionRegistry (idempotent — updates lastActiveAt on repeat)
  const registry = getImSessionRegistry()
  if (registry) {
    const displayName = msg.chatName ?? msg.fromName ?? msg.chatId
    registry.register(app.id, msg.channel, msg.chatId, msg.chatType, instanceId, {
      displayName,
      lastSender: msg.fromName,
      lastMessage: msg.body.slice(0, 50),
    })

    // Notify renderer of session update for real-time panel refresh
    const sessionEvent = {
      appId: app.id,
      channel: msg.channel,
      chatId: msg.chatId,
      chatType: msg.chatType,
      instanceId,
      lastMessage: msg.body.slice(0, 50),
      lastSender: msg.fromName,
    }
    sendToRenderer('app:im-session-updated', sessionEvent)
    broadcastToAll('app:im-session-updated', sessionEvent)
  }

  // ── Stop command: abort a stuck or running generation ──
  if (isStopCommand(msg.body)) {
    const isActive = activeSessions.has(conversationId)
    if (isActive) {
      console.log(`${LOG_TAG} Stop command received: channel=${msg.channel}, chatId=${msg.chatId}, session=${conversationId}`)
      try {
        await stopGeneration(conversationId)
        await reply.send('Generation stopped.')
      } catch (err) {
        console.error(`${LOG_TAG} Failed to stop generation: session=${conversationId}`, err)
        await reply.send('Failed to stop generation.').catch(() => {})
      }
    } else {
      await reply.send('No active generation to stop.').catch(() => {})
    }
    return
  }

  // For group chats, prefix sender name so the AI knows who is speaking
  const messageText = msg.chatType === 'group' && msg.fromName
    ? `[${msg.fromName}] ${msg.body}`
    : msg.body

  console.log(
    `${LOG_TAG} Routing: channel=${msg.channel}, chatId=${msg.chatId}, ` +
    `chatType=${msg.chatType}, instanceId=${instanceId} → ` +
    `app="${app.spec.name}" (${app.id}), session=${conversationId}, msgLen=${msg.body.length}`
  )

  try {
    await sendAppChatMessage({
      appId: app.id,
      spaceId: app.spaceId,
      message: messageText,
      conversationId,
      onReply: (finalContent: string) => {
        const replyText = finalContent.slice(0, MAX_REPLY_LENGTH)
        reply.send(replyText).catch((err) => {
          console.error(`${LOG_TAG} Failed to send reply: channel=${reply.channel}, chatId=${reply.chatId}`, err)
        })
      },
    })
  } catch (err) {
    console.error(
      `${LOG_TAG} Execution failed: app=${app.id}, channel=${msg.channel}, chatId=${msg.chatId}`,
      err
    )
    // Attempt to send error notification back to the IM channel
    try {
      const errorMsg = `⚠️ Error: ${(err as Error).message?.slice(0, 200) ?? 'Unknown error'}`
      await reply.send(errorMsg)
    } catch {
      // Reply channel may be unavailable — nothing more we can do
    }
  }
}
