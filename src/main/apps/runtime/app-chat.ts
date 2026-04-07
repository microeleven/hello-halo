/**
 * apps/runtime -- App Chat
 *
 * Interactive chat entry point for automation Apps.
 * Allows users to chat with an App's AI agent in real-time,
 * reusing the main Agent's full streaming capabilities via stream-processor.
 *
 * This is separate from execute.ts (scheduled runs):
 * - execute.ts:  Automated runs triggered by schedule/events, batch processing
 * - app-chat.ts: Interactive chat triggered by user, real-time streaming
 *
 * The V2 session is keyed by "app-chat:{appId}" for reuse across messages.
 * Messages are persisted to JSONL ({spacePath}/.halo/apps/{appId}/runs/chat.jsonl)
 * for reload recovery. Session IDs are persisted for SDK-level resume when the
 * V2 process is rebuilt (idle timeout, crash, config change).
 *
 * Design:
 * - Uses stream-processor.ts for all streaming logic (shared with main agent)
 * - Uses session-manager.ts for V2 session lifecycle (same reuse/invalidation)
 * - Sends renderer events via the virtual conversationId "app-chat:{appId}"
 * - Frontend subscribes to agent:* events filtered by this conversationId
 */

import { writeFile } from 'fs/promises'
import { join } from 'path'
import { getAppManager } from '../manager'
import { resolvePermission } from '../../../shared/apps/app-types'
import type { MemoryCallerScope } from '../../platform/memory'
import { getConfig } from '../../services/config.service'
import {
  getApiCredentials,
  getApiCredentialsForSource,
  getWorkingDir,
  getHeadlessElectronPath,
  getDbMcpServers
} from '../../services/agent/helpers'
import { emitAgentEvent } from '../../services/agent/events'
import { resolveCredentialsForSdk, buildBaseSdkOptions } from '../../services/agent/sdk-config'
import { createCanUseTool } from '../../services/agent/permission-handler'
import { createAIBrowserMcpServer, createScopedBrowserContext } from '../../services/ai-browser'
import type { BrowserContext } from '../../services/ai-browser/context'
import { processStream } from '../../services/agent/stream-processor'
import { buildMessageContent } from '../../services/agent/message-utils'
import {
  getOrCreateV2Session,
  closeV2Session,
  createSessionState,
  registerActiveSession,
  unregisterActiveSession,
  activeSessions
} from '../../services/agent/session-manager'
import { stopGeneration } from '../../services/agent/control'
import { buildAppChatSystemPrompt } from './prompt-chat'
import { mergeConfigWithDefaults } from './config-defaults'
import { createReportToolServer, type ReportToolContext } from './report-tool'
import { createNotifyToolServer } from './notify-tool'
import { createHaloAppsMcpServer } from '../conversation-mcp'
import { createWebSearchMcpServer } from '../../services/web-search'
import { getSpace } from '../../services/space.service'
import { openSessionWriter, readSessionMessages, saveChatSessionId, loadChatSessionId, deleteChatSessionId } from './session-store'
import { getAppMemoryService, getActivityStore } from './index'
import { createMemoryStatusMcpServer } from '../../platform/memory/snapshot'
// Key builders live in shared/ so the renderer can import them without
// depending on main-process modules.
import { getAppChatConversationId, buildImSessionKey } from '../../../shared/apps/im-keys'
export { getAppChatConversationId, buildImSessionKey }

// ============================================
// Types
// ============================================

/** Request parameters for sending a chat message to an App */
export interface AppChatRequest {
  /** App ID */
  appId: string
  /** Space ID (where the App is installed) */
  spaceId: string
  /** User's message text */
  message: string
  /** Optional image attachments (same format as main chat) */
  images?: Array<{ type: string; media_type: string; data: string }>
  /** Enable extended thinking mode */
  thinkingEnabled?: boolean
  /**
   * Optional callback invoked with the AI's final response text.
   * Used by external bridges (e.g., WeCom Bot) to auto-reply
   * the result back to the originating chat.
   */
  onReply?: (finalContent: string) => void
  /**
   * Optional override for the conversation/session ID.
   * When provided, this is used instead of the default "app-chat:{appId}".
   * Used by IM channel adapters to achieve per-chat session isolation:
   *   "app-chat:{appId}:{channel}:{chatType}:{chatId}"
   */
  conversationId?: string
}

