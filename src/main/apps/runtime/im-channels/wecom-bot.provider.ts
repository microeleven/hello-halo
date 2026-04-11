/**
 * apps/runtime/im-channels -- WeCom Bot Provider
 *
 * ImChannelProvider implementation for WeCom Intelligent Bot (企业微信智能机器人).
 *
 * Protocol (aligned with @wecom/aibot-node-sdk):
 * - WebSocket long connection (JSON, no XML/AES)
 * - `aibot_subscribe` for authentication (bot_id + secret)
 * - `aibot_msg_callback` for receiving messages
 * - `aibot_respond_msg` for replying (same req_id)
 * - `aibot_send_msg` for proactive push
 * - Application-level heartbeat: `{ cmd: "ping" }` every 30 seconds
 * - Only ONE WebSocket connection per bot allowed
 * - req_id expires after 5 minutes (WeCom protocol limit)
 */

import WebSocket from 'ws'
import type {
  ImChannelProvider,
  ImChannelInstance,
  ImChannelConfigFieldDef,
  ImChannelType,
} from '../../../../shared/types/im-channel'
import type { InboundMessage, ReplyHandle } from '../../../../shared/types/inbound-message'

// ============================================
// Constants
// ============================================

const DEFAULT_WS_URL = 'wss://openws.work.weixin.qq.com'
const HEARTBEAT_INTERVAL_MS = 30_000    // 30 seconds
const RECONNECT_BASE_DELAY_MS = 2_000   // 2 seconds
const RECONNECT_MAX_DELAY_MS = 30_000   // 30 seconds cap
const MAX_RECONNECT_ATTEMPTS = 100
const REQ_ID_TTL_MS = 5 * 60 * 1000    // 5 minutes (WeCom protocol limit)
const REQ_ID_CLEANUP_INTERVAL_MS = 60_000 // 1 minute

// ============================================
// Helpers
// ============================================

let reqIdCounter = 0

