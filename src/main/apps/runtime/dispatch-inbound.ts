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

import type { InboundMessage, ReplyHandle, ProgressEvent } from '../../../shared/types/inbound-message'
import { getAppManager } from '../manager'
import { sendAppChatMessage, buildImSessionKey, clearImSession } from './app-chat'
import { getImSessionRegistry } from './im-session-registry'
import { getActiveImChannelManager } from './im-channels'
import { sendToRenderer } from '../../services/window.service'
import { broadcastToAll } from '../../http/websocket'
import { stopGeneration } from '../../services/agent/control'
import { activeSessions } from '../../services/agent/session-manager'
import { setImPermissionContext, clearImPermissionContext } from './im-permission-registry'

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

/** Commands that clear the conversation context and start fresh. */
const CLEAR_COMMANDS = new Set(['/halo-clear', '/halo-reset'])

/** Check whether a message is a stop command (case-insensitive, trimmed). */
function isStopCommand(body: string): boolean {
  return STOP_COMMANDS.has(body.trim().toLowerCase())
}

/** Check whether a message is a clear-context command (case-insensitive, trimmed). */
function isClearCommand(body: string): boolean {
  return CLEAR_COMMANDS.has(body.trim().toLowerCase())
}

/**
 * Bilingual rejection message sent when a DM is blocked by replyScope policy.
 * Hardcoded because the backend does not have renderer i18n loaded.
 */
const DM_REJECTED_MESSAGE =
  '⚠️ This bot only responds in group chats. Please contact the bot administrator for access.\n' +
  '⚠️ 该机器人仅在群聊中响应，请联系管理员开通权限。'

/** Bilingual rejection for group messages blocked by 'direct'-only scope. */
const GROUP_REJECTED_MESSAGE =
  '⚠️ This bot only responds to direct messages.\n' +
  '⚠️ 该机器人仅在私聊中响应。'

// ============================================
// Helpers
// ============================================

/**
 * Look up the fileCapability for a channel instance and return a pre-bound
 * send function for the given conversation.
 *
 * Returns undefined when:
 *   - The ImChannelManager is not initialized
 *   - The instance does not expose fileCapability (text-only channel)
 *   - The instance is no longer registered
 *
 * @param instanceId - IM channel instance ID
 * @param chatId - Target conversation ID (bound into the closure)
 * @param chatType - Conversation type (bound into the closure)
 */
