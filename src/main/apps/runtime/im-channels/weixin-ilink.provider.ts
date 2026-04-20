/**
 * apps/runtime/im-channels -- WeChat iLink Bot Provider
 *
 * ImChannelProvider implementation for WeChat Personal Bot via iLink API
 * (微信个人号 via iLink API — https://ilinkai.weixin.qq.com).
 *
 * Protocol (confirmed):
 * - QR code login flow (GET /ilink/bot/get_bot_qrcode + GET /ilink/bot/get_qrcode_status)
 * - HTTP long-polling for inbound messages (POST /ilink/bot/getupdates, up to 35s hold)
 * - HTTP POST for outbound messages (POST /ilink/bot/sendmessage)
 * - Auth via `bot_token` obtained after QR scan — stored in instance config
 * - context_token is per-message, no expiry; echoed back verbatim in reply
 * - Missing context_token is a hard error — send is blocked until next inbound msg
 * - errcode/ret === -14 means session expired → stop and require re-auth
 * - AbortController used for clean long-poll cancellation on stop()
 * - Exponential backoff reconnect: 2s base, 30s cap, 100 attempts max
 * - context_token cache key: `${accountId}:${userId}` (accountId = ilink_bot_id)
 */

import { randomUUID } from 'crypto'
import type {
  ImChannelProvider,
  ImChannelInstance,
  ImChannelConfigFieldDef,
  ImChannelType,
} from '../../../../shared/types/im-channel'
import type { InboundMessage, ReplyHandle } from '../../../../shared/types/inbound-message'
import {
  ILINK_BASE_URL,
  CHANNEL_VERSION,
  SESSION_EXPIRED_CODE,
  buildAuthHeaders,
  isSessionExpired,
  fetchJson,
} from './ilink-api'

// ============================================
// Constants
// ============================================

const RECONNECT_BASE_DELAY_MS = 2_000
const RECONNECT_MAX_DELAY_MS = 30_000
const MAX_RECONNECT_ATTEMPTS = 100
const DEDUP_MAX_SIZE = 200

// ============================================
// Provider-local types
// ============================================

interface WeixinIlinkConfig {
  botToken?: string
  baseUrl?: string
  accountId?: string   // ilink_bot_id — used as part of context_token cache key
}

interface WeixinMessageItem {
  type: 1 | 2 | 3 | 4 | 5   // 1=text, 2=image, 3=voice, 4=file, 5=video
  text_item?: { text: string }
  voice_item?: { text: string }
  image_item?: Record<string, unknown>
  file_item?: { filename?: string }
  video_item?: Record<string, unknown>
}

interface WeixinMessage {
  from_user_id?: string
  to_user_id?: string
  message_id?: number    // Server-assigned numeric ID
  message_type?: number  // 1=USER (inbound), 2=BOT (outbound)
  message_state?: number
  context_token?: string
  item_list?: WeixinMessageItem[]
}

interface GetUpdatesResponse {
  ret?: number           // May be absent on success — treat missing as 0
  errcode?: number
  msgs?: WeixinMessage[]
  get_updates_buf: string
  longpolling_timeout_ms?: number
}

// ============================================
// Provider
// ============================================

export class WeixinIlinkBotProvider implements ImChannelProvider {
  readonly type: ImChannelType = 'weixin-ilink-bot'
  readonly displayName = 'WeChat iLink Bot'
  readonly description = 'WeChat personal bot via iLink API (QR code login)'
  readonly direction = 'bidirectional' as const

  // No configFields — QR flow is done via separate IPC, not text form inputs
  readonly configFields: ImChannelConfigFieldDef[] = []

  readonly defaultConfig: Record<string, unknown> = {
    botToken: '',
    baseUrl: '',
    accountId: '',
  }

  createInstance(instanceId: string, config: Record<string, unknown>): ImChannelInstance {
    return new WeixinIlinkBotInstance(instanceId, config as unknown as WeixinIlinkConfig)
  }

  validateConfig(_config: Record<string, unknown>): string | null {
    // No required user-facing fields — bot_token is obtained via QR flow
    return null
  }
}

// ============================================
// Instance
// ============================================

class WeixinIlinkBotInstance implements ImChannelInstance {
  readonly instanceId: string
  readonly providerType: ImChannelType = 'weixin-ilink-bot'

  private config: WeixinIlinkConfig
  private active = false
  private connected = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pollAbortController: AbortController | null = null
  private inboundHandler: ((msg: InboundMessage, reply: ReplyHandle) => void) | null = null

  // context_token cache: key is `${accountId}:${userId}`, value is most recent context_token.
  // Per-message, no expiry. Missing = hard error on send.
  private contextTokens = new Map<string, string>()

  // Message deduplication: circular buffer of last N message IDs
  private seenMessageIds: string[] = []

  // Long-poll cursor — empty string means start from the beginning
  private updatesBuf = ''

  constructor(instanceId: string, config: WeixinIlinkConfig) {
    this.instanceId = instanceId
    this.config = config
  }

