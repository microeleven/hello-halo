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
 *
 * File capabilities (WeCom single-chat only):
 * - Receive: image / file / video — URL+aeskey, AES-256-CBC decrypted to local temp file
 * - Send: chunked WebSocket upload (init → chunks → complete → media_id) then send msg
 * - Images are also passed as base64 for Claude multimodal vision
 */

import WebSocket from 'ws'
import { createDecipheriv, createHash } from 'crypto'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join, basename, extname } from 'path'
import https from 'https'
import type {
  ImChannelProvider,
  ImChannelInstance,
  ImFileCapability,
  ImChannelConfigFieldDef,
  ImChannelType,
} from '../../../../shared/types/im-channel'
import type {
  InboundMessage,
  InboundAttachment,
  ReplyHandle,
  StreamingHandle,
  ProgressEvent,
} from '../../../../shared/types/inbound-message'
import type { ImageAttachment, ImageMediaType } from '../../../services/agent/types'

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

/** Max chunk size before base64 encoding (WeCom limit: 512 KB raw) */
const UPLOAD_CHUNK_SIZE = 512 * 1024

/** Max allowed chunks per upload session (WeCom limit) */
const UPLOAD_MAX_CHUNKS = 100

/** Timeout for a single WeCom WebSocket request-response pair */
const WS_REQUEST_TIMEOUT_MS = 30_000

/** Local temp directory for downloaded WeCom media */
const TEMP_DIR = join(tmpdir(), 'halo-wecom')

/** Max download size (100 MB). Defense-in-depth against unbounded memory allocation. */
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024

/**
 * Remove stale WeCom media temp files older than 24 hours.
 *
 * Called once at startup by the im-channels layer. Files are only needed for
 * the duration of a single agent execution, so anything older than 24 hours
 * is safe to remove.
 */
export function cleanupWecomTempFiles(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let cleaned = 0
  try {
    const files = readdirSync(TEMP_DIR)
    for (const f of files) {
      const fp = join(TEMP_DIR, f)
      try {
        if (statSync(fp).mtimeMs < cutoff) { unlinkSync(fp); cleaned++ }
      } catch { /* file may be in use or already gone */ }
    }
    if (cleaned > 0) {
      console.log(`[WecomBot] Removed ${cleaned} stale temp file(s) from ${TEMP_DIR}`)
    }
  } catch { /* directory may not exist on first run */ }
}

/** Image file extensions that map to WeCom 'image' media type */
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

// ============================================
// Helpers
// ============================================

let reqIdCounter = 0

function generateReqId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++reqIdCounter}`
}

// ============================================
// Media: Download & Decrypt
// ============================================

/**
 * Download an encrypted media file from WeCom and decrypt it locally.
 *
 * MUST be called within 5 minutes of receiving the message (URL expiry).
 * Algorithm: AES-256-CBC, key = aeskey bytes, IV = first 16 bytes of key.
 * Padding: PKCS#7 to 32-byte multiples (WeCom-specific; handled manually).
 *
 * @param url - WeCom media URL (valid for 5 minutes)
 * @param aeskeyBase64 - Base64-encoded AES key
 * @param filename - Display filename (used to name the temp file)
 * @param instanceId - For logging context
 * @returns Absolute path to the decrypted temp file
 */
async function downloadAndDecrypt(
  url: string,
  aeskeyBase64: string,
  filename: string,
  instanceId: string
): Promise<string> {
  // Ensure temp directory exists
  await mkdir(TEMP_DIR, { recursive: true })

  console.log(`[WecomBot:${instanceId}] Downloading media: ${filename} (url length=${url.length})`)
  const t0 = Date.now()

  // Download encrypted content
  const encryptedBuf = await httpGetBuffer(url)

  // Guard against empty responses (e.g., expired URL returning empty 200)
  if (encryptedBuf.length === 0) {
    throw new Error(`[WecomBot] Empty response downloading media: ${filename}`)
  }

  // Decrypt: AES-256-CBC, IV = first 16 bytes of key.
  // WeCom pads plaintext to 32-byte multiples (not standard 16-byte AES block size),
  // so padding values 17–32 are valid but rejected by Node's built-in PKCS#7 check.
  // Solution: disable auto-padding and strip manually.
  const aeskey = Buffer.from(aeskeyBase64, 'base64')
  const iv = aeskey.subarray(0, 16)
  const decipher = createDecipheriv('aes-256-cbc', aeskey, iv)
  decipher.setAutoPadding(false)
  const raw = Buffer.concat([decipher.update(encryptedBuf), decipher.final()])
  // Strip WeCom PKCS#7 padding (pad value ∈ [1, 32])
  const padLen = raw[raw.length - 1]
  if (padLen < 1 || padLen > 32) {
    throw new Error(`[WecomBot] Invalid padding byte: ${padLen} (expected 1–32)`)
  }
  const decrypted = raw.subarray(0, raw.length - padLen)

  // Write to temp file with a collision-safe name
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${filename}`
  const outPath = join(TEMP_DIR, safeName)
  await writeFile(outPath, decrypted)

  console.log(
    `[WecomBot:${instanceId}] Downloaded & decrypted: ${filename} → ${outPath} ` +
    `(${decrypted.length} bytes, ${Date.now() - t0}ms)`
  )
  return outPath
}

