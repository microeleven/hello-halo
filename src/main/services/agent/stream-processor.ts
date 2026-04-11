/**
 * Agent Module - Stream Processor
 *
 * Core stream processing logic extracted from send-message.ts.
 * Handles the V2 SDK session message stream including:
 * - Token-level streaming (text, thinking, tool_use blocks)
 * - Thought accumulation and tool result merging
 * - Session ID capture and MCP status broadcasting
 * - Token usage tracking
 * - Stream end handling with interrupt/error detection
 *
 * This module is caller-agnostic: both the main conversation agent
 * (send-message.ts) and the automation app runtime (execute.ts) use it,
 * providing caller-specific behavior via StreamCallbacks.
 */

import { is } from '@electron-toolkit/utils'
import type {
  Thought,
  ToolCall,
  TokenUsage,
  SingleCallUsage,
  SessionState
} from './types'
import { emitAgentEvent } from './events'
import {
  parseSDKMessage,
  extractSingleUsage,
  extractResultUsage
} from './message-utils'
import { broadcastMcpStatus } from './mcp-manager'
import {
  handleSubAgentMessage,
  handleTaskStarted,
  handleTaskProgress,
  handleTaskNotification,
  type SubAgentContext
} from './subagent-handler'
import { TRANSPARENT_TOOLS } from './constants'

// Unified fallback error suffix - guides user to check logs
const FALLBACK_ERROR_HINT = 'Check logs in Settings > System > Logs.'

// ============================================
// Types
// ============================================

/**
 * Callbacks for caller-specific behavior (storage, JSONL writing, etc.)
 *
 * The stream processor handles all streaming logic and renderer events.
 * Callers provide callbacks for their specific needs:
 * - Main agent: persists to conversation.service, saves session ID
 * - Automation: writes to JSONL via session-store
 */
export interface StreamCallbacks {
  /** Called once when stream finishes — caller handles storage.
   *  Optional: consumer-based callers handle persistence externally. */
  onComplete?(result: StreamResult): void
  /** Called for each raw SDK message (for JSONL persistence in automation) */
  onRawMessage?(sdkMessage: any): void
  /** Called when continuing for an injected mid-turn message.
   *  Caller should persist the user message to the conversation between turns.
   *  @deprecated Used only by legacy do-while loop path. Consumer handles injection externally. */
  onInjectionContinue?(userMessage: string): void
  /** Called when CC emits `system:init` — signals the start of a new turn.
   *  Consumer uses this to create the assistant placeholder message.
   *  Fires once per stream() call (first system:init only). */
  onTurnInit?(): void
}

/**
 * Result returned when stream processing finishes.
 * Contains all data needed by callers for post-stream handling.
 */
export interface StreamResult {
  /** Final text content (last text block or streaming fallback) */
  finalContent: string
  /** Accumulated thoughts (thinking, tool_use, tool_result, text, error, etc.) */
  thoughts: Thought[]
  /** Token usage from the result message */
  tokenUsage: TokenUsage | null
  /** Captured session ID (from system/result messages, for session persistence) */
  capturedSessionId?: string
  /** Whether the stream was interrupted (no result message or error_during_execution) */
  isInterrupted: boolean
  /** Whether the user aborted via AbortController */
  wasAborted: boolean
  /** Whether an error thought was received (e.g., rate limit, auth failure) */
  hasErrorThought: boolean
  /** The error thought itself, if any */
  errorThought?: Thought
  /** Whether the session hit the SDK's maxTurns limit (error_max_turns subtype) */
  reachedMaxTurns: boolean
  /** Whether at least one event was received in this stream() call */
  firstEventReceived: boolean
}

/**
 * Parameters for processStream.
 * All data needed to process a V2 SDK session stream.
 */
export interface ProcessStreamParams {
  /** The V2 SDK session (already created by caller) */
  v2Session: any
  /** Session state (holds thoughts array — shared with session-manager) */
  sessionState: SessionState
  /** Space ID for renderer event routing */
  spaceId: string
  /** Conversation ID for renderer event routing (can be virtual like "app-chat:{appId}") */
  conversationId: string
  /** Already-prepared message content (string or multi-modal content blocks).
   *  Optional: when using session-consumer, the consumer's caller sends directly
   *  and processStream only consumes the stream. */
  messageContent?: string | Array<{ type: string; [key: string]: unknown }>
  /** Display model name for thought parsing (user's configured model, not SDK internal) */
  displayModel: string
  /** Abort controller for cancellation */
  abortController: AbortController
  /** Timestamp of send start (for timing logs) */
  t0: number
  /** Strategy callbacks for caller-specific behavior */
  callbacks: StreamCallbacks
}

// ============================================
// Stream Processor
// ============================================