  // ── ImChannelInstance interface ───────────────────────────────

  onInbound(handler: (msg: InboundMessage, reply: ReplyHandle) => void): void {
    this.inboundHandler = handler
  }

  start(): void {
    this.active = true
    if (!this.config.botToken) {
      console.log(`[WeixinIlink:${this.instanceId}] No bot_token configured — waiting for QR login`)
      return
    }
    this.startPolling()
    console.log(`[WeixinIlink:${this.instanceId}] Started`)
  }

  stop(): void {
    this.active = false
    this.connected = false
    this.abortCurrentPoll()
    this.inboundHandler = null
    this.contextTokens.clear()
    this.seenMessageIds = []
    this.updatesBuf = ''
    this.reconnectAttempts = 0
    console.log(`[WeixinIlink:${this.instanceId}] Stopped`)
  }

  reconnect(): void {
    if (!this.active) return
    this.abortCurrentPoll()
    this.connected = false
    this.reconnectAttempts = 0
    this.updatesBuf = ''
    if (this.config.botToken) {
      this.startPolling()
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  pushToChat(chatId: string, text: string, _chatType: 'direct' | 'group'): boolean {
    if (!this.config.botToken) {
      console.warn(`[WeixinIlink:${this.instanceId}] Cannot push: no bot_token`)
      return false
    }
    const contextToken = this.contextTokens.get(this.contextTokenKey(chatId))
    if (!contextToken) {
      console.warn(
        `[WeixinIlink:${this.instanceId}] Cannot push to ${chatId}: ` +
        'no context_token — blocked until next inbound message from user'
      )
      return false
    }
    this.sendMessage(chatId, text, contextToken).catch((err) => {
      console.error(`[WeixinIlink:${this.instanceId}] pushToChat failed for ${chatId}:`, err)
    })
    return true
  }

  // ── Long-poll loop ────────────────────────────────────────────

  private startPolling(): void {
    this.abortCurrentPoll()
    this.connected = false
    this.pollLoop()
  }

  private async pollLoop(): Promise<void> {
    while (this.active && this.config.botToken) {
      const abortController = new AbortController()
      this.pollAbortController = abortController

      try {
        const baseUrl = this.config.baseUrl || ILINK_BASE_URL
        const url = `${baseUrl}/ilink/bot/getupdates`
        const headers = buildAuthHeaders(this.config.botToken)
        const body = {
          get_updates_buf: this.updatesBuf,
          base_info: { channel_version: CHANNEL_VERSION },
        }

        const response = await fetchJson<GetUpdatesResponse>(
          'POST',
          url,
          headers,
          body,
          abortController.signal
        )

        if (!this.active) break

        // iLink API omits `ret` on success — treat missing as 0.
        // Use errcode as fallback; errcode=-14 means session expired.
        const retCode = response.ret ?? response.errcode ?? 0

        // Session expired — stop and require re-auth
        if (isSessionExpired(retCode, response.errcode)) {
          console.error(
            `[WeixinIlink:${this.instanceId}] Session expired (code -14) — re-auth via QR required`
          )
          this.connected = false
          this.active = false
          break
        }

        if (retCode !== 0) {
          console.warn(
            `[WeixinIlink:${this.instanceId}] getupdates error retCode=${retCode} errcode=${response.errcode ?? 'n/a'}, will retry`
          )
          this.connected = false
          await this.backoffDelay()
          continue
        }

        // Successful response
        if (!this.connected) {
          this.connected = true
          this.reconnectAttempts = 0
          console.log(`[WeixinIlink:${this.instanceId}] Connected (long-poll active)`)
        }

        if (response.get_updates_buf) {
          this.updatesBuf = response.get_updates_buf
        }

        if (response.msgs && response.msgs.length > 0) {
          for (const msg of response.msgs) {
            if (msg.message_type === 1) {
              this.handleInboundMessage(msg)
            }
          }
        }

        // Re-poll immediately — server holds connection up to 35s
      } catch (err: unknown) {
        if (!this.active) break

        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg === 'Aborted') break

        console.error(`[WeixinIlink:${this.instanceId}] Poll error:`, errMsg)
        this.connected = false
        await this.backoffDelay()
      }
    }

    this.pollAbortController = null
  }

  private async backoffDelay(): Promise<void> {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[WeixinIlink:${this.instanceId}] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached, stopping`
      )
      this.active = false
      return
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    )
    this.reconnectAttempts++
    console.log(
      `[WeixinIlink:${this.instanceId}] Backing off ${delay}ms (attempt ${this.reconnectAttempts})`
    )
    await new Promise<void>((resolve) => {
      this.reconnectTimer = setTimeout(resolve, delay)
    })
    this.reconnectTimer = null
  }

  private abortCurrentPoll(): void {
    if (this.pollAbortController) {
      this.pollAbortController.abort()
      this.pollAbortController = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  // ── Inbound message handling ─────────────────────────────────

  private handleInboundMessage(msg: WeixinMessage): void {
    if (!this.active || !this.inboundHandler) return

    const userId = msg.from_user_id
    if (!userId) return

    // Deduplicate — prefer numeric message_id, fall back to context composite
    const msgId = msg.message_id != null
      ? String(msg.message_id)
      : `${userId}:${msg.context_token ?? Date.now()}`
    if (this.isDuplicate(msgId)) {
      console.log(`[WeixinIlink:${this.instanceId}] Duplicate message skipped: ${msgId}`)
      return
    }
    this.trackMessageId(msgId)

    // Cache context_token — per-message, no expiry, overwritten on each new message
    if (msg.context_token) {
      this.contextTokens.set(this.contextTokenKey(userId), msg.context_token)
    }

    const text = this.extractText(msg)
    console.log(`[WeixinIlink:${this.instanceId}] Inbound from=${userId} len=${text.length}`)

    const inbound: InboundMessage = {
      body: text,
      from: userId,
      fromName: userId,
      channel: 'weixin-ilink-bot',
      chatType: 'direct',
      chatId: userId,
      messageId: msgId,
      timestamp: Date.now(),
    }

    // Capture context_token at dispatch time — must be echoed in reply
    const contextToken = msg.context_token
    const reply: ReplyHandle = {
      channel: 'weixin-ilink-bot',
      chatId: userId,
      // replyTtlMs omitted — context_token has no expiry; reply path is always valid
      send: async (replyText: string): Promise<void> => {
        if (!contextToken) {
          throw new Error(
            `[WeixinIlink:${this.instanceId}] Cannot reply to ${userId}: missing context_token`
          )
        }
        await this.sendMessage(userId, replyText, contextToken)
      },
    }

    this.inboundHandler(inbound, reply)
  }

  private extractText(msg: WeixinMessage): string {
    const items = msg.item_list ?? []
    const parts: string[] = []

    for (const item of items) {
      switch (item.type) {
        case 1:
          if (item.text_item?.text) parts.push(item.text_item.text)
          break
        case 2:
          parts.push('[Image]')
          break
        case 3:
          // Use speech-to-text transcript when provided
          if (item.voice_item?.text) parts.push(item.voice_item.text)
          else parts.push('[Voice]')
          break
        case 4:
          parts.push(`[File: ${item.file_item?.filename ?? 'unknown'}]`)
          break
        case 5:
          parts.push('[Video]')
          break
        default:
          parts.push(`[Unknown message type: ${item.type}]`)
      }
    }

    return parts.join('\n').trim()
  }

  // ── Send message ──────────────────────────────────────────────

  private async sendMessage(
    toUserId: string,
    text: string,
    contextToken: string
  ): Promise<void> {
    if (!this.config.botToken) {
      throw new Error(`[WeixinIlink:${this.instanceId}] Cannot send: no bot_token`)
    }
    if (!contextToken) {
      throw new Error(
        `[WeixinIlink:${this.instanceId}] Cannot send to ${toUserId}: missing context_token`
      )
    }

    const baseUrl = this.config.baseUrl || ILINK_BASE_URL
    const url = `${baseUrl}/ilink/bot/sendmessage`
    const headers = buildAuthHeaders(this.config.botToken)

    const body = {
      msg: {
        from_user_id: '',            // Always empty for bot-originated messages
        to_user_id: toUserId,
        client_id: randomUUID(),     // Idempotency key
        message_type: 2,             // BOT
        message_state: 2,            // FINISH
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text } }],
      },
      base_info: { channel_version: CHANNEL_VERSION },
    }

    interface SendMessageResponse { ret?: number; errcode?: number; errmsg?: string }
    const response = await fetchJson<SendMessageResponse>(
      'POST',
      url,
      headers,
      body
    )

    const sendRetCode = response.ret ?? response.errcode ?? 0
    if (isSessionExpired(sendRetCode, response.errcode)) {
      this.active = false
      this.connected = false
      throw new Error(
        `[WeixinIlink:${this.instanceId}] Session expired (code -14) — re-auth required`
      )
    }

    if (sendRetCode !== 0) {
      throw new Error(
        `[WeixinIlink:${this.instanceId}] sendmessage failed: retCode=${sendRetCode} msg=${response.errmsg ?? ''}`
      )
    }

    console.log(`[WeixinIlink:${this.instanceId}] Message sent to ${toUserId}`)
  }

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * Build the context_token cache key.
   * Uses `${accountId}:${userId}` when accountId (ilink_bot_id) is available,
   * otherwise just userId.
   */
  private contextTokenKey(userId: string): string {
    return this.config.accountId ? `${this.config.accountId}:${userId}` : userId
  }

  private isDuplicate(msgId: string): boolean {
    return this.seenMessageIds.includes(msgId)
  }

  private trackMessageId(msgId: string): void {
    if (this.seenMessageIds.length >= DEDUP_MAX_SIZE) {
      this.seenMessageIds.shift()
    }
    this.seenMessageIds.push(msgId)
  }
}
