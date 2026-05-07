/**
 * Codex event normalizer.
 *
 * Converts Codex SDK thread events into the Claude Code SDK message protocol
 * consumed by Halo's existing stream processor. The protocol boundary is here:
 * the rest of Halo never needs to understand Codex's native event names.
 *
 * Protocol contract emitted (per turn, in order):
 *   1. system.init                        — once per session, before first turn
 *   2. assistant.message_start            — wraps all content blocks of the turn
 *   3. content_block_start/_delta/_stop   — text / thinking / tool_use blocks
 *   4. user.tool_result                   — interleaved with tool_use blocks
 *   5. assistant.message_delta + _stop    — carries stop_reason and usage
 *   6. result                             — terminal marker for the turn
 *
 * Without (2) and (5) the CC stream-processor cannot extract per-turn usage and
 * cannot lock final content reliably. Without the terminal `result` event the
 * adapter cannot release its event iterator until SDK idle timeout fires.
 */

import type { CodexThreadEvent, CodexThreadItem, CodexUsage } from './types'

export interface NormalizerContext {
  sessionId: string
  model: string
  systemPrompt?: string
  mcpServers: Record<string, any>
}

interface TextBlockState {
  index: number
  text: string
  started: boolean
  stopped: boolean
}

interface ToolBlockState {
  index: number
  started: boolean
}

export class CodexEventNormalizer {
  private initialized = false
  private finalText = ''
  private lastUsage: CodexUsage | null = null
  private toolNames = new Set<string>()
  private nextBlockIndex = 0
  private textBlocks = new Map<string, TextBlockState>()
  private toolBlocks = new Map<string, ToolBlockState>()
  private messageOpen = false
  private messageId: string | null = null
  private hasToolUseInTurn = false
  private terminal = false

  constructor(private readonly context: NormalizerContext) {
    this.toolNames = collectToolNames(context.mcpServers)
  }

  /**
   * True after a turn has emitted its terminal `result` message.
   * The session adapter uses this to break out of the underlying Codex event
   * iterator immediately instead of waiting for the SDK's idle timeout.
   */
  isTerminal(): boolean {
    return this.terminal
  }

  /**
   * Reset per-turn state so the same normalizer instance can drive multiple
   * turns. The adapter calls this before each runStreamed() so a stale
   * `terminal` flag from the previous turn cannot cause the next turn to
   * exit immediately.
   *
   * Persistent state (initialized, toolNames, finalText carry-over) is left
   * intact intentionally — those describe the session, not the turn.
   */
  resetTurn(): void {
    this.terminal = false
    this.hasToolUseInTurn = false
    this.messageOpen = false
    this.messageId = null
    this.nextBlockIndex = 0
    this.textBlocks.clear()
    this.toolBlocks.clear()
    this.lastUsage = null
  }

  normalize(event: CodexThreadEvent): any[] {
    const messages: any[] = []

    if (event.type === 'thread.started' && event.thread_id) {
      // Adapter emits an explicit init before draining events; only emit again
      // if it has not already happened (defensive for tests / future callers).
      if (!this.initialized) messages.push(this.createInit(event.thread_id))
      return messages
    }

    if (event.type === 'turn.started') {
      // Reset per-turn state. terminal flag is cleared so a fresh turn can run
      // on the same normalizer instance (the adapter currently runs one turn
      // per stream() call, but the contract supports reuse).
      this.terminal = false
      this.hasToolUseInTurn = false
      if (!this.initialized) messages.push(this.createInit(this.context.sessionId))
      messages.push(this.openMessage())
      return messages
    }

    if (event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed') {
      // Defensive: if the SDK skips turn.started (older codex CLI builds), open
      // the message lazily so content_block_* events have a valid envelope.
      if (!this.messageOpen) {
        if (!this.initialized) messages.push(this.createInit(this.context.sessionId))
        messages.push(this.openMessage())
      }
      if (event.item) messages.push(...this.normalizeItem(event.item, event.type))
      return messages
    }

    if (event.type === 'turn.completed') {
      this.lastUsage = event.usage || this.lastUsage
      messages.push(...this.closeMessage(this.hasToolUseInTurn ? 'tool_use' : 'end_turn'))
      messages.push(this.createResult(false))
      this.terminal = true
      return messages
    }

    if (event.type === 'turn.failed') {
      const message = typeof event.error === 'string' ? event.error : event.error?.message
      messages.push(this.createErrorAssistant(message || 'Codex turn failed'))
      messages.push(...this.closeMessage('end_turn'))
      messages.push(this.createResult(true, message || 'Codex turn failed'))
      this.terminal = true
      return messages
    }

    if (event.type === 'error') {
      messages.push(this.createErrorAssistant(event.message || 'Codex stream error'))
      messages.push(...this.closeMessage('end_turn'))
      messages.push(this.createResult(true, event.message || 'Codex stream error'))
      this.terminal = true
    }

    return messages
  }