function resolveImFileSend(
  instanceId: string,
  chatId: string,
  chatType: 'direct' | 'group'
): ((filePath: string, filename?: string) => Promise<boolean>) | undefined {
  const manager = getActiveImChannelManager()
  if (!manager) return undefined
  const instance = manager.getInstance(instanceId)
  if (!instance?.fileCapability) return undefined
  return (filePath: string, filename?: string) =>
    instance.fileCapability!.sendFile(chatId, filePath, chatType, filename)
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

  // ── Reply scope check (security gate) ─────────────────────────
  // Default: 'all' for backward compatibility (existing instances without the
  // field should not break). New instances default to 'group' in the UI.
  const channelManager = getActiveImChannelManager()
  const instanceCfg = channelManager?.getInstanceConfig(instanceId)
  const replyScope = instanceCfg?.replyScope ?? 'all'

  if (replyScope !== 'all' && replyScope !== msg.chatType) {
    const rejectionMsg = msg.chatType === 'direct' ? DM_REJECTED_MESSAGE : GROUP_REJECTED_MESSAGE
    console.log(
      `${LOG_TAG} Blocked by replyScope: scope=${replyScope}, chatType=${msg.chatType}, ` +
      `channel=${msg.channel}, chatId=${msg.chatId}, instanceId=${instanceId}`
    )
    reply.send(rejectionMsg).catch(() => {})
    return
  }

  // ── Streaming disable check ───────────────────────────────────
  // When streaming is disabled, strip the streaming handle so the runtime
  // sends only the final reply — no thinking process or tool calls leak.
  if (instanceCfg?.streaming === false && reply.streaming) {
    reply = { ...reply, streaming: undefined }
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

  // ── Clear command: reset conversation context ──
  if (isClearCommand(msg.body)) {
    console.log(`${LOG_TAG} Clear command received: channel=${msg.channel}, chatId=${msg.chatId}, session=${conversationId}`)
    try {
      await clearImSession(app.id, app.spaceId!, msg.channel, msg.chatType, msg.chatId)
      clearImPermissionContext(conversationId)
      await reply.send('Context cleared. Starting a fresh conversation.')
    } catch (err) {
      console.error(`${LOG_TAG} Failed to clear context: session=${conversationId}`, err)
      await reply.send('Failed to clear context. Please try again.').catch(() => {})
    }
    return
  }

  // ── Identity injection ───────────────────────────────
  // Direct chat: sender identity goes into the system prompt (via senderIdentity).
  //   User messages stay clean — slash commands / skills reach the SDK unmodified.
  //   Anti-injection is preserved because system prompt is tamper-proof.
  // Group chat: per-message <msg-sender> tag (different senders per turn).
  const senderName = msg.fromName ?? msg.from
  let messageText: string
  let senderIdentity: { id: string; name: string } | undefined

  if (msg.chatType === 'direct') {
    messageText = msg.body
    if (msg.from) {
      senderIdentity = { id: msg.from, name: senderName }
    }
  } else {
    // Group: per-message sender tag (AI sees who said what in conversation history)
    messageText = msg.from
      ? `<msg-sender id="${msg.from}" name="${senderName}" />\n${msg.body}`
      : msg.body
  }

  // Resolve owner status and write permission context to the registry.
  // app-chat.ts reads this to enforce tool restrictions for guests.
  // When permissionEnabled is false (default), everyone is treated as owner.
  const permissionEnabled = instanceCfg?.permissionEnabled ?? false
  const owners = permissionEnabled ? instanceCfg?.owners : undefined
  const hasOwnerRestriction = Array.isArray(owners) && owners.length > 0
  const isOwner = !hasOwnerRestriction || owners!.includes(msg.from)
  setImPermissionContext(conversationId, {
    senderId: msg.from,
    senderName,
    isOwner,
    guestPolicy: hasOwnerRestriction ? instanceCfg?.guestPolicy : undefined,
  })

  // Inject file attachment context so the AI can access them via the Read tool.
  // Images are passed separately as multimodal input (see `images` below);
  // files and videos are described here so the AI knows to use Read/Bash.
  if (msg.attachments && msg.attachments.length > 0) {
    const fileLines = msg.attachments
      .map(a => `- [${a.type}] ${a.filename}: ${a.localPath}`)
      .join('\n')
    messageText += `\n\n[Attached files — use the Read tool to access their content]\n${fileLines}`
  }

  // Resolve file-send capability for this instance (absent for text-only channels)
  const chatTypeNorm: 'direct' | 'group' = msg.chatType
  const imFileSend = resolveImFileSend(instanceId, msg.chatId, chatTypeNorm)

  console.log(
    `${LOG_TAG} Routing: channel=${msg.channel}, chatId=${msg.chatId}, ` +
    `chatType=${msg.chatType}, instanceId=${instanceId} → ` +
    `app="${app.spec.name}" (${app.id}), session=${conversationId}, msgLen=${msg.body.length}, ` +
    `attachments=${msg.attachments?.length ?? 0}, images=${msg.images?.length ?? 0}, ` +
    `fileSend=${imFileSend ? 'yes' : 'no'}, ` +
    `sender=${msg.from}(${senderName}), isOwner=${isOwner}`
  )

  // Send an immediate acknowledgment so the user sees the <think> block appear
  // right away instead of staring at silence while session + MCP servers init.
  if (reply.streaming) {
    reply.streaming.update({ type: 'status', text: 'Received, processing...' }).catch(() => {})
  }

  try {
    await sendAppChatMessage({
      appId: app.id,
      spaceId: app.spaceId,
      message: messageText,
      conversationId,
      images: msg.images,
      imFileSend,
      senderIdentity,

      // Forward progress events to streaming handle (if channel supports streaming)
      onProgress: reply.streaming
        ? (event: ProgressEvent) => {
            reply.streaming!.update(event).catch((err: Error) => {
              console.error(
                `${LOG_TAG} streaming.update failed: channel=${reply.channel}, chatId=${reply.chatId}`,
                err
              )
            })
          }
        : undefined,

      // Use streaming.finish when available, else fall back to one-shot send
      onReply: (finalContent: string) => {
        const replyText = finalContent.slice(0, MAX_REPLY_LENGTH)
        const sendFn = reply.streaming
          ? () => reply.streaming!.finish(replyText)
          : () => reply.send(replyText)
        sendFn().catch((err: Error) => {
          console.error(
            `${LOG_TAG} Reply failed: channel=${reply.channel}, chatId=${reply.chatId}`,
            err
          )
        })
      },
    })
  } catch (err) {
    console.error(
      `${LOG_TAG} Execution failed: app=${app.id}, channel=${msg.channel}, chatId=${msg.chatId}`,
      err
    )
    // Attempt to send error notification back to the IM channel.
    // If streaming was started, we MUST finish the stream rather than sending a
    // separate one-shot reply — otherwise WeCom receives an unterminated stream
    // plus a duplicate message, garbling the user's chat.
    try {
      const errorMsg = `⚠️ Error: ${(err as Error).message?.slice(0, 200) ?? 'Unknown error'}`
      if (reply.streaming) {
        await reply.streaming.finish(errorMsg)
      } else {
        await reply.send(errorMsg)
      }
    } catch {
      // Reply channel may be unavailable — nothing more we can do
    }
  }
}