function generateReqId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++reqIdCounter}`
}

// ============================================
// WeCom Bot Config (provider-specific)
// ============================================

interface WecomBotProviderConfig {
  botId: string
  secret: string
  wsUrl?: string
}

// ============================================
// Provider
// ============================================

export class WecomBotProvider implements ImChannelProvider {
  readonly type: ImChannelType = 'wecom-bot'
  readonly displayName = 'WeCom Intelligent Bot'
  readonly description = 'Bidirectional messaging via WeCom AI Bot WebSocket'
  readonly direction = 'bidirectional' as const

  readonly configFields: ImChannelConfigFieldDef[] = [
    { key: 'botId', label: 'Bot ID', type: 'text', placeholder: 'aib-xxx', required: true },
    { key: 'secret', label: 'Secret', type: 'password', required: true },
    { key: 'wsUrl', label: 'WebSocket URL', type: 'text', placeholder: 'wss://openws.work.weixin.qq.com' },
  ]

  readonly defaultConfig: Record<string, unknown> = {
    botId: '',
    secret: '',
    wsUrl: '',
  }

  createInstance(instanceId: string, config: Record<string, unknown>): ImChannelInstance {
    return new WecomBotInstance(instanceId, config as unknown as WecomBotProviderConfig)
  }

  validateConfig(config: Record<string, unknown>): string | null {
    if (!config.botId || typeof config.botId !== 'string') return 'Bot ID is required'
    if (!config.secret || typeof config.secret !== 'string') return 'Secret is required'
    return null
  }
}

// ============================================
// Instance
// ============================================

interface ReqIdEntry {
  reqId: string
  ts: number
}

class WecomBotInstance implements ImChannelInstance {
  readonly instanceId: string
  readonly providerType: ImChannelType = 'wecom-bot'

  private config: WecomBotProviderConfig
  private ws: WebSocket | null = null
  private active = false
  private reconnectAttempts = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reqIdCleanupTimer: ReturnType<typeof setInterval> | null = null
  private inboundHandler: ((msg: InboundMessage, reply: ReplyHandle) => void) | null = null
  private reqIdMap = new Map<string, ReqIdEntry>()

  constructor(instanceId: string, config: WecomBotProviderConfig) {
    this.instanceId = instanceId
    this.config = config
  }

  // ── ImChannelInstance interface ────────────────────────────────

  onInbound(handler: (msg: InboundMessage, reply: ReplyHandle) => void): void {
    this.inboundHandler = handler
  }

  start(): void {
    this.active = true
    if (!this.config.botId || !this.config.secret) {
      console.log(`[WecomBot:${this.instanceId}] Missing botId or secret — skipping start`)
      return
    }
    this.connect()
    this.reqIdCleanupTimer = setInterval(() => this.cleanupExpiredReqIds(), REQ_ID_CLEANUP_INTERVAL_MS)
    console.log(`[WecomBot:${this.instanceId}] Started`)
  }

  stop(): void {
    this.active = false
    // Cancel all timers before tearing down the socket so no reconnect or
    // heartbeat fires during teardown.
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.reqIdCleanupTimer) { clearInterval(this.reqIdCleanupTimer); this.reqIdCleanupTimer = null }
    // Destroy socket first, then clear the handler.  Reversing the order would
    // create a brief window where an in-flight WebSocket message callback could
    // fire with a null handler and silently drop the message.
    this.destroySocket()
    this.inboundHandler = null
    this.reqIdMap.clear()
    this.reconnectAttempts = 0
    console.log(`[WecomBot:${this.instanceId}] Stopped`)
  }

  reconnect(): void {
    if (!this.active) return
    this.destroySocket()
    this.stopHeartbeat()
    this.reconnectAttempts = 0
    if (this.config.botId && this.config.secret) {
      this.connect()
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  pushToChat(chatId: string, text: string, chatType: 'direct' | 'group'): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WecomBot:${this.instanceId}] Cannot push: WebSocket not connected`)
      return false
    }
    try {
      this.ws.send(JSON.stringify({
        cmd: 'aibot_send_msg',
        headers: { req_id: generateReqId('aibot_send_msg') },
        body: {
          chatid: chatId,
          chat_type: chatType === 'direct' ? 1 : 2,
          msgtype: 'markdown',
          markdown: { content: text },
        },
      }))
      console.log(`[WecomBot:${this.instanceId}] Push sent to chat ${chatId} (${chatType})`)
      return true
    } catch (err) {
      console.error(`[WecomBot:${this.instanceId}] Failed to push message:`, err)
      return false
    }
  }

  // ── Reply (using req_id from inbound message) ─────────────────

  private replyToChat(chatId: string, text: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false

    const entry = this.reqIdMap.get(chatId)
    if (!entry) return false
    if (Date.now() - entry.ts > REQ_ID_TTL_MS) {
      this.reqIdMap.delete(chatId)
      return false
    }

    try {
      this.ws.send(JSON.stringify({
        cmd: 'aibot_respond_msg',
        headers: { req_id: entry.reqId },
        body: {
          msgtype: 'markdown',
          markdown: { content: text },
        },
      }))
      console.log(`[WecomBot:${this.instanceId}] Reply sent to chat ${chatId}`)
      return true
    } catch (err) {
      console.error(`[WecomBot:${this.instanceId}] Failed to send reply:`, err)
      return false
    }
  }

  // ── WebSocket Connection ──────────────────────────────────────

  private connect(): void {
    this.destroySocket()
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }

    const wsUrl = this.config.wsUrl || DEFAULT_WS_URL
    console.log(`[WecomBot:${this.instanceId}] Connecting to ${wsUrl}...`)

    try {
      this.ws = new WebSocket(wsUrl, {
        perMessageDeflate: false,
        skipUTF8Validation: true,
      })
    } catch (err) {
      console.error(`[WecomBot:${this.instanceId}] Failed to create WebSocket:`, err)
      this.scheduleReconnect()
      return
    }

    this.ws.on('open', () => {
      console.log(`[WecomBot:${this.instanceId}] Connected, subscribing...`)
      this.reconnectAttempts = 0
      this.ws!.send(JSON.stringify({
        cmd: 'aibot_subscribe',
        headers: { req_id: generateReqId('aibot_subscribe') },
        body: {
          bot_id: this.config.botId,
          secret: this.config.secret,
        },
      }))
    })

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data)
    })

    this.ws.on('ping', () => {
      this.ws?.pong()
    })

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[WecomBot:${this.instanceId}] Connection closed (code=${code}, reason=${reason.toString()})`)
      this.stopHeartbeat()
      if (this.active) {
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (err: Error) => {
      console.error(`[WecomBot:${this.instanceId}] WebSocket error:`, err.message)
    })
  }

  private destroySocket(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.terminate()
      } catch { /* ignore */ }
      this.ws = null
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    let msg: any
    try {
      msg = JSON.parse(typeof data === 'string' ? data : data.toString())
    } catch {
      console.warn(`[WecomBot:${this.instanceId}] Invalid JSON received`)
      return
    }

    const reqId = msg.headers?.req_id ?? ''

    // Authentication response
    if (typeof reqId === 'string' && reqId.startsWith('aibot_subscribe')) {
      if (msg.errcode === 0) {
        console.log(`[WecomBot:${this.instanceId}] Subscribed successfully`)
        this.startHeartbeat()
      } else {
        console.error(`[WecomBot:${this.instanceId}] Subscribe failed: errcode=${msg.errcode} errmsg=${msg.errmsg}`)
        this.destroySocket()
      }
      return
    }

    // Heartbeat ack
    if (typeof reqId === 'string' && reqId.startsWith('ping')) return

    // Command-based routing
    switch (msg.cmd) {
      case 'aibot_msg_callback':
        this.handleInboundMessage(msg)
        break
      case 'aibot_event_callback': {
        const eventType = msg.body?.event?.eventtype ?? msg.body?.event_type ?? 'unknown'
        console.log(`[WecomBot:${this.instanceId}] Event: ${eventType}`)
        break
      }
      default:
        if (msg.cmd) {
          console.log(`[WecomBot:${this.instanceId}] Unknown cmd: ${msg.cmd}`)
        }
        break
    }
  }

  private handleInboundMessage(msg: any): void {
    if (!this.active || !this.inboundHandler) return

    const body = msg.body
    if (!body) return

    const reqId = msg.headers?.req_id
    const senderId = body.from?.userid
    const senderName = body.from?.name ?? senderId
    const chatId = body.chatid ?? senderId
    const chatType = body.chattype
    const msgId = body.msgid
    const msgType = body.msgtype

    if (!senderId || !chatId) return

    if (reqId) {
      this.reqIdMap.set(chatId, { reqId, ts: Date.now() })
    }

    const text = this.extractText(body)

    console.log(
      `[WecomBot:${this.instanceId}] Message: chat=${chatId}, type=${chatType}, ` +
      `from=${senderName}, msgType=${msgType}, len=${text.length}`
    )

    // Construct normalized InboundMessage
    const inbound: InboundMessage = {
      body: text,
      from: senderId,
      fromName: senderName,
      channel: 'wecom-bot',
      chatType: chatType === 'group' ? 'group' : 'direct',
      chatId,
      messageId: msgId,
      timestamp: Date.now(),
    }

    // Construct ReplyHandle
    const chatTypeNorm: 'direct' | 'group' = chatType === 'group' ? 'group' : 'direct'
    const reply: ReplyHandle = {
      channel: 'wecom-bot',
      chatId,
      replyTtlMs: REQ_ID_TTL_MS,
      send: async (replyText: string): Promise<void> => {
        const replied = this.replyToChat(chatId, replyText)
        if (replied) return
        console.log(`[WecomBot:${this.instanceId}] req_id expired for chat ${chatId}, falling back to pushToChat`)
        const pushed = this.pushToChat(chatId, replyText, chatTypeNorm)
        if (!pushed) {
          throw new Error(`[WecomBot:${this.instanceId}] Both replyToChat and pushToChat failed for chat ${chatId}`)
        }
      },
    }

    // Dispatch to registered handler
    this.inboundHandler(inbound, reply)
  }

  private extractText(body: any): string {
    switch (body.msgtype) {
      case 'text': return body.text?.content ?? ''
      case 'image': return '(图片)'
      case 'voice': return '(语音)'
      case 'file': return `(文件: ${body.file?.filename ?? '未知'})`
      case 'video': return '(视频)'
      case 'link': return `(链接: ${body.link?.title ?? body.link?.url ?? ''})`
      default: return `(${body.msgtype ?? '未知消息类型'})`
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({
            cmd: 'ping',
            headers: { req_id: generateReqId('ping') },
          }))
        } catch { /* ignore */ }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
  }

  // ── Reconnect ─────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (!this.active) return
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[WecomBot:${this.instanceId}] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`)
      return
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    )
    this.reconnectAttempts++
    console.log(`[WecomBot:${this.instanceId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`)
    this.reconnectTimer = setTimeout(() => {
      if (this.active) this.connect()
    }, delay)
  }

  // ── req_id Cleanup ────────────────────────────────────────────

  private cleanupExpiredReqIds(): void {
    const now = Date.now()
    for (const [chatId, entry] of this.reqIdMap) {
      if (now - entry.ts > REQ_ID_TTL_MS) {
        this.reqIdMap.delete(chatId)
      }
    }
  }
}