/**
 * Simple HTTPS GET → Buffer.
 * Follows redirects once (WeCom CDN may redirect).
 * Rejects on non-200 status or timeout (30 s).
 */
function httpGetBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doGet = (targetUrl: string, redirectsLeft: number) => {
      const req = https.get(targetUrl, (res) => {
        // Handle redirects
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirectsLeft > 0) {
          res.resume()
          console.log(`[WecomBot] HTTP redirect ${res.statusCode} → ${res.headers.location}`)
          doGet(res.headers.location, redirectsLeft - 1)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} downloading WeCom media from ${targetUrl}`))
          return
        }
        const chunks: Buffer[] = []
        let totalBytes = 0
        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length
          if (totalBytes > MAX_DOWNLOAD_BYTES) {
            req.destroy()
            reject(new Error(`WeCom media download exceeds ${MAX_DOWNLOAD_BYTES} bytes limit`))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      req.on('error', reject)
      req.setTimeout(30_000, () => {
        req.destroy()
        reject(new Error('WeCom media download timeout (30s)'))
      })
    }
    doGet(url, 3)
  })
}

// ============================================
// Media: Image Download Helper
// ============================================

/**
 * Download, decrypt, and prepare an image for both file attachment and
 * multimodal AI input.
 *
 * Returns null on failure (logged, not thrown) so callers can continue
 * processing remaining attachments without losing earlier successes.
 */
async function downloadAndPrepareImage(
  url: string,
  aeskey: string,
  instanceId: string
): Promise<{ attachment: InboundAttachment; image: ImageAttachment } | null> {
  try {
    const filename = `image_${Date.now()}.jpg`
    const localPath = await downloadAndDecrypt(url, aeskey, filename, instanceId)
    const imgBuf = await readFile(localPath)
    const imgExt = url.split('?')[0].split('.').pop()?.toLowerCase()
    const mimeMap: Record<string, ImageMediaType> = { png: 'image/png', gif: 'image/gif' }
    const mediaType: ImageMediaType = mimeMap[imgExt ?? ''] ?? 'image/jpeg'
    return {
      attachment: { type: 'image', filename, localPath, mimeType: 'image/jpeg' },
      image: {
        id: `wecom_img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'image',
        mediaType,
        data: imgBuf.toString('base64'),
        name: filename,
      },
    }
  } catch (err) {
    console.error(`[WecomBot:${instanceId}] Image download failed:`, err)
    return null
  }
}

// ============================================
// Streaming: Tool Icons & Formatting
// ============================================

/**
 * Built-in SDK tool icons (exact name match).
 * Keep this list to tools that have a meaningfully distinct icon.
 */
const BUILTIN_TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Edit: '✏️',
  Write: '📝',
  Bash: '⚙️',
  Glob: '🔍',
  Grep: '🔍',
  Agent: '🤖',
  Task: '🤖',
  WebFetch: '🌐',
  WebSearch: '🔎',
  TodoWrite: '📋',
  TodoRead: '📋',
  NotebookEdit: '📓',
  ExitPlanMode: '✅',
}