// ============================================
// Constants
// ============================================

/** Fixed runId used for chat session JSONL storage */
const CHAT_RUN_ID = 'chat'


/**
 * Derive a storage-safe JSONL runId from a conversationId.
 *
 * - Halo native ("app-chat:{appId}") → "chat"
 * - IM channel ("app-chat:{appId}:wecom-bot:group:xxx") → "chat-wecom-bot-group-xxx"
 */
function deriveRunId(conversationId: string, appId: string): string {
  const defaultPrefix = `app-chat:${appId}`
  if (conversationId === defaultPrefix) {
    return CHAT_RUN_ID
  }
  // Strip "app-chat:{appId}:" prefix, replace colons with dashes
  const suffix = conversationId.slice(defaultPrefix.length + 1)
  return `chat-${suffix.replace(/:/g, '-')}`
}

/**
 * Scoped browser contexts for app chat sessions.
 * Each app chat gets its own context so activeViewId is isolated
 * from the user's browser and other concurrent sessions.
 * Cleaned up when the V2 session is closed (on error) or explicitly.
 */
const scopedContexts = new Map<string, BrowserContext>()

// ============================================
// Core
// ============================================

/**
 * Send a chat message to an automation App's AI agent.
 *
 * This provides real-time streaming with the same capabilities as the main
 * conversation agent: thinking, tool use, token tracking, interruption.
 *
 * The V2 session is reused across messages (keyed by "app-chat:{appId}"),
 * providing in-memory conversation continuity without session restart.
 *
 * @param request - Chat request parameters
 */