/**
 * Process the message stream from a V2 SDK session.
 *
 * This is the core streaming engine shared by both the main conversation agent
 * and the automation app runtime. It handles:
 * - Sending the message to the session
 * - Processing all stream_event types (thinking, text, tool_use blocks with deltas)
 * - Processing non-stream SDK messages (assistant, user, system, result)
 * - Emitting renderer events via emitAgentEvent for real-time UI updates
 * - Token usage tracking (per-call and cumulative)
 * - Session ID capture from system/result messages
 * - MCP status broadcasting
 * - Stream end handling with the complete interrupt/error truth table
 *
 * @param params - All parameters needed for stream processing
 * @returns StreamResult with final content, thoughts, token usage, and status flags
 */
export async function processStream(params: ProcessStreamParams): Promise<StreamResult> {
  const {
    v2Session,
    sessionState,
    spaceId,
    conversationId,
    messageContent,
    displayModel,
    abortController,
    t0,
    callbacks
  } = params

  // Only keep track of the LAST text block as the final reply
  // Intermediate text blocks are shown in thought process, not accumulated into message bubble
  //
  // TODO: lastTextContent can be corrupted by dual-path state interference.
  //   The for-await loop processes both stream_events (token-level SSE) and SDK messages
  //   (complete assistant/result messages). Both paths write to lastTextContent and share
  //   the hadSubstantiveToolSinceLastText flag. When parseSDKMessage (message-utils.ts)
  //   skips tool_use blocks for assistant messages, the SDK message path's text handler
  //   resets hadSubstantiveToolSinceLastText without the corresponding tool_use ever
  //   setting it — corrupting the stream_event path's merge/overwrite logic.
  //
  //   Current impact: IM channels (app-chat.ts) now bypass this by extracting text
  //   directly from raw SDK messages (same principle as JSONL → AppChatView path).
  //   Halo UI uses frontend delta accumulation (unaffected).
  //   The main chat path (send-message.ts) persists finalContent via updateLastMessage —
  //   investigate whether this path is also affected under certain provider/adapter configs.
  //
  //   Root fix options:
  //   - Skip SDK message path writes to shared state when stream_events are active
  //   - Make parseSDKMessage return tool_use thoughts for assistant messages
  //   - Separate state tracking per path
  let lastTextContent = ''

  // Authoritative final content locked at the SDK result thought.
  // Set exactly once when the result message arrives. Unlike lastTextContent, this variable
  // is never touched after the result thought, so subsequent stream_events (e.g. a trailing
  // content_block_stop that re-fires after the result) cannot corrupt it.
  //
  // Note: this only protects against POST-result corruption. If lastTextContent is already
  // wrong at result time (due to the dual-path issue above), lockedFinalContent locks a bad value.
  // IM channels have a separate fix (see app-chat.ts lastAssistantText).
  let lockedFinalContent = ''

  let capturedSessionId: string | undefined

  // Token usage tracking
  // lastSingleUsage: Last API call usage (single call, represents current context size)
  let lastSingleUsage: SingleCallUsage | null = null
  let tokenUsage: TokenUsage | null = null

  // Token-level streaming state
  let currentStreamingText = ''  // Accumulates text_delta tokens
  let isStreamingTextBlock = false  // True when inside a text content block
  const STREAM_THROTTLE_MS = 30  // Throttle updates to ~33fps

  // Track if SDK reported error_during_execution (for interrupted detection)
  let hadErrorDuringExecution = false
  // Track if SDK reported error_max_turns (session hit the configured maxTurns limit)
  let hadMaxTurnsReached = false
  // Track if we received a result message (for detecting stream interruption)
  let receivedResult = false

  // [TEAM-DEBUG] Diagnostic tracking for post-result stream behavior
  let resultReceivedAt: number | null = null  // Timestamp when first result arrived
  let postResultEventCount = 0               // Events received AFTER result
  let loopIterationCount = 0                 // Total loop iterations

  // Text block merge strategy:
  // AI sometimes splits its final reply across consecutive text blocks. We merge them.
  // A "substantive" tool_use breaks continuity — text before it is transitional
  // ("let me do X…") and should not appear in the final bubble.
  // TRANSPARENT_TOOLS are bookkeeping/coordination-only and do NOT break continuity.
  // See services/agent/constants.ts for the authoritative list.
  //
  // When true, the next text block overwrites; when false, it appends.
  let hadSubstantiveToolSinceLastText = false

  // Streaming block state - track active blocks by index for delta/stop correlation
  // Key: block index, Value: { type, thoughtId, content/partialJson }
  const streamingBlocks = new Map<number, {
    type: 'thinking' | 'tool_use'
    thoughtId: string
    content: string  // For thinking: accumulated thinking text, for tool_use: accumulated partial JSON
    toolName?: string
    toolId?: string
  }>()

  // Tool ID to Thought ID mapping - for merging tool_result into tool_use
  const toolIdToThoughtId = new Map<string, string>()

  const t1 = Date.now()

  // Send the message if provided (legacy callers pass messageContent;
  // consumer-based callers send directly and pass no messageContent).
  if (messageContent != null) {
    console.log(`[Agent][${conversationId}] Sending message to V2 session...`)
    if (typeof messageContent === 'string') {
      v2Session.send(messageContent)
    } else {
      const userMessage = {
        type: 'user' as const,
        message: {
          role: 'user' as const,
          content: messageContent
        }
      }
      v2Session.send(userMessage as any)
    }
  } else {
    console.log(`[Agent][${conversationId}] Consuming stream (no send — consumer mode)...`)
  }

  // Track whether any event was received in this stream() call
  let firstEventFired = false
  // Track whether onTurnInit has been called (once per stream() call)
  let turnInitFired = false

  // Stream messages from V2 session
  // Single-turn stream consumption: process events until stream() completes.
  // The consumer's outer loop handles turn boundaries and re-entering stream().
  for await (const sdkMessage of v2Session.stream()) {
    loopIterationCount++

    // Track first event for no-event detection
    if (!firstEventFired) {
      firstEventFired = true
    }

    // Detect CC's system:init — the official turn boundary signal.
    // Fires once per stream() call; consumer uses this to create assistant placeholder.
    if (!turnInitFired && sdkMessage.type === 'system' && (sdkMessage as any).subtype === 'init') {
      turnInitFired = true
      if (callbacks.onTurnInit) {
        callbacks.onTurnInit()
      }
    }

    // Handle abort - check this session's controller
    if (abortController.signal.aborted) {
      console.log(`[Agent][${conversationId}] Aborted`)
      break
    }

    // [TEAM-DEBUG] Log every message that arrives AFTER result to understand SDK stream lifecycle
    if (resultReceivedAt !== null) {
      const msSinceResult = Date.now() - resultReceivedAt
      const subtype = (sdkMessage as any).subtype ?? ''
      const parentId = (sdkMessage as any).parent_tool_use_id ?? null
      postResultEventCount++
      console.log(
        `[TEAM-DEBUG][${conversationId}] POST-RESULT event #${postResultEventCount}` +
        ` +${msSinceResult}ms | type=${sdkMessage.type}${subtype ? ` subtype=${subtype}` : ''}` +
        `${parentId ? ` parent=${String(parentId).slice(0, 8)}` : ''}`
      )
    }

    // Notify caller of raw SDK message (for JSONL persistence in automation)
    if (callbacks.onRawMessage) {
      callbacks.onRawMessage(sdkMessage)
    }

    // Handle stream_event for token-level streaming (text only)
    if (sdkMessage.type === 'stream_event') {
      const event = (sdkMessage as any).event
      if (!event) continue

      // DEBUG: Log all stream events with timestamp (ms since send)
      const elapsed = Date.now() - t1
      // For message_start, log the full event to see if it contains content structure hints
      if (event.type === 'message_start') {
        if (is.dev) {
          console.log(`[Agent][${conversationId}] 🔴 +${elapsed}ms message_start FULL:`, JSON.stringify(event))
        }
      } else {
        // console.log(`[Agent][${conversationId}] 🔴 +${elapsed}ms stream_event:`, JSON.stringify({
        //   type: event.type,
        //   index: event.index,
        //   content_block: event.content_block,
        //   delta: event.delta
        // }))
      }

      // Text block started
      if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
        isStreamingTextBlock = true
        const blockText = event.content_block.text || ''

        if (hadSubstantiveToolSinceLastText) {
          // A substantive tool occurred — previous text was transitional, start fresh
          currentStreamingText = blockText
          hadSubstantiveToolSinceLastText = false
        } else {
          // Consecutive text block (or only transparent tools in between) — append
          if (currentStreamingText) {
            currentStreamingText += '\n\n' + blockText
          } else {
            currentStreamingText = blockText
          }
        }

        // 🔑 Send precise signal for new text block (fixes truncation bug)
        // This is 100% reliable - comes directly from SDK's content_block_start event
        emitAgentEvent('agent:message', spaceId, conversationId, {
          type: 'message',
          content: '',
          isComplete: false,
          isStreaming: false,
          isNewTextBlock: true  // Signal: new text block started
        })

      }

      // ========== Thinking block streaming ==========
      // Thinking block started - send empty thought immediately
      if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
        const blockIndex = event.index ?? 0
        const thoughtId = `thought-thinking-${Date.now()}-${blockIndex}`

        // Track this block for delta correlation
        streamingBlocks.set(blockIndex, {
          type: 'thinking',
          thoughtId,
          content: ''
        })

        // Create and send streaming thought immediately
        const thought: Thought = {
          id: thoughtId,
          type: 'thinking',
          content: '',
          timestamp: new Date().toISOString(),
          isStreaming: true
        }

        // Add to session state
        sessionState.thoughts.push(thought)

        // Send to renderer for immediate display
        emitAgentEvent('agent:thought', spaceId, conversationId, { thought })
      }

      // Thinking delta - append to thought content
      if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
        const blockIndex = event.index ?? 0
        const blockState = streamingBlocks.get(blockIndex)

        if (blockState && blockState.type === 'thinking') {
          const delta = event.delta.thinking || ''
          blockState.content += delta

          // Send delta to renderer for incremental update
          emitAgentEvent('agent:thought-delta', spaceId, conversationId, {
            thoughtId: blockState.thoughtId,
            delta,
            content: blockState.content  // Also send full content for fallback
          })
        }
      }

      // Text delta - accumulate locally, send delta to frontend
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && isStreamingTextBlock) {
        const delta = event.delta.text || ''
        currentStreamingText += delta

        // Send delta immediately without throttling
        emitAgentEvent('agent:message', spaceId, conversationId, {
          type: 'message',
          delta,
          isComplete: false,
          isStreaming: true
        })
      }

      // ========== Tool use block streaming ==========
      // Tool use block started - send thought with tool name immediately
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        const blockIndex = event.index ?? 0
        const toolId = event.content_block.id || `tool-${Date.now()}`
        const toolName = event.content_block.name || 'Unknown'
        const thoughtId = `thought-tool-${Date.now()}-${blockIndex}`

        // Mark substantive tool — breaks text continuity (transparent tools like TodoWrite do not)
        if (!TRANSPARENT_TOOLS.has(toolName)) {
          hadSubstantiveToolSinceLastText = true
        }

        // Track this block for delta correlation
        streamingBlocks.set(blockIndex, {
          type: 'tool_use',
          thoughtId,
          content: '',  // Will accumulate partial JSON
          toolName,
          toolId
        })

        // Create and send streaming tool thought immediately
        const thought: Thought = {
          id: thoughtId,
          type: 'tool_use',
          content: '',
          timestamp: new Date().toISOString(),
          toolName,
          toolInput: {},  // Empty initially, will be populated on stop
          isStreaming: true,
          isReady: false  // Params not complete yet
        }

        // Add to session state
        sessionState.thoughts.push(thought)

        // Send to renderer for immediate display (shows tool name, "准备中...")
        emitAgentEvent('agent:thought', spaceId, conversationId, { thought })

        // Agent Team: detect Agent tool_use with name + team_name (team mode spawn)
        // Note: full input JSON is not available yet at content_block_start,
        // so team spawn detection is deferred to content_block_stop when input is parsed.
        // We track the toolId here so we can check when the block completes.
      }

      // Tool use input JSON delta - accumulate partial JSON
      if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        const blockIndex = event.index ?? 0
        const blockState = streamingBlocks.get(blockIndex)

        if (blockState && blockState.type === 'tool_use') {
          const partialJson = event.delta.partial_json || ''
          blockState.content += partialJson

          // Send delta to renderer (for progress indication, not for parsing)
          emitAgentEvent('agent:thought-delta', spaceId, conversationId, {
            thoughtId: blockState.thoughtId,
            delta: partialJson,
            isToolInput: true  // Flag: this is tool input JSON, not thinking text
          })
        }
      }

      // ========== Block stop handling ==========
      // content_block_stop - finalize streaming blocks
      if (event.type === 'content_block_stop') {
        const blockIndex = event.index ?? 0
        const blockState = streamingBlocks.get(blockIndex)

        if (blockState) {
          if (blockState.type === 'thinking') {
            // Thinking block complete - send final state
            emitAgentEvent('agent:thought-delta', spaceId, conversationId, {
              thoughtId: blockState.thoughtId,
              content: blockState.content,
              isComplete: true  // Signal: thinking is complete
            })

            // Update session state thought
            const thought = sessionState.thoughts.find((t: Thought) => t.id === blockState.thoughtId)
            if (thought) {
              thought.content = blockState.content
              thought.isStreaming = false
            }

            console.log(`[Agent][${conversationId}] Thinking block complete, length: ${blockState.content.length}`)
          } else if (blockState.type === 'tool_use') {
            // Tool use block complete - parse JSON and send final state
            let toolInput: Record<string, unknown> = {}
            try {
              if (blockState.content) {
                toolInput = JSON.parse(blockState.content)
              }
            } catch (e) {
              console.error(`[Agent][${conversationId}] Failed to parse tool input JSON:`, e)
            }

            // Record mapping for merging tool_result later
            if (blockState.toolId) {
              toolIdToThoughtId.set(blockState.toolId, blockState.thoughtId)
            }

            // Send complete signal with parsed input
            emitAgentEvent('agent:thought-delta', spaceId, conversationId, {
              thoughtId: blockState.thoughtId,
              toolInput,
              isComplete: true,  // Signal: tool params are complete
              isReady: true,     // Tool is ready for execution
              isToolInput: true  // Flag: this is tool input completion (triggers isReady update in frontend)
            })

            // Update session state thought
            const thought = sessionState.thoughts.find((t: Thought) => t.id === blockState.thoughtId)
            if (thought) {
              thought.toolInput = toolInput
              thought.isStreaming = false
              thought.isReady = true
            }

            // Send tool-call event for tool approval/tracking
            // This replaces the event that was previously sent from parseSDKMessage
            const toolCall: ToolCall = {
              id: blockState.toolId || blockState.thoughtId,
              name: blockState.toolName || '',
              status: 'running',
              input: toolInput
            }
            emitAgentEvent('agent:tool-call', spaceId, conversationId, toolCall as unknown as Record<string, unknown>)

            if (is.dev) {
              console.log(`[Agent][${conversationId}] Tool block complete [${blockState.toolName}], input: ${JSON.stringify(toolInput).substring(0, 100)}`)
            }
          }

          // Clean up tracking state
          streamingBlocks.delete(blockIndex)
        }

        // Handle text block stop (existing logic)
        if (isStreamingTextBlock) {
          isStreamingTextBlock = false
          // Send final content of this block (full accumulated text including merged blocks)
          emitAgentEvent('agent:message', spaceId, conversationId, {
            type: 'message',
            content: currentStreamingText,
            isComplete: false,
            isStreaming: false
          })
          // Update lastTextContent — currentStreamingText already contains merged consecutive blocks
          lastTextContent = currentStreamingText
          console.log(`[Agent][${conversationId}] Text block completed, length: ${currentStreamingText.length}`)
        }
      }

      continue  // stream_event handled, skip normal processing
    }

    // ========== Sub-agent message routing ==========
    // SDK emits sub-agent assistant/user messages with parent_tool_use_id set.
    // Route these to the dedicated handler — they must NOT enter the main agent
    // processing path (which expects stream_event-created tool_use thoughts).
    const parentToolUseId = (sdkMessage as any).parent_tool_use_id as string | null | undefined
    if (parentToolUseId != null && (sdkMessage.type === 'assistant' || sdkMessage.type === 'user')) {
      const subCtx: SubAgentContext = { spaceId, conversationId, sessionState, toolIdToThoughtId }
      handleSubAgentMessage(sdkMessage, parentToolUseId, subCtx)
      continue  // Sub-agent message handled, skip main processing
    }

    // DEBUG: Log all SDK messages with timestamp
    const elapsed = Date.now() - t1
    console.log(`[Agent] SDK messages [${conversationId}] 🔵 +${elapsed}ms ${sdkMessage.type}:`,
      JSON.stringify(sdkMessage, null, 2)
    )

    // Extract single API call usage from assistant message (represents current context size)
    if (sdkMessage.type === 'assistant') {
      const usage = extractSingleUsage(sdkMessage)
      if (usage) {
        lastSingleUsage = usage
      }
    }

    // Parse SDK message into Thought and send to renderer
    // Pass credentials.model to display the user's actual configured model
    const thought = parseSDKMessage(sdkMessage, displayModel)

    if (thought) {
      // Handle tool_result specially - merge into corresponding tool_use thought
      if (thought.type === 'tool_result') {
        const toolUseThoughtId = toolIdToThoughtId.get(thought.id)
        if (toolUseThoughtId) {
          // Found corresponding tool_use - merge result into it
          const toolResult = {
            output: thought.toolOutput || '',
            isError: thought.isError || false,
            timestamp: thought.timestamp
          }

          // Update backend session state
          const toolUseThought = sessionState.thoughts.find((t: Thought) => t.id === toolUseThoughtId)
          if (toolUseThought) {
            toolUseThought.toolResult = toolResult
          }

          // Send thought-delta to merge result into tool_use on frontend
          emitAgentEvent('agent:thought-delta', spaceId, conversationId, {
            thoughtId: toolUseThoughtId,
            toolResult,
            isToolResult: true  // Flag: this is a tool result merge
          })

          // Still send tool-result event for any listeners
          emitAgentEvent('agent:tool-result', spaceId, conversationId, {
            type: 'tool_result',
            toolId: thought.id,
            result: thought.toolOutput || '',
            isError: thought.isError || false
          })

          console.log(`[Agent][${conversationId}] Tool result merged into thought ${toolUseThoughtId}`)
        } else {
          // No mapping found - fall back to separate thought (shouldn't happen normally)
          sessionState.thoughts.push(thought)
          emitAgentEvent('agent:thought', spaceId, conversationId, { thought })
          emitAgentEvent('agent:tool-result', spaceId, conversationId, {
            type: 'tool_result',
            toolId: thought.id,
            result: thought.toolOutput || '',
            isError: thought.isError || false
          })
          console.log(`[Agent][${conversationId}] Tool result fallback (no mapping): ${thought.id}`)
        }
      } else {
        // Non tool_result thoughts - handle normally
        // Accumulate thought in backend session (Single Source of Truth)
        sessionState.thoughts.push(thought)

        // Send ALL thoughts to renderer for real-time display in thought process area
        // This includes text blocks - they appear in the timeline during generation
        emitAgentEvent('agent:thought', spaceId, conversationId, { thought })

        // Handle specific thought types
        if (thought.type === 'text') {
          // Merge consecutive text blocks: append if no substantive tool in between
          if (hadSubstantiveToolSinceLastText || !lastTextContent) {
            lastTextContent = thought.content
            hadSubstantiveToolSinceLastText = false
          } else {
            // Consecutive text (or only transparent tools like TodoWrite in between) — append
            lastTextContent += '\n\n' + thought.content
          }

          // Send streaming update - frontend shows this during generation
          emitAgentEvent('agent:message', spaceId, conversationId, {
            type: 'message',
            content: lastTextContent,
            isComplete: false
          })
        } else if (thought.type === 'tool_use') {
          // Mark substantive tool — breaks text continuity
          if (!TRANSPARENT_TOOLS.has(thought.toolName || '')) {
            hadSubstantiveToolSinceLastText = true
          }
          // Send tool call event
          const toolCall: ToolCall = {
            id: thought.id,
            name: thought.toolName || '',
            status: 'running',
            input: thought.toolInput || {}
          }
          emitAgentEvent('agent:tool-call', spaceId, conversationId, toolCall as unknown as Record<string, unknown>)
        } else if (thought.type === 'error') {
          // SDK reported an error (rate_limit, authentication_failed, etc.)
          // Send error to frontend - user should see the actual error from provider
          console.log(`[Agent][${conversationId}] Error thought received: ${thought.content}`)
          emitAgentEvent('agent:error', spaceId, conversationId, {
            type: 'error',
            error: thought.content,
            errorCode: thought.errorCode  // Preserve error code for debugging
          })
        } else if (thought.type === 'result') {
          // Final result - use the last text block as the final reply
          const finalContent = lastTextContent || thought.content
          // Lock the final content now. lastTextContent is correct at this moment, but the stream
          // loop may continue after the result thought and overwrite it with trailing events.
          // lockedFinalContent captures the value here and is never written again.
          lockedFinalContent = finalContent
          emitAgentEvent('agent:message', spaceId, conversationId, {
            type: 'message',
            content: finalContent,
            isComplete: true
          })
          // Fallback: if no text block was received, use result content for persistence
          if (!lastTextContent && thought.content) {
            lastTextContent = thought.content
          }
          // Note: updateLastMessage is called after loop to include tokenUsage
          console.log(`[Agent][${conversationId}] Result thought received, ${sessionState.thoughts.length} thoughts accumulated`)
        }
      }
    }

    // Capture session ID and MCP status from system/result messages
    // Use type assertion for SDK message properties that may vary
    const msg = sdkMessage as Record<string, unknown>
    if (sdkMessage.type === 'system') {
      const subtype = msg.subtype as string | undefined
      const sessionIdFromMsg = msg.session_id || (msg.message as Record<string, unknown>)?.session_id
      if (sessionIdFromMsg) {
        capturedSessionId = sessionIdFromMsg as string
        console.log(`[Agent][${conversationId}] Captured session ID:`, capturedSessionId)
      }

      // Handle compact_boundary - context compression notification
      if (subtype === 'compact_boundary') {
        const compactMetadata = msg.compact_metadata as { trigger: 'manual' | 'auto'; pre_tokens: number } | undefined
        if (compactMetadata) {
          console.log(`[Agent][${conversationId}] Context compressed: trigger=${compactMetadata.trigger}, pre_tokens=${compactMetadata.pre_tokens}`)
          // Send compact notification to renderer
          emitAgentEvent('agent:compact', spaceId, conversationId, {
            type: 'compact',
            trigger: compactMetadata.trigger,
            preTokens: compactMetadata.pre_tokens
          })
        }
      }

      // Extract MCP server status and tools list from system message
      // SDKSystemMessage includes mcp_servers: { name: string; status: string }[]
      // and tools: string[] (flat list of all available tool names)
      const mcpServers = msg.mcp_servers as Array<{ name: string; status: string }> | undefined
      const tools = msg.tools as string[] | undefined

      if (mcpServers && mcpServers.length > 0) {
        if (is.dev) {
          console.log(`[Agent][${conversationId}] MCP server status:`, JSON.stringify(mcpServers))
          if (tools) console.log(`[Agent][${conversationId}] Available tools: ${tools.length}`)
        }
        // Broadcast MCP status + tools to frontend (global event, not conversation-specific)
        broadcastMcpStatus(mcpServers, tools)
      }

      // Task lifecycle events — update sub-agent progress + forward to Agent Team
      if (subtype === 'task_started' || subtype === 'task_progress' || subtype === 'task_notification') {
        const subCtx: SubAgentContext = { spaceId, conversationId, sessionState, toolIdToThoughtId }

        // Update the Task thought's taskProgress for sub-agent timeline display
        if (subtype === 'task_started') {
          handleTaskStarted(msg, subCtx)
        } else if (subtype === 'task_progress') {
          handleTaskProgress(msg, subCtx)
        } else {
          handleTaskNotification(msg, subCtx)
        }
      }

      // Forward slash_commands / skills / agents to renderer for input autocomplete.
      // These are only present on the init subtype message.
      if (subtype === 'init') {
        const sdkSlashCommands = msg.slash_commands as string[] | undefined
        const sdkSkills = msg.skills as string[] | undefined
        const sdkAgents = msg.agents as string[] | undefined
        if (sdkSlashCommands || sdkSkills || sdkAgents) {
          emitAgentEvent('agent:session-info', spaceId, conversationId, {
            slashCommands: sdkSlashCommands ?? [],
            skills: sdkSkills ?? [],
            agents: sdkAgents ?? []
          })
        }
      }
    } else if (sdkMessage.type === 'result') {
      receivedResult = true  // Mark that we received a result message
      resultReceivedAt = Date.now()

      // [TEAM-DEBUG] Snapshot active team agents at result time
      const teamThoughts = sessionState.thoughts.filter(
        t => t.type === 'tool_use' && t.toolName === 'Agent' && (t.toolInput as any)?.team_name
      )
      if (teamThoughts.length > 0) {
        const summary = teamThoughts.map(t =>
          `${(t.toolInput as any)?.name ?? '?'}(${t.taskProgress?.status ?? 'no-task-started'})`
        ).join(', ')
        console.log(
          `[TEAM-DEBUG][${conversationId}] result received at iteration #${loopIterationCount}` +
          ` | team agents: [${summary}]` +
          ` | subtype=${(sdkMessage as any).subtype ?? 'success'}`
        )
      } else {
        console.log(
          `[TEAM-DEBUG][${conversationId}] result received at iteration #${loopIterationCount}` +
          ` | no team agents in session` +
          ` | subtype=${(sdkMessage as any).subtype ?? 'success'}`
        )
      }

      if (!capturedSessionId) {
        const sessionIdFromMsg = msg.session_id || (msg.message as Record<string, unknown>)?.session_id
        capturedSessionId = sessionIdFromMsg as string
      }

      // Check for error_during_execution (interrupted) vs real errors
      // Note: Real API errors (is_error=true) are already handled by parseSDKMessage above
      // which creates an error thought and triggers agent:error via the thought.type === 'error' branch
      const isError = (sdkMessage as any).is_error === true
      if (isError) {
        const errors = (sdkMessage as any).errors as unknown[] | undefined
        console.log(`[Agent][${conversationId}] ⚠️ SDK error (is_error=${isError}, errors=${errors?.length || 0}): ${((sdkMessage as any).result || '').substring(0, 200)}`)
      } else if ((sdkMessage as any).subtype === 'error_during_execution') {
        // Mark as interrupted - will be used for empty response handling
        hadErrorDuringExecution = true
        console.log(`[Agent][${conversationId}] SDK result subtype=error_during_execution but is_error=false, errors=[] - marked as interrupted`)
      } else if ((sdkMessage as any).subtype === 'error_max_turns') {
        // Session hit the configured maxTurns limit - this is a graceful SDK termination,
        // not an error. Track it so we can show a clear message instead of "empty response".
        hadMaxTurnsReached = true
        console.log(`[Agent][${conversationId}] SDK result subtype=error_max_turns, num_turns=${(sdkMessage as any).num_turns} - session reached turn limit`)
      }

      // Extract token usage from result message
      tokenUsage = extractResultUsage(msg, lastSingleUsage)
      if (tokenUsage) {
        console.log(`[Agent][${conversationId}] Token usage (single API):`, tokenUsage)
      }
    }
  }

  // ========== Stream End Handling ==========
  //
  // Error conditions (truth table):
  // | Case | hasContent | isInterrupted | hasErrorThought | wasAborted | reachedMaxTurns | Send error?      |
  // |------|------------|---------------|-----------------|------------|-----------------|------------------|
  // | 1a   | yes        | -             | -               | yes        | -               | stopped by user  |
  // | 1b   | yes        | yes           | -               | no         | -               | interrupted      |
  // | 2    | yes        | no            | -               | no         | -               | no               |
  // | 3    | no         | yes           | no              | no         | -               | interrupted      |
  // | 4    | no         | no            | no              | no         | no              | empty response   |
  // | 5    | no         | -             | yes             | -          | -               | no               |
  // | 6    | no         | -             | -               | yes        | -               | no               |
  // | 7    | no         | no            | no              | no         | yes             | max turns notice |

  // Prefer lockedFinalContent (captured at result thought, immune to post-result stream mutations).
  // Fall back to lastTextContent for interrupted streams that never reach a result thought,
  // then to currentStreamingText for streams that ended mid-block without a text_block_stop.
  const finalContent = lockedFinalContent || lastTextContent || currentStreamingText || ''
  const wasAborted = abortController.signal.aborted
  const hasErrorThought = sessionState.thoughts.some((t: Thought) => t.type === 'error')
  // Two independent interrupt reasons: SDK reported error_during_execution, or stream ended unexpectedly
  const isInterrupted = !receivedResult || hadErrorDuringExecution

  // Find the error thought for callers
  const errorThought = hasErrorThought
    ? sessionState.thoughts.find((t: Thought) => t.type === 'error')
    : undefined

  // Log content source for debugging
  if (finalContent) {
    const contentSource = lockedFinalContent
      ? 'lockedFinalContent'
      : lastTextContent
        ? 'lastTextContent'
        : 'currentStreamingText (fallback)'
    console.log(`[Agent][${conversationId}] Stream content from ${contentSource}: ${finalContent.length} chars`)
  } else {
    console.log(`[Agent][${conversationId}] No content from stream`)
  }
  if (hasErrorThought) {
    console.log(`[Agent][${conversationId}] Error thought present: ${errorThought?.content}`)
  }

  // Build the result object
  const result: StreamResult = {
    finalContent,
    thoughts: sessionState.thoughts,
    tokenUsage,
    capturedSessionId,
    isInterrupted,
    wasAborted,
    hasErrorThought,
    errorThought,
    reachedMaxTurns: hadMaxTurnsReached,
    firstEventReceived: firstEventFired,
  }

  // Notify caller for storage handling (optional — consumer-based callers
  // handle persistence externally, legacy callers like app-chat.ts use this)
  if (callbacks.onComplete) {
    callbacks.onComplete(result)
  }

  // Emit agent:complete for legacy callers that don't use the consumer.
  // Consumer-based callers emit agent:complete themselves after persistence.
  // Legacy callers are identified by providing messageContent (they own the full lifecycle).
  if (messageContent != null) {
    emitAgentEvent('agent:complete', spaceId, conversationId, {
      type: 'complete',
      duration: 0,
      tokenUsage
    })
  }

  // Determine if interrupted error should be sent
  const getInterruptedErrorMessage = (): string | null => {
    if (finalContent) {
      // Has content: user aborted shows friendly message, other interrupts show warning
      if (wasAborted) return 'Stopped by user.'
      return isInterrupted ? 'Model response interrupted unexpectedly.' : null
    } else {
      // No content: skip if already has error thought or user aborted
      if (hasErrorThought || wasAborted) return null
      // Max turns is a graceful SDK limit, not a crash — show a clear actionable message
      if (hadMaxTurnsReached) return 'Reached the maximum turn limit. Send a message to continue.'
      return isInterrupted
        ? 'Model response interrupted unexpectedly.'
        : `Unexpected empty response. ${FALLBACK_ERROR_HINT}`
    }
  }

  const errorMessage = getInterruptedErrorMessage()
  if (errorMessage) {
    const reason = hadMaxTurnsReached
      ? 'max_turns'
      : isInterrupted
        ? (hadErrorDuringExecution ? 'error_during_execution' : 'stream interrupted')
        : 'empty response'
    console.log(`[Agent][${conversationId}] Sending interrupted error (${reason}, content: ${finalContent ? 'yes' : 'no'})`)
    emitAgentEvent('agent:error', spaceId, conversationId, {
      type: 'error',
      errorType: 'interrupted',
      error: errorMessage
    })
  } else if (wasAborted) {
    console.log(`[Agent][${conversationId}] User stopped - no error sent`)
  }

  return result
}