/**
 * Resolve the display icon for a tool.
 *
 * Priority:
 *   1. Exact match in BUILTIN_TOOL_ICONS (SDK built-ins)
 *   2. mcp__ai-browser__ prefix → all browser tools share one icon
 *   3. mcp__web-search__ prefix → search icon
 *   4. mcp__halo-* prefix → Halo internal tools
 *   5. Any other mcp__ prefix → generic tool icon
 *   6. Unknown → default gear
 */
function getToolIcon(toolName: string): string {
  if (BUILTIN_TOOL_ICONS[toolName]) return BUILTIN_TOOL_ICONS[toolName]
  if (toolName.startsWith('mcp__ai-browser__')) return '🌐'
  if (toolName.startsWith('mcp__web-search__')) return '🔎'
  if (toolName.startsWith('mcp__halo-')) return '🔧'
  if (toolName.startsWith('mcp__')) return '🔧'
  return '⚙️'
}

/** Format a ProgressEvent as a single line for display in the WeCom <think> block. */
function formatProgressLine(event: ProgressEvent): string {
  switch (event.type) {
    case 'tool_call': {
      const icon = getToolIcon(event.tool)
      const label = event.summary || event.tool
      return `${icon} ${label}`
    }
    case 'tool_result': {
      const icon = event.success ? '✅' : '❌'
      return `${icon} ${event.summary || (event.success ? 'Done' : 'Error')}`
    }
    case 'thinking':
      return `💭 ${event.text}`
    case 'status':
      return `ℹ️ ${event.text}`
    default:
      return ''
  }
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
// WecomStreamSession
// ============================================

/**
 * Manages a single streaming reply session for one user message.
 *
 * Accumulates progress events into a <think> block, then sends the combined
 * content (think block + answer text) as WeCom stream packets via WebSocket.
 *
 * Protocol: WeCom requires `stream.content` to be FULL accumulated content each
 * time (not a delta). Content is replaced on each packet update.
 *
 * Throttling: sends at most one packet per THROTTLE_MS to avoid client jank.
 * Content limit: enforces MAX_CONTENT_BYTES by evicting oldest progress lines.
 */
class WecomStreamSession implements StreamingHandle {
  private readonly streamId: string
  private readonly ws: WebSocket
  private readonly reqId: string
  private readonly instanceId: string

  private progressLines: string[] = []
  private answerText = ''
  private started = false
  private finished = false

  // Throttle state
  private throttleTimer: ReturnType<typeof setTimeout> | null = null
  private pendingFlush = false

  /** Called when this session is finished or disposed, so the instance can untrack it. */
  onDispose: (() => void) | null = null

  private static readonly THROTTLE_MS = 500
  // Leave ~480 bytes margin below the WeCom 20480 byte limit
  private static readonly MAX_CONTENT_BYTES = 20000

  constructor(ws: WebSocket, reqId: string, instanceId: string) {
    this.streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.ws = ws
    this.reqId = reqId
    this.instanceId = instanceId
  }

  // ── StreamingHandle interface ──────────────────────────────────

  async update(event: ProgressEvent): Promise<void> {
    if (this.finished) return

    if (event.type === 'text_delta') {
      this.answerText += event.text
    } else {
      const line = formatProgressLine(event)
      if (line) this.progressLines.push(line)
    }

    this.scheduleFlush()
  }

  async finish(finalText: string): Promise<void> {
    if (this.finished) return
    this.finished = true
    this.clearThrottle()

    this.answerText = finalText
    this.sendPacket(true)
    this.onDispose?.()
    console.log(`[WecomStream:${this.instanceId}] Stream finished (streamId=${this.streamId})`)
  }

  /**
   * Abort the stream without sending a final packet.
   * Called when the WebSocket disconnects before finish() — cleans up the
   * throttle timer to prevent resource leaks.
   */
  dispose(): void {
    if (this.finished) return
    this.finished = true
    this.clearThrottle()
    this.onDispose?.()
    console.log(`[WecomStream:${this.instanceId}] Stream disposed (streamId=${this.streamId})`)
  }

  // ── Internal ──────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.throttleTimer) {
      // A timer is already running; flag that we want another flush after it fires
      this.pendingFlush = true
      return
    }

    // Send immediately, then start the cooldown timer
    this.sendPacket(false)
    this.throttleTimer = setTimeout(() => {
      this.throttleTimer = null
      if (this.pendingFlush) {
        this.pendingFlush = false
        if (!this.finished) {
          this.sendPacket(false)
        }
      }
    }, WecomStreamSession.THROTTLE_MS)
  }

  private buildContent(): string {
    const thinkBlock = this.progressLines.length > 0
      ? `<think>\n${this.progressLines.join('\n')}\n</think>\n\n`
      : ''
    return thinkBlock + this.answerText
  }

  private sendPacket(finish: boolean): void {
    if (this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WecomStream:${this.instanceId}] WebSocket not open, skipping packet`)
      return
    }

    let content = this.buildContent()

    // Enforce byte limit — evict oldest progress lines from the top
    while (
      this.progressLines.length > 1 &&
      Buffer.byteLength(content, 'utf8') > WecomStreamSession.MAX_CONTENT_BYTES
    ) {
      this.progressLines.shift()
      const truncatedThink = `<think>\n...\n${this.progressLines.join('\n')}\n</think>\n\n`
      content = truncatedThink + this.answerText
    }

    const packet = {
      cmd: 'aibot_respond_msg',
      headers: { req_id: this.reqId },
      body: {
        msgtype: 'stream',
        stream: {
          id: this.streamId,
          finish,
          content,
        },
      },
    }

    if (!this.started) {
      this.started = true
      console.log(`[WecomStream:${this.instanceId}] First packet sent (streamId=${this.streamId})`)
    }

    try {
      this.ws.send(JSON.stringify(packet))
    } catch (err) {
      console.error(`[WecomStream:${this.instanceId}] Failed to send stream packet:`, err)
    }
  }

  private clearThrottle(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer)
      this.throttleTimer = null
    }
    this.pendingFlush = false
  }
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

/** Pending WebSocket request-response resolver */
interface PendingResponse {
  resolve: (msg: any) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** One message part collected during the debounce window */
interface BufferPart {
  body: string
  attachments: InboundAttachment[]
  images: ImageAttachment[]
  reqId: string
  from: string
  fromName: string | undefined
  chatId: string
  chatType: string
  msgId: string
}

/** Active debounce buffer for a single chat conversation */
interface ChatBuffer {
  parts: BufferPart[]
  timer: ReturnType<typeof setTimeout>
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

  /**
   * Pending request-response resolvers for WebSocket command pairs.
   * Used for upload protocol (init / chunk / complete) and future command RPCs.
   * Keyed by req_id so responses are matched back to their caller Promises.
   */
  private pendingResponses = new Map<string, PendingResponse>()

  /** Active stream sessions — disposed on WebSocket close to prevent timer leaks. */
  private activeStreamSessions = new Set<WecomStreamSession>()

  /** Debounce window (ms) for coalescing rapid consecutive messages from the same chat. */
  private static readonly DEBOUNCE_MS = 800

  /** Per-chatId debounce buffers — merges file + text messages sent in quick succession. */
  private chatBuffers = new Map<string, ChatBuffer>()

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
    // Reject all pending upload/command responses immediately on stop
    this.rejectAllPendingResponses(new Error('WecomBot instance stopped'))
    // Cancel any pending debounce buffers — drop buffered messages on stop
    for (const buffer of this.chatBuffers.values()) clearTimeout(buffer.timer)
    this.chatBuffers.clear()
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

  /**
   * Optional file-sending capability.
   * Bound to this instance so callers don't need to hold a reference to the instance.
   */
  readonly fileCapability: ImFileCapability = {
    sendFile: (chatId, filePath, chatType, filename) =>
      this.sendFileToChat(chatId, filePath, chatType, filename),
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

  // ── File: Upload & Send ────────────────────────────────────────

  /**
   * Upload a local file to WeCom via WebSocket chunked upload.
   *
   * Protocol: init → N chunks → complete → media_id
   *   - Each chunk ≤ 512 KB (before base64), max 100 chunks
   *   - Upload session valid for 30 minutes
   *   - media_id valid for 3 days
   *   - Frequency limit: 30 req/min, 1000 req/hr
   *
   * @param filePath - Absolute path to the local file
   * @param mediaType - WeCom media type ('file' | 'image' | 'voice' | 'video')
   * @param filename - Display filename (defaults to basename)
   * @returns media_id for use in message payloads
   */
  private async uploadMediaToWecom(
    filePath: string,
    mediaType: 'file' | 'image' | 'voice' | 'video',
    filename?: string
  ): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('[WecomBot] WebSocket not connected for upload')
    }

    const fileBuf = await readFile(filePath)
    const totalSize = fileBuf.length
    const displayName = filename || basename(filePath)
    const md5 = createHash('md5').update(fileBuf).digest('hex')
    const totalChunks = Math.ceil(totalSize / UPLOAD_CHUNK_SIZE)

    if (totalChunks > UPLOAD_MAX_CHUNKS) {
      throw new Error(
        `File too large for WeCom upload: ${totalChunks} chunks required (max ${UPLOAD_MAX_CHUNKS})`
      )
    }

    console.log(
      `[WecomBot:${this.instanceId}] Upload start: ${displayName}, ` +
      `${totalSize} bytes, ${totalChunks} chunk(s), type=${mediaType}`
    )

    // Step 1: Initialize upload session
    const initReqId = generateReqId('upload_init')
    const initResp = await this.sendAndWaitResponse(initReqId, {
      cmd: 'aibot_upload_media_init',
      headers: { req_id: initReqId },
      body: {
        type: mediaType,
        filename: displayName,
        total_size: totalSize,
        total_chunks: totalChunks,
        md5,
      },
    })

    const uploadId: string = initResp.body?.upload_id
    if (!uploadId) {
      throw new Error('[WecomBot] No upload_id returned from aibot_upload_media_init')
    }
    console.log(`[WecomBot:${this.instanceId}] Upload session: upload_id=${uploadId}`)

    // Step 2: Upload chunks (sequential for simplicity; WeCom supports out-of-order)
    for (let i = 0; i < totalChunks; i++) {
      const start = i * UPLOAD_CHUNK_SIZE
      const end = Math.min(start + UPLOAD_CHUNK_SIZE, totalSize)
      const chunkData = fileBuf.subarray(start, end).toString('base64')
      const chunkReqId = generateReqId(`upload_chunk_${i}`)
      await this.sendAndWaitResponse(chunkReqId, {
        cmd: 'aibot_upload_media_chunk',
        headers: { req_id: chunkReqId },
        body: { upload_id: uploadId, chunk_index: i, base64_data: chunkData },
      })
      console.log(
        `[WecomBot:${this.instanceId}] Upload chunk ${i + 1}/${totalChunks} sent (${end - start} bytes)`
      )
    }

    // Step 3: Finalize upload and get media_id
    const completeReqId = generateReqId('upload_finish')
    const completeResp = await this.sendAndWaitResponse(completeReqId, {
      cmd: 'aibot_upload_media_finish',
      headers: { req_id: completeReqId },
      body: { upload_id: uploadId },
    })

    const mediaId: string = completeResp.body?.media_id
    if (!mediaId) {
      throw new Error('[WecomBot] No media_id returned from aibot_upload_media_finish')
    }

    console.log(
      `[WecomBot:${this.instanceId}] Upload complete: ${displayName} → media_id=${mediaId}`
    )
    return mediaId
  }

  /**
   * Upload a local file and send it to a WeCom chat.
   *
   * Combines uploadMediaToWecom + message dispatch.
   * Uses aibot_respond_msg (passive reply) when a valid req_id is available,
   * falls back to aibot_send_msg (active push) otherwise.
   *
   * @param chatId - Target platform-side conversation ID
   * @param filePath - Absolute path to the local file
   * @param chatType - Conversation type
   * @param filename - Display filename (defaults to basename of filePath)
   * @returns true on success, false on recoverable failure
   */
  async sendFileToChat(
    chatId: string,
    filePath: string,
    chatType: 'direct' | 'group',
    filename?: string
  ): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WecomBot:${this.instanceId}] sendFileToChat: WebSocket not connected`)
      return false
    }

    try {
      const displayName = filename || basename(filePath)
      const ext = extname(filePath).toLowerCase()
      const mediaType: 'image' | 'file' = IMAGE_EXTENSIONS.has(ext) ? 'image' : 'file'

      const mediaId = await this.uploadMediaToWecom(filePath, mediaType, displayName)

      // Build the message body based on media type
      const msgBody = mediaType === 'image'
        ? { msgtype: 'image', image: { media_id: mediaId } }
        : { msgtype: 'file', file: { media_id: mediaId } }

      // Prefer passive reply (aibot_respond_msg) when a fresh req_id is available
      const entry = this.reqIdMap.get(chatId)
      const canReply = entry && (Date.now() - entry.ts < REQ_ID_TTL_MS)

      if (canReply) {
        this.ws.send(JSON.stringify({
          cmd: 'aibot_respond_msg',
          headers: { req_id: entry!.reqId },
          body: msgBody,
        }))
      } else {
        this.ws.send(JSON.stringify({
          cmd: 'aibot_send_msg',
          headers: { req_id: generateReqId('send_file') },
          body: {
            chatid: chatId,
            chat_type: chatType === 'direct' ? 1 : 2,
            ...msgBody,
          },
        }))
      }

      console.log(
        `[WecomBot:${this.instanceId}] File sent: ${displayName} → chat=${chatId} ` +
        `(via ${canReply ? 'respond' : 'push'})`
      )
      return true
    } catch (err) {
      console.error(
        `[WecomBot:${this.instanceId}] sendFileToChat failed: chatId=${chatId}`,
        err
      )
      return false
    }
  }

  // ── WebSocket: Request-Response RPC ───────────────────────────

  /**
   * Send a WebSocket message and wait for the matching response (matched by req_id).
   *
   * Used for upload protocol commands (init / chunk / complete).
   * Rejects on WeCom errcode ≠ 0 or after WS_REQUEST_TIMEOUT_MS.
   */
  private sendAndWaitResponse(reqId: string, message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(reqId)
        console.error(
          `[WecomBot:${this.instanceId}] Response timeout (${WS_REQUEST_TIMEOUT_MS}ms): reqId=${reqId}`
        )
        reject(new Error(`WeCom WebSocket response timeout for reqId=${reqId}`))
      }, WS_REQUEST_TIMEOUT_MS)

      this.pendingResponses.set(reqId, { resolve, reject, timer })

      try {
        this.ws!.send(JSON.stringify(message))
      } catch (err) {
        clearTimeout(timer)
        this.pendingResponses.delete(reqId)
        reject(err as Error)
      }
    })
  }

  /**
   * Reject all pending upload responses immediately.
   * Called on stop() to prevent dangling Promises.
   */
  private rejectAllPendingResponses(reason: Error): void {
    for (const [, pending] of this.pendingResponses) {
      clearTimeout(pending.timer)
      pending.reject(reason)
    }
    this.pendingResponses.clear()
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
      // Dispose active stream sessions — cleans up throttle timers that would
      // otherwise fire into a dead socket and leak closure references.
      this.activeStreamSessions.forEach(session => session.dispose())
      this.activeStreamSessions.clear()
      // Reject pending upload responses — they cannot complete after disconnect
      this.rejectAllPendingResponses(
        new Error(`WeCom WebSocket closed (code=${code}) — upload aborted`)
      )
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

    const reqId: string = msg.headers?.req_id ?? ''

    // ── Resolve pending upload/command responses FIRST ─────────────────────────
    // Upload protocol (init/chunk/complete) uses sendAndWaitResponse(). Match
    // by req_id before any other routing to avoid falling into the cmd switch.
    if (reqId) {
      const pending = this.pendingResponses.get(reqId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingResponses.delete(reqId)
        if (msg.errcode && msg.errcode !== 0) {
          console.error(
            `[WecomBot:${this.instanceId}] Command error: reqId=${reqId}, ` +
            `errcode=${msg.errcode}, errmsg=${msg.errmsg ?? 'unknown'}`
          )
          pending.reject(new Error(`WeCom error ${msg.errcode}: ${msg.errmsg ?? 'unknown'}`))
        } else {
          console.log(`[WecomBot:${this.instanceId}] Command OK: reqId=${reqId}`)
          pending.resolve(msg)
        }
        return
      }
    }

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
        // handleInboundMessage is async (media download). Fire-and-forget with
        // error logging — we must not block the WebSocket message handler.
        this.handleInboundMessage(msg).catch((err: Error) => {
          console.error(`[WecomBot:${this.instanceId}] handleInboundMessage error:`, err)
        })
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

  /**
   * Handle an inbound aibot_msg_callback message.
   *
   * For media messages (image / file / video), downloads and decrypts the
   * content within the 5-minute URL validity window BEFORE dispatching to the
   * inbound handler. Download failures are caught and logged; the message is
   * still delivered with a text-only fallback.
   *
   * Made async to support media download. Called fire-and-forget from handleMessage().
   */
  private async handleInboundMessage(msg: any): Promise<void> {
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

    // ── Download & decrypt media (image / file / video) ────────────────────────
    // Guard by url+aeskey presence, not chatType. WeCom docs say image/file/video
    // are "direct-chat only" but that likely means the server won't send them in group
    // context — if it does send url+aeskey, we should process regardless.
    // The 5-minute URL window means we MUST download here before returning.
    //
    // Each media item is processed independently — a failed download does not
    // discard already-downloaded attachments (per-item error isolation).
    const attachments: InboundAttachment[] = []
    const images: ImageAttachment[] = []

    if (msgType === 'image' && body.image?.url && body.image?.aeskey) {
      const result = await downloadAndPrepareImage(body.image.url, body.image.aeskey, this.instanceId)
      if (result) {
        attachments.push(result.attachment)
        images.push(result.image)
      }
    } else if (msgType === 'file' && body.file?.url && body.file?.aeskey) {
      try {
        const filename = body.file.filename || `file_${Date.now()}`
        const localPath = await downloadAndDecrypt(
          body.file.url, body.file.aeskey, filename, this.instanceId
        )
        attachments.push({ type: 'file', filename, localPath })
      } catch (err) {
        console.error(`[WecomBot:${this.instanceId}] File download failed:`, err)
      }
    } else if (msgType === 'video' && body.video?.url && body.video?.aeskey) {
      try {
        const filename = `video_${Date.now()}.mp4`
        const localPath = await downloadAndDecrypt(
          body.video.url, body.video.aeskey, filename, this.instanceId
        )
        attachments.push({ type: 'video', filename, localPath })
      } catch (err) {
        console.error(`[WecomBot:${this.instanceId}] Video download failed:`, err)
      }
    } else if (msgType === 'mixed' && body.mixed?.msg_item) {
      // mixed = mixed media (image+text): array of { msgtype, image?: { url, aeskey }, text?: { content } }
      const items: any[] = body.mixed.msg_item
      for (const item of items) {
        if (item.msgtype === 'image' && item.image?.url && item.image?.aeskey) {
          const result = await downloadAndPrepareImage(item.image.url, item.image.aeskey, this.instanceId)
          if (result) {
            attachments.push(result.attachment)
            images.push(result.image)
          }
        }
      }
    }

    const text = this.extractText(body)

    console.log(
      `[WecomBot:${this.instanceId}] Message received: chat=${chatId}, type=${chatType}, ` +
      `from=${senderName}, msgType=${msgType}, len=${text.length}, ` +
      `attachments=${attachments.length}, images=${images.length}`
    )

    // Buffer the part — debounce timer will merge + dispatch after DEBOUNCE_MS
    this.bufferMessage({
      body: text,
      attachments,
      images,
      reqId: reqId ?? '',
      from: senderId,
      fromName: senderName,
      chatId,
      chatType,
      msgId,
    })
  }

  /** Create a stream session and register it for cleanup on WS close. */
  private createTrackedStreamSession(reqId: string): WecomStreamSession {
    const session = new WecomStreamSession(this.ws!, reqId, this.instanceId)
    this.activeStreamSessions.add(session)
    session.onDispose = () => this.activeStreamSessions.delete(session)
    return session
  }

  private extractText(body: any): string {
    switch (body.msgtype) {
      case 'text': return body.text?.content ?? ''
      case 'image': return '(image)'
      case 'voice': return '(voice message)'
      case 'file': return `(file: ${body.file?.filename ?? 'unknown'})`
      case 'video': return '(video)'
      case 'link': return `(link: ${body.link?.title ?? body.link?.url ?? ''})`
      case 'mixed': {
        // Extract and join all text items from the mixed message
        const items: any[] = body.mixed?.msg_item ?? []
        const textParts = items
          .filter((item: any) => item.msgtype === 'text')
          .map((item: any) => (item.text?.content ?? '').trim())
          .filter(Boolean)
        return textParts.length > 0 ? textParts.join(' ') : '(mixed media)'
      }
      default: return `(${body.msgtype ?? 'unknown message type'})`
    }
  }

  // ── Debounce Buffer ───────────────────────────────────────────

  /**
   * Buffer an incoming message part and (re)start the debounce timer.
   *
   * Consecutive messages from the same chat arriving within DEBOUNCE_MS are
   * merged into a single InboundMessage before dispatch. This handles the
   * common pattern of a user sending a file immediately followed by a text
   * question — without buffering, those arrive as two separate AI sessions.
   */
  private bufferMessage(part: BufferPart): void {
    const existing = this.chatBuffers.get(part.chatId)
    if (existing) {
      clearTimeout(existing.timer)
      existing.parts.push(part)
      existing.timer = setTimeout(() => this.flushChatBuffer(part.chatId), WecomBotInstance.DEBOUNCE_MS)
    } else {
      const buffer: ChatBuffer = {
        parts: [part],
        timer: setTimeout(() => this.flushChatBuffer(part.chatId), WecomBotInstance.DEBOUNCE_MS),
      }
      this.chatBuffers.set(part.chatId, buffer)
    }
  }

  /**
   * Merge all buffered parts for a chat and dispatch as a single InboundMessage.
   *
   * Merges bodies (newline-separated), attachments, and images.
   * Uses the last part's req_id for streaming — it's the most recent and
   * has the longest remaining TTL within the 5-minute WeCom window.
   */
  private flushChatBuffer(chatId: string): void {
    const buffer = this.chatBuffers.get(chatId)
    this.chatBuffers.delete(chatId)
    if (!buffer || !this.inboundHandler) return

    const { parts } = buffer
    if (parts.length === 0) return

    const first = parts[0]
    const last = parts[parts.length - 1]

    const mergedBody = parts.map(p => p.body).filter(Boolean).join('\n')
    const mergedAttachments = parts.flatMap(p => p.attachments)
    const mergedImages = parts.flatMap(p => p.images)
    const chatTypeNorm: 'direct' | 'group' = first.chatType === 'group' ? 'group' : 'direct'

    console.log(
      `[WecomBot:${this.instanceId}] Debounce flush: ${parts.length} part(s) → ` +
      `chat=${chatId}, body="${mergedBody.slice(0, 80)}", ` +
      `attachments=${mergedAttachments.length}, images=${mergedImages.length}`
    )

    const inbound: InboundMessage = {
      body: mergedBody,
      from: first.from,
      fromName: first.fromName,
      channel: 'wecom-bot',
      chatType: chatTypeNorm,
      chatId,
      messageId: first.msgId,
      timestamp: Date.now(),
      ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
      ...(mergedImages.length > 0 ? { images: mergedImages } : {}),
    }

    const canStream = Boolean(last.reqId) && this.ws !== null && this.ws.readyState === WebSocket.OPEN
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

      streaming: canStream
        ? this.createTrackedStreamSession(last.reqId)
        : undefined,
    }

    this.inboundHandler(inbound, reply)
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