export async function sendAppChatMessage(
  request: AppChatRequest
): Promise<void> {
  const { appId, spaceId, message, images, thinkingEnabled, onReply } = request
  const conversationId = request.conversationId ?? getAppChatConversationId(appId)

  console.log(`[AppChat][${appId}] sendMessage: "${message.substring(0, 100)}"`)

  // ── 1. Resolve app + credentials ─────────────────────
  const manager = getAppManager()
  if (!manager) throw new Error('App services not initialized')

  const app = manager.getApp(appId)
  if (!app) throw new Error(`App not found: ${appId}`)

  const memory = getAppMemoryService()
  if (!memory) throw new Error('Memory service not initialized')

  const config = getConfig()
  const credentials = app.userOverrides?.modelSourceId
    ? await getApiCredentialsForSource(config, app.userOverrides.modelSourceId, app.userOverrides.modelId)
    : await getApiCredentials(config)
  const resolvedCreds = await resolveCredentialsForSdk(credentials)
  const electronPath = getHeadlessElectronPath()
  const workDir = getWorkingDir(spaceId)

  // ── 2. Build memory scope ────────────────────────────
  const memoryScope: MemoryCallerScope = {
    type: 'app',
    spaceId: app.spaceId!, // Automation apps always have a spaceId
    spacePath: getSpace(app.spaceId!)?.path ?? '',
    appId: app.id,
  }

  // ── 3. Build system prompt for interactive chat ──────
  const memoryInstructions = memory.getPromptInstructions()
  const usesAIBrowser = resolvePermission(app, 'ai-browser')

  // ── Merge config_schema defaults into userConfig ────
  const mergedConfig = mergeConfigWithDefaults(app.userConfig, app.spec.config_schema)

  const systemPrompt = buildAppChatSystemPrompt({
    appSpec: app.spec,
    memoryInstructions,
    userConfig: mergedConfig,
    usesAIBrowser,
    workDir,
    modelInfo: resolvedCreds.displayModel,
  })

  // ── 4. Build MCP servers ─────────────────────────────
  const memoryMcpServer = createMemoryStatusMcpServer(memoryScope)

  // Include user-installed external MCPs (same as regular space chat)
  const dbMcpServers = getDbMcpServers(spaceId)

  // Get or create scoped browser context for this chat session
  let scopedBrowserCtx: BrowserContext | undefined
  if (usesAIBrowser) {
    scopedBrowserCtx = scopedContexts.get(conversationId)
    if (!scopedBrowserCtx) {
      scopedBrowserCtx = createScopedBrowserContext(null)
      scopedContexts.set(conversationId, scopedBrowserCtx)
      console.log(`[AppChat][${appId}] Created scoped browser context`)
    }
  }

  // Notify tool: allows AI to send external notifications (email, WeCom, etc.)
  const notifyMcpServer = createNotifyToolServer({
    appId: app.id,
    appName: app.spec.name,
    runId: CHAT_RUN_ID,
  })

  // Report tool: allows AI to write activity entries in chat mode
  const activityStore = getActivityStore()
  const reportContext: ReportToolContext = {
    appId: app.id,
    appName: app.spec.name,
    runId: CHAT_RUN_ID,
    sessionKey: conversationId,
    notificationLevel: app.userOverrides?.notificationLevel,
    notifyChannels: (app.spec as any).output?.notify?.channels,
  }

  const mcpServers: Record<string, any> = {
    ...(dbMcpServers ?? {}),
    'halo-memory': memoryMcpServer,
    ...(activityStore ? { 'halo-report': createReportToolServer(activityStore, reportContext) } : {}),
    'halo-notify': notifyMcpServer,
    'halo-apps': createHaloAppsMcpServer(spaceId),
    'web-search': createWebSearchMcpServer(),
    ...(usesAIBrowser ? { 'ai-browser': createAIBrowserMcpServer(scopedBrowserCtx, workDir) } : {}),
  }
  console.log(`[AppChat][${appId}] MCP servers: [${Object.keys(mcpServers).join(', ')}], aiBrowser=${usesAIBrowser}`)

  // ── 5. Build SDK options ─────────────────────────────
  const abortController = new AbortController()
  const sessionState = createSessionState(spaceId, conversationId, abortController)

  const sdkOptions = buildBaseSdkOptions({
    credentials: resolvedCreds,
    workDir,
    electronPath,
    spaceId,
    conversationId,
    stderrHandler: (data: string) => {
      console.error(`[AppChat][${appId}] CLI stderr:`, data)
    },
    mcpServers,
  })

  // Override for app chat context
  sdkOptions.systemPrompt = systemPrompt

  // Non-native sessions (IM channels, etc.) are non-interactive — the user
  // cannot respond to interactive tool prompts, so deny them preemptively
  const defaultConvId = getAppChatConversationId(appId)
  if (conversationId !== defaultConvId) {
    sdkOptions.canUseTool = createCanUseTool({
      spaceId,
      conversationId,
      nonInteractive: true,
    })
  }

  // ── Resolve space path and run ID early (needed for both session resume and JSONL) ──
  const spacePath = getSpace(spaceId)?.path ?? ''
  const chatRunId = deriveRunId(conversationId, appId)

  try {
    const t0 = Date.now()

    // ── 6. Get or create V2 session (reused across messages) ──
    // Load saved sessionId for resume when V2 session is rebuilt after idle
    // timeout, process crash, or config change (same pattern as send-message.ts)
    const savedSessionId = spacePath
      ? loadChatSessionId(spacePath, appId, chatRunId)
      : undefined

    const v2Session = await getOrCreateV2Session(
      spaceId,
      conversationId,
      sdkOptions,
      savedSessionId,
      { aiBrowserEnabled: usesAIBrowser },
      workDir
    )

    registerActiveSession(conversationId, sessionState)

    // Set thinking tokens dynamically
    if (typeof v2Session.setMaxThinkingTokens === 'function') {
      try {
        await v2Session.setMaxThinkingTokens(thinkingEnabled ? 10240 : null)
      } catch (e) {
        console.error(`[AppChat][${appId}] Failed to set thinking tokens:`, e)
      }
    }

    console.log(`[AppChat][${appId}] V2 session ready: ${Date.now() - t0}ms`)

    // ── 7. Open session writer for JSONL persistence ──
    const sessionWriter = spacePath
      ? openSessionWriter(spacePath, appId, chatRunId)
      : undefined

    // Write user message to JSONL for reload recovery
    if (sessionWriter) {
      sessionWriter.writeTrigger(message)
    }

    // ── 8. Process stream ──────────────────────────────
    const messageContent = buildMessageContent(message, images)

    // Track the last assistant message's text content from raw SDK messages.
    // This is the authoritative source for IM replies — same principle as the JSONL
    // path used by AppChatView (readSessionMessages → extractTextContent).
    // Unlike processStream's internal lastTextContent which can be corrupted by
    // dual-path (stream_event + SDK message) state interference, this reads directly
    // from the SDK's output which is always correct.
    // See: stream-processor.ts TODO about lastTextContent pollution.
    let lastAssistantText = ''

    await processStream({
      v2Session,
      sessionState,
      spaceId,
      conversationId,
      messageContent,
      displayModel: resolvedCreds.displayModel,
      abortController,
      t0,
      callbacks: {
        onComplete: (streamResult) => {
          // Save session ID for future resumption (same pattern as send-message.ts).
          // When V2 session is rebuilt after idle timeout or process crash,
          // this allows the SDK to restore conversation history from disk.
          if (streamResult.capturedSessionId && spacePath) {
            saveChatSessionId(spacePath, appId, chatRunId, streamResult.capturedSessionId)
          }

          // App chat doesn't use conversation.service for storage.
          // Messages are persisted to JSONL via onRawMessage for reload.
          const replyContent = lastAssistantText || streamResult.finalContent
          console.log(
            `[AppChat][${appId}] Stream complete: ` +
            `content=${replyContent.length} chars` +
            `${lastAssistantText ? ' (from SDK message)' : ' (from streamResult)'}, ` +
            `thoughts=${streamResult.thoughts.length}, ` +
            `tokens=${streamResult.tokenUsage ? 'yes' : 'no'}`
          )

          // Invoke onReply callback for external bridges (WeCom Bot auto-reply)
          if (onReply && replyContent) {
            try {
              onReply(replyContent)
            } catch (replyErr) {
              console.error(`[AppChat][${appId}] onReply callback error:`, replyErr)
            }
          }
        },
        onRawMessage: (sdkMessage) => {
          // Persist SDK messages to JSONL for "View process" / reload recovery
          // stream_events are too granular for JSONL (hundreds per response)
          if (sessionWriter && sdkMessage.type !== 'stream_event') {
            sessionWriter.writeEvent(sdkMessage)
          }

          // Extract text from assistant messages for IM reply.
          // SDK assistant messages contain the complete, correct text blocks
          // (unlike processStream's stateful lastTextContent which can be corrupted).
          if (sdkMessage.type === 'assistant') {
            const content = sdkMessage.message?.content
            if (Array.isArray(content)) {
              const text = content
                .filter((b: any) => b.type === 'text' && b.text)
                .map((b: any) => b.text)
                .join('')
              if (text) lastAssistantText = text
            }
          }
        }
      }
    })

    console.log(`[AppChat][${appId}] Chat message processed successfully`)
  } catch (error: unknown) {
    const err = error as Error

    // Abort is expected (user stopped generation)
    if (err.name === 'AbortError' || abortController.signal.aborted) {
      console.log(`[AppChat][${appId}] Aborted by user`)
      return
    }

    console.error(`[AppChat][${appId}] Error:`, error)
    emitAgentEvent('agent:error', spaceId, conversationId, {
      type: 'error',
      error: err.message || 'Unknown error during app chat'
    })

    // Close session on error to force fresh session next time
    closeV2Session(conversationId)

    // Destroy scoped browser context on error for IM sessions only.
    // The native app-chat context (defaultConvId) is reused across messages — preserve it
    // so the next message can resume with the same browser state (cookies, session storage).
    // IM session contexts are per-conversation and can be recreated cheaply.
    const defaultConvId = getAppChatConversationId(appId)
    if (conversationId !== defaultConvId) {
      const ctx = scopedContexts.get(conversationId)
      if (ctx) {
        ctx.destroy()
        scopedContexts.delete(conversationId)
        console.log(`[AppChat][${appId}] IM scoped browser context destroyed (error)`)
      }
    }
  } finally {
    // Clean up active session (but keep V2 session for reuse)
    unregisterActiveSession(conversationId)

    // For IM sessions (not the native app-chat key), destroy scoped browser context
    // on successful completion. The native app-chat key reuses its context across messages,
    // but IM sessions can accumulate unboundedly — clean up to prevent memory leaks.
    const defaultConvId = getAppChatConversationId(appId)
    if (conversationId !== defaultConvId) {
      const ctx = scopedContexts.get(conversationId)
      if (ctx) {
        ctx.destroy()
        scopedContexts.delete(conversationId)
        console.log(`[AppChat][${appId}] IM scoped browser context destroyed (completion)`)
      }
    }

    console.log(`[AppChat][${appId}] Active session cleaned up`)
  }
}