  createInit(sessionId: string): any {
    this.initialized = true
    return {
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      model: this.context.model,
      tools: Array.from(this.toolNames),
      mcp_servers: Object.keys(this.context.mcpServers).map((name) => ({ name, status: 'connected' })),
      slash_commands: [],
      skills: [],
      agents: [],
    }
  }

  /**
   * Emit a synthetic message_start envelope. CC stream-processor uses this to
   * scope content blocks to a turn. Without it, lockedFinalContent capture and
   * usage extraction break.
   */
  private openMessage(): any {
    this.messageOpen = true
    this.messageId = `codex-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.nextBlockIndex = 0
    this.textBlocks.clear()
    this.toolBlocks.clear()
    return streamEvent({
      type: 'message_start',
      message: {
        id: this.messageId,
        type: 'message',
        role: 'assistant',
        model: this.context.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: emptyClaudeUsage(),
      },
    })
  }

  private closeMessage(stopReason: 'end_turn' | 'tool_use'): any[] {
    if (!this.messageOpen) return []
    this.messageOpen = false
    const usage = this.lastUsage ? toClaudeUsage(this.lastUsage) : emptyClaudeUsage()
    return [
      streamEvent({
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage,
      }),
      streamEvent({ type: 'message_stop' }),
    ]
  }

  createResult(isError: boolean, error?: string): any {
    const usage = this.lastUsage ? toClaudeUsage(this.lastUsage) : undefined
    return {
      type: 'result',
      subtype: isError ? 'error_during_execution' : 'success',
      session_id: this.context.sessionId,
      result: isError ? error || '' : this.finalText,
      is_error: isError,
      usage,
      cumulative_usage: usage,
      stop_reason: isError ? 'error' : 'end_turn',
    }
  }

  private normalizeItem(item: CodexThreadItem, eventType: string): any[] {
    switch (item.type) {
      case 'agent_message':
        return this.normalizeAgentMessage(item, eventType)
      case 'reasoning':
        return this.normalizeReasoning(item, eventType)
      case 'command_execution':
        return this.normalizeCommandExecution(item, eventType)
      case 'mcp_tool_call':
        return this.normalizeMcpToolCall(item, eventType)
      case 'web_search':
        return this.normalizeSyntheticTool(item, 'WebSearch', { query: item.query || '' }, undefined, eventType)
      case 'file_change':
        return this.normalizeSyntheticTool(item, 'Edit', { changes: item.changes || [] }, JSON.stringify(item.changes || []), eventType)
      case 'todo_list': {
        // CC TodoWrite expects todos shaped as { content, activeForm, status }.
        // Codex's todo_list emits { text, completed }. Translate so Halo's
        // existing TodoWrite UI card renders correctly instead of showing
        // empty rows.
        const todos = (item.items || []).map((entry) => ({
          content: entry.text,
          activeForm: entry.text,
          status: entry.completed ? 'completed' : 'pending',
        }))
        return this.normalizeSyntheticTool(item, 'TodoWrite', { todos }, JSON.stringify(todos), eventType)
      }
      case 'error':
        return [this.createErrorAssistant(item.message || 'Codex item error')]
      default:
        return []
    }
  }

  private normalizeAgentMessage(item: CodexThreadItem, eventType: string): any[] {
    const itemId = item.id || `codex-text-${this.nextBlockIndex}`
    const text = item.text || ''
    const messages: any[] = []
    const state = this.getTextBlock(itemId)

    if (!state.started) {
      messages.push(streamEvent({
        type: 'content_block_start',
        index: state.index,
        content_block: { type: 'text', text: '' },
      }))
      state.started = true
    }

    const delta = text.startsWith(state.text) ? text.slice(state.text.length) : text
    if (delta) {
      messages.push(streamEvent({
        type: 'content_block_delta',
        index: state.index,
        delta: { type: 'text_delta', text: delta },
      }))
      state.text = text
    }

    if (eventType === 'item.completed') {
      if (!state.stopped) {
        messages.push(streamEvent({ type: 'content_block_stop', index: state.index }))
        state.stopped = true
      }
      this.finalText = state.text
      this.textBlocks.delete(itemId)
    }

    return messages
  }

  private normalizeReasoning(item: CodexThreadItem, eventType: string): any[] {
    if (!item.text || eventType !== 'item.completed') return []
    const index = this.nextBlockIndex++
    return [
      streamEvent({
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '' },
      }),
      streamEvent({
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: item.text },
      }),
      streamEvent({ type: 'content_block_stop', index }),
    ]
  }

  private normalizeCommandExecution(item: CodexThreadItem, eventType: string): any[] {
    const toolId = item.id || `codex-command-${this.nextBlockIndex}`
    const messages: any[] = []

    if (eventType === 'item.started') {
      messages.push(...this.createToolUseStream(toolId, 'Bash', { command: item.command || '' }))
    }

    if (eventType === 'item.completed') {
      if (!this.toolBlocks.has(toolId)) {
        messages.push(...this.createToolUseStream(toolId, 'Bash', { command: item.command || '' }))
      }
      messages.push(userWithToolResult(toolId, item.aggregated_output || '', item.status === 'failed'))
      this.toolBlocks.delete(toolId)
    }

    return messages
  }

  private normalizeMcpToolCall(item: CodexThreadItem, eventType: string): any[] {
    const server = item.server || 'mcp'
    const tool = item.tool || 'unknown'
    const toolName = toMcpToolName(server, tool)
    return this.normalizeSyntheticTool(item, toolName, asRecord(item.arguments), extractMcpResult(item), eventType, item.status === 'failed')
  }

  private normalizeSyntheticTool(
    item: CodexThreadItem,
    toolName: string,
    input: Record<string, unknown>,
    output: string | undefined,
    eventType: string,
    isError = false
  ): any[] {
    const toolId = item.id || `codex-tool-${this.nextBlockIndex}`
    const messages: any[] = []
    if (eventType === 'item.started') {
      messages.push(...this.createToolUseStream(toolId, toolName, input))
    }
    if (eventType === 'item.completed') {
      if (!this.toolBlocks.has(toolId)) {
        messages.push(...this.createToolUseStream(toolId, toolName, input))
      }
      messages.push(userWithToolResult(toolId, output || '', isError))
      this.toolBlocks.delete(toolId)
    }
    return messages
  }

  private createToolUseStream(toolId: string, toolName: string, input: Record<string, unknown>): any[] {
    const existing = this.toolBlocks.get(toolId)
    if (existing?.started) return []

    const state: ToolBlockState = existing || { index: this.nextBlockIndex++, started: false }
    this.toolBlocks.set(toolId, state)
    state.started = true
    this.hasToolUseInTurn = true

    return [
      streamEvent({
        type: 'content_block_start',
        index: state.index,
        content_block: {
          type: 'tool_use',
          id: toolId,
          name: toolName,
          input: {},
        },
      }),
      streamEvent({
        type: 'content_block_delta',
        index: state.index,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify(input),
        },
      }),
      streamEvent({ type: 'content_block_stop', index: state.index }),
    ]
  }

  private getTextBlock(itemId: string): TextBlockState {
    const existing = this.textBlocks.get(itemId)
    if (existing) return existing
    const state: TextBlockState = {
      index: this.nextBlockIndex++,
      text: '',
      started: false,
      stopped: false,
    }
    this.textBlocks.set(itemId, state)
    return state
  }

  private createErrorAssistant(message: string): any {
    return assistantWithBlocks([{ type: 'text', text: message }])
  }
}

function streamEvent(event: any): any {
  return { type: 'stream_event', event }
}

function assistantWithBlocks(content: any[]): any {
  return {
    type: 'assistant',
    message: {
      id: `codex-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: 'assistant',
      content,
    },
  }
}

function userWithToolResult(toolUseId: string, content: string, isError: boolean): any {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
        is_error: isError,
      }],
    },
  }
}

function collectToolNames(mcpServers: Record<string, any>): Set<string> {
  const names = new Set<string>()
  for (const [serverName, server] of Object.entries(mcpServers || {})) {
    const tools = server?.instance?.listTools?.()
    if (!Array.isArray(tools)) continue
    for (const tool of tools) {
      if (tool?.name) names.add(toMcpToolName(serverName, tool.name))
    }
  }
  return names
}

function toMcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function extractMcpResult(item: CodexThreadItem): string {
  if (item.error) return typeof item.error === 'string' ? item.error : item.error.message || ''
  const content = item.result?.content
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (block.type === 'text') return String(block.text || '')
      return JSON.stringify(block)
    }).join('\n')
  }
  if (item.result?.structured_content !== undefined) return JSON.stringify(item.result.structured_content)
  return ''
}

function toClaudeUsage(usage: CodexUsage): Record<string, number> {
  return {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    cache_read_input_tokens: usage.cached_input_tokens || 0,
    cache_creation_input_tokens: 0,
  }
}

function emptyClaudeUsage(): Record<string, number> {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }
}