/**
 * Stop an active app chat generation.
 *
 * Stops the native Halo chat session AND all IM channel sessions for this app.
 * Uses the same stop mechanism as the main agent (V2 session interrupt + drain).
 *
 * @param appId - App ID to stop chat for
 */
export async function stopAppChat(appId: string): Promise<void> {
  const prefix = getAppChatConversationId(appId)
  // Collect all conversation IDs belonging to this app:
  // - "app-chat:{appId}" (native chat)
  // - "app-chat:{appId}:{channel}:{chatType}:{chatId}" (IM sessions)
  const toStop = Array.from(activeSessions.keys()).filter(
    k => k === prefix || k.startsWith(prefix + ':')
  )
  for (const convId of toStop) {
    await stopGeneration(convId)
  }
  console.log(`[AppChat][${appId}] Generation stopped (${toStop.length} session(s))`)
}

/**
 * Check if an app chat session is currently generating.
 *
 * Returns true if the native chat OR any IM session for this app is active.
 *
 * @param appId - App ID to check
 */
export function isAppChatGenerating(appId: string): boolean {
  const prefix = getAppChatConversationId(appId)
  for (const key of activeSessions.keys()) {
    if (key === prefix || key.startsWith(prefix + ':')) return true
  }
  return false
}

/**
 * Load persisted chat messages for an app.
 *
 * Reads the JSONL file and converts to renderer-compatible Message[] format.
 * Returns empty array if no chat session exists.
 *
 * @param spacePath - Space directory path
 * @param appId - App ID
 */
export function loadAppChatMessages(spacePath: string, appId: string): any[] {
  return readSessionMessages(spacePath, appId, CHAT_RUN_ID)
}

/**
 * Load persisted chat messages for an IM session.
 *
 * Constructs the conversationId from IM session parameters, derives the
 * corresponding JSONL runId, and reads the persisted messages.
 *
 * @param spacePath - Space directory path
 * @param appId - App ID
 * @param channel - IM channel identifier (e.g., 'wecom-bot')
 * @param chatType - Conversation type ('direct' | 'group')
 * @param chatId - Platform-side conversation ID
 */
export function loadImChatMessages(
  spacePath: string,
  appId: string,
  channel: string,
  chatType: 'direct' | 'group',
  chatId: string
): any[] {
  const conversationId = buildImSessionKey(appId, channel, chatType, chatId)
  const runId = deriveRunId(conversationId, appId)
  return readSessionMessages(spacePath, appId, runId)
}

/**
 * Get session state for recovery after page refresh.
 *
 * @param appId - App ID
 */
export function getAppChatSessionState(appId: string): {
  isActive: boolean
  thoughts: any[]
  spaceId?: string
} {
  const conversationId = getAppChatConversationId(appId)
  const session = activeSessions.get(conversationId)
  if (!session) {
    return { isActive: false, thoughts: [] }
  }
  return {
    isActive: true,
    thoughts: [...session.thoughts],
    spaceId: session.spaceId
  }
}

/**
 * Clean up scoped browser context for an app chat session.
 * Call when deleting an app, resetting chat, or shutting down.
 *
 * @param appId - App ID
 */
export function cleanupAppChatBrowserContext(appId: string): void {
  const conversationId = getAppChatConversationId(appId)
  const ctx = scopedContexts.get(conversationId)
  if (ctx) {
    ctx.destroy()
    scopedContexts.delete(conversationId)
    console.log(`[AppChat][${appId}] Scoped browser context cleaned up`)
  }
}

// ============================================
// Session Clear (shared logic)
// ============================================

/**
 * Internal: clear a chat session by its conversationId.
 *
 * Shared by clearAppChat() and clearImSession(). Steps:
 * 1. If the session is actively generating, abort it first
 * 2. Close the V2 session (forces fresh session on next message)
 * 3. Destroy scoped browser context (if any)
 * 4. Empty the JSONL persistence file
 *
 * Idempotent: safe to call even if the session doesn't exist.
 */
async function clearSessionByConversationId(
  conversationId: string,
  appId: string,
  spaceId: string
): Promise<void> {
  // 1. Abort active generation (if any) before closing
  if (activeSessions.has(conversationId)) {
    console.log(`[AppChat][${appId}] Session is generating, aborting first...`)
    await stopGeneration(conversationId)
  }

  // 2. Close V2 session to force fresh session on next message
  closeV2Session(conversationId)

  // 3. Clean up scoped browser context
  const ctx = scopedContexts.get(conversationId)
  if (ctx) {
    ctx.destroy()
    scopedContexts.delete(conversationId)
    console.log(`[AppChat][${appId}] Scoped browser context cleaned up`)
  }

  // 4. Clear the JSONL file and saved sessionId
  const space = getSpace(spaceId)
  if (space?.path) {
    const runId = deriveRunId(conversationId, appId)
    const filePath = join(space.path, '.halo', 'apps', appId, 'runs', `${runId}.jsonl`)
    try {
      await writeFile(filePath, '', 'utf8')
    } catch {
      // File may not exist yet, that's fine
    }
    // Remove saved sessionId so next session starts truly fresh
    deleteChatSessionId(space.path, appId, runId)
  }
}

/**
 * Clear all chat history for an app's native Halo chat, resetting to a fresh session.
 * Aborts active generation, closes the V2 session, cleans up browser context,
 * and empties the JSONL file.
 *
 * @param appId - App ID
 * @param spaceId - Space ID (for resolving JSONL path)
 */
export async function clearAppChat(appId: string, spaceId: string): Promise<void> {
  const conversationId = getAppChatConversationId(appId)
  await clearSessionByConversationId(conversationId, appId, spaceId)
  console.log(`[AppChat][${appId}] Chat history cleared`)
}

/**
 * Clear an IM session's chat history, resetting to a fresh session.
 * Aborts active generation, closes the V2 session, cleans up browser context,
 * and empties the JSONL file.
 *
 * @param appId - App ID
 * @param spaceId - Space ID (for resolving JSONL path)
 * @param channel - IM channel identifier (e.g., 'wecom-bot')
 * @param chatType - Conversation type ('direct' | 'group')
 * @param chatId - Platform-side conversation ID
 */
export async function clearImSession(
  appId: string,
  spaceId: string,
  channel: string,
  chatType: 'direct' | 'group',
  chatId: string
): Promise<void> {
  const conversationId = buildImSessionKey(appId, channel, chatType, chatId)
  await clearSessionByConversationId(conversationId, appId, spaceId)
  console.log(`[AppChat][${appId}] IM session cleared: ${conversationId}`)
}
