/**
 * @module core/query-loop
 * The ReAct query loop — the heart of the Agent-Core SDK.
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import type {
  Message,
  ContentBlock,
  ThinkingBlock,
  ToolUseBlock,
  StreamEvent,
  UsageInfo,
  LlmProvider,
} from '../types/provider.js';
import { toToolDefinition } from '../types/tool.js';
import type { Tool, ToolContext } from '../types/tool.js';
import type { QueryConfig } from '../types/config.js';
import { CostTracker } from './cost.js';
import type { ModelUsageEntry } from './cost.js';
import { TokenBudget } from './token-budget.js';
import { buildUserMessage, buildToolResultMessage, extractToolUseBlocks } from './messages.js';
import { microCompact, apiCompact, autoCompactIfNeeded, fullCompact, AutoCompactState, shouldAutoCompact } from './compact.js';
import { assembleSystemPrompt, splitAtBoundary } from '../prompt/system-prompt.js';
import type { SystemPromptConfig } from '../prompt/system-prompt.js';
import { truncateToolResult } from '../utils/truncate.js';
import { estimateMessageTokens, ApiTokenAnchor } from '../utils/tokens.js';
import {
  ProviderError,
  AbortError,
  isAbortError,
  isContextWindowExceededError,
} from '../utils/errors.js';
import { sleep, DEFAULT_RETRY, delayForAttempt } from '../utils/retry.js';
import {
  runPreToolUseHooks,
  runPostToolUseHooks,
  runPostToolUseFailureHooks,
  runEventHooks,
} from './hooks.js';
import {
  MAX_TOKENS_RECOVERY_LIMIT,
  MAX_TOKENS_RECOVERY_MSG,
} from '../prompt/constants.js';
import type { EffortLevel, ThinkingConfig as CfgThinkingConfig } from '../types/config.js';
import type { ThinkingConfig } from '../types/provider.js';

// ---------------------------------------------------------------------------
// SDK version constant (matches package.json)
// ---------------------------------------------------------------------------

const SDK_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// API key source detection
// ---------------------------------------------------------------------------

/**
 * Determine how the API key was provided, reported in the init message.
 * CC SDK uses: 'user' | 'project' | 'org' | 'temporary' | 'oauth'.
 * Our SDK only supports env-based keys, so we classify by env var name.
 */
function resolveApiKeySource(
  env: Record<string, string | undefined>,
): string {
  if (env.ANTHROPIC_API_KEY) return 'user';
  if (process.env.ANTHROPIC_API_KEY) return 'user';
  return 'user';
}

// ---------------------------------------------------------------------------
// Effort level → provider parameters resolution
// ---------------------------------------------------------------------------

/**
 * Effort-level thinking budget mapping.
 *
 *   Low    → thinking disabled, temperature 0.0
 *   Medium → budget 5 000 tokens
 *   High   → budget 10 000 tokens  (default)
 *   Max    → budget 20 000 tokens
 */
const EFFORT_THINKING_BUDGET: Record<EffortLevel, number | null> = {
  low: null,       // disabled
  medium: 5_000,
  high: 10_000,
  max: 20_000,
};

const EFFORT_TEMPERATURE: Record<EffortLevel, number | undefined> = {
  low: 0,
  medium: undefined,
  high: undefined,
  max: undefined,
};

/**
 * Map effort level to OpenAI-compatible reasoning_effort string.
 */
const EFFORT_TO_OPENAI_REASONING: Record<EffortLevel, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'high',
};

interface ResolvedEffort {
  thinking: ThinkingConfig;
  temperature: number | undefined;
  /** OpenAI-compat reasoning_effort field (only set when provider is OpenAI-compat). */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

/**
 * Resolve the final thinking configuration from explicit `thinking` config and
 * `effort` level. Explicit thinking config takes precedence; effort level is
 * used as a fallback when thinking is disabled/absent.
 */
function resolveEffort(
  thinking: CfgThinkingConfig,
  effort: EffortLevel,
): ResolvedEffort {
  // If thinking is already explicitly configured (enabled/adaptive), honour it
  if (thinking.type === 'enabled' || thinking.type === 'adaptive') {
    return { thinking, temperature: undefined };
  }

  // Derive from effort level
  const budget = EFFORT_THINKING_BUDGET[effort];
  const temperature = EFFORT_TEMPERATURE[effort];
  const reasoningEffort = EFFORT_TO_OPENAI_REASONING[effort];

  if (budget === null) {
    return { thinking: { type: 'disabled' }, temperature, reasoningEffort };
  }

  return {
    thinking: { type: 'enabled', budgetTokens: budget },
    temperature,
    reasoningEffort,
  };
}

// ---------------------------------------------------------------------------
// SDKMessage — events yielded by the query loop
// ---------------------------------------------------------------------------

/**
 * SDKMessage — events yielded by the query loop.
 *
 * Field naming uses snake_case convention for wire-level
 * compatibility with consumer code (hello-halo, agent-workspace-backend, etc.).
 */
export type SDKMessage =
  // System init — CC SDK SDKSystemMessage
  | {
      type: 'system';
      subtype: 'init';
      session_id: string;
      tools: string[];
      model: string;
      cwd: string;
      permissionMode: string;
      mcp_servers: Array<{ name: string; status: string }>;
      slash_commands: string[];
      skills: string[];
      agents?: string[];
      apiKeySource: string;
      claude_code_version: string;
      betas?: string[];
      output_style: string;
      plugins: Array<{ name: string; path: string }>;
      fast_mode_state?: 'off' | 'cooldown' | 'on';
      uuid: string;
    }
  // Assistant message — BetaMessage-compatible shape (C3)
  | {
      type: 'assistant';
      /**
       * BetaMessage-compatible object matching the official CC SDK contract.
       * Includes `id`, `type`, `model`, `stop_reason`, `stop_sequence` so
       * consumer code reading these fields works correctly.
       */
      message: {
        id: string;
        type: 'message';
        role: 'assistant';
        model: string;
        content: ContentBlock[];
        stop_reason: string | null;
        stop_sequence: string | null;
        usage?: UsageInfo;
      };
      parent_tool_use_id: string | null;
      uuid: string;
      session_id: string;
      usage?: UsageInfo;
      error?: AssistantMessageError;
    }
  // User message (tool results)
  | {
      type: 'user';
      message: { role: 'user'; content: ContentBlock[] };
      parent_tool_use_id: string | null;
      uuid: string;
      session_id: string;
    }
  // Streaming event (partial messages)
  | {
      type: 'stream_event';
      event: StreamEvent;
      parent_tool_use_id: string | null;
      uuid: string;
      session_id: string;
    }
  // Result — success
  | {
      type: 'result';
      subtype: 'success';
      result: string;
      is_error: false;
      num_turns: number;
      total_cost_usd: number;
      usage: UsageInfo;
      modelUsage: Record<string, ModelUsageEntry>;
      session_id: string;
      stop_reason: string | null;
      duration_ms: number;
      duration_api_ms: number;
      permission_denials: Array<{ tool_name: string; tool_use_id: string; tool_input: Record<string, unknown> }>;
      structured_output?: unknown;
      deferred_tool_use?: { tool_use_id: string; tool_name: string; tool_input: Record<string, unknown> };
      fast_mode_state?: 'off' | 'cooldown' | 'on';
      uuid: string;
    }
  // Result — error
  | {
      type: 'result';
      subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
      /** Error details as individual messages (CC SDK canonical field). */
      errors: string[];
      /** Joined error text for consumer compat (consumer reads `message.result`). */
      result: string;
      is_error: true;
      num_turns: number;
      total_cost_usd: number;
      usage: UsageInfo;
      modelUsage: Record<string, ModelUsageEntry>;
      session_id: string;
      stop_reason: string | null;
      duration_ms: number;
      duration_api_ms: number;
      permission_denials: Array<{ tool_name: string; tool_use_id: string; tool_input: Record<string, unknown> }>;
      fast_mode_state?: 'off' | 'cooldown' | 'on';
      uuid: string;
    }
  // Tool progress
  | {
      type: 'tool_progress';
      tool_name: string;
      tool_use_id: string;
      parent_tool_use_id: string | null;
      elapsed_time_seconds?: number;
      task_id?: string;
      uuid: string;
      session_id: string;
    }
  // System — compact boundary
  | {
      type: 'system';
      subtype: 'compact_boundary';
      summary: string;
      compact_metadata: {
        trigger: 'auto' | 'manual';
        pre_tokens: number;
        preserved_segment?: string;
      };
      session_id: string;
      uuid: string;
    }
  // System — status
  | {
      type: 'system';
      subtype: 'status';
      status: string | null;
      session_id: string;
      permissionMode?: string;
      uuid: string;
    }
  // System — api_retry
  | {
      type: 'system';
      subtype: 'api_retry';
      attempt: number;
      max_retries: number;
      retry_delay_ms: number;
      error_status: number | null;
      error: 'authentication_failed' | 'billing_error' | 'rate_limit' | 'invalid_request' | 'server_error' | 'unknown' | 'max_output_tokens';
      session_id: string;
      uuid: string;
    }
  // System — session state changed (idle/running/requires_action)
  | {
      type: 'system';
      subtype: 'session_state_changed';
      state: 'idle' | 'running' | 'requires_action';
      session_id: string;
      uuid: string;
    }
  // System — task started (sub-agent spawned)
  | {
      type: 'system';
      subtype: 'task_started';
      task_id: string;
      tool_use_id?: string;
      description: string;
      task_type?: string;
      workflow_name?: string;
      prompt?: string;
      session_id: string;
      uuid: string;
    }
  // System — task progress (sub-agent turn completed)
  | {
      type: 'system';
      subtype: 'task_progress';
      task_id: string;
      tool_use_id?: string;
      description: string;
      usage: { total_tokens: number; tool_uses: number; duration_ms: number };
      last_tool_name?: string;
      summary?: string;
      session_id: string;
      uuid: string;
    }
  // System — task notification (sub-agent completed/failed/stopped)
  | {
      type: 'system';
      subtype: 'task_notification';
      task_id: string;
      tool_use_id?: string;
      status: 'completed' | 'failed' | 'stopped';
      output_file: string;
      summary: string;
      usage?: { total_tokens: number; tool_uses: number; duration_ms: number };
      session_id: string;
      uuid: string;
    }
  // Tool use summary
  | {
      type: 'tool_use_summary';
      summary: string;
      preceding_tool_use_ids: string[];
      session_id: string;
      uuid: string;
    }
  // Rate limit event — CC SDK SDKRateLimitEvent (top-level type, NOT system subtype)
  | {
      type: 'rate_limit_event';
      rate_limit_info: SDKRateLimitInfo;
      session_id: string;
      uuid: string;
    }
  // Prompt suggestion — CC SDK SDKPromptSuggestionMessage (top-level type, NOT system subtype)
  | {
      type: 'prompt_suggestion';
      suggestion: string;
      session_id: string;
      uuid: string;
    }
  // Files persisted event — CC SDK SDKFilesPersistedEvent
  | {
      type: 'system';
      subtype: 'files_persisted';
      files: Array<{ filename: string; file_id: string }>;
      failed: Array<{ filename: string; error: string }>;
      processed_at: string;
      session_id: string;
      uuid: string;
    }
  // Hook started — CC SDK SDKHookStartedMessage (H20)
  | {
      type: 'system';
      subtype: 'hook_started';
      hook_id: string;
      hook_name: string;
      hook_event: string;
      uuid: string;
      session_id: string;
    }
  // Hook progress — CC SDK SDKHookProgressMessage (H20)
  | {
      type: 'system';
      subtype: 'hook_progress';
      hook_id: string;
      hook_name: string;
      hook_event: string;
      stdout: string;
      stderr: string;
      output: string;
      uuid: string;
      session_id: string;
    }
  // Hook response — CC SDK SDKHookResponseMessage (H20)
  | {
      type: 'system';
      subtype: 'hook_response';
      hook_id: string;
      hook_name: string;
      hook_event: string;
      output: string;
      stdout: string;
      stderr: string;
      exit_code?: number;
      outcome: 'success' | 'error' | 'cancelled';
      uuid: string;
      session_id: string;
    }
  // Auth status — CC SDK SDKAuthStatusMessage (H20)
  | {
      type: 'auth_status';
      isAuthenticating: boolean;
      output: string[];
      error?: string;
      uuid: string;
      session_id: string;
    }
  // Elicitation complete — CC SDK SDKElicitationCompleteMessage (H20)
  | {
      type: 'system';
      subtype: 'elicitation_complete';
      mcp_server_name: string;
      elicitation_id: string;
      uuid: string;
      session_id: string;
    }
  // Local command output — CC SDK SDKLocalCommandOutputMessage (H20)
  | {
      type: 'system';
      subtype: 'local_command_output';
      content: string;
      uuid: string;
      session_id: string;
    }
  // Generic system subtype (catch-all for forward compat)
  | {
      type: 'system';
      subtype: string;
      session_id: string;
      uuid: string;
      [key: string]: unknown;
    };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AssistantMessageError = 'authentication_failed' | 'billing_error' | 'rate_limit' | 'invalid_request' | 'server_error' | 'unknown' | 'max_output_tokens';

/**
 * Rate limit info matching CC SDK SDKRateLimitInfo.
 */
export interface SDKRateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage';
  utilization?: number;
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
  overageResetsAt?: number;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
  surpassedThreshold?: number;
}

/** Classify an HTTP status code into the CC SDK error category string. */
function classifyApiError(statusCode: number | undefined): AssistantMessageError {
  if (!statusCode) return 'unknown';
  if (statusCode === 401 || statusCode === 403) return 'authentication_failed';
  if (statusCode === 402) return 'billing_error';
  if (statusCode === 429) return 'rate_limit';
  if (statusCode === 400 || statusCode === 422) return 'invalid_request';
  if (statusCode >= 500) return 'server_error';
  return 'unknown';
}

/** Build the system prompt string from config. */
function buildSystemPrompt(
  config: QueryConfig,
  tools: Tool[],
): string {
  // If user provided a full string, use it directly
  if (typeof config.systemPrompt === 'string') {
    return config.systemPrompt;
  }

  // Preset mode — assemble from sections
  const promptConfig: SystemPromptConfig = {
    tools,
    cwd: config.cwd,
    platform: typeof process !== 'undefined' ? process.platform : 'linux',
    date: new Date().toISOString().split('T')[0],
    model: config.model,
    customAppend: config.systemPrompt?.append,
    isSDK: true,
  };

  return assembleSystemPrompt(promptConfig);
}

// ---------------------------------------------------------------------------
// Tool execution timeout constants (matches Rust implementation)
// ---------------------------------------------------------------------------

/** Default tool execution timeout in milliseconds (120 seconds). */
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
/** Maximum allowed tool execution timeout in milliseconds (600 seconds). */
const MAX_TOOL_TIMEOUT_MS = 600_000;

/**
 * Execute a single tool, with error recovery and a configurable timeout.
 * Default 120s, max 600s (per the Rust implementation).
 */
async function executeTool(
  tool: Tool,
  input: Record<string, unknown>,
  ctx: ToolContext,
  toolResultBudget: number,
  timeoutMs?: number,
): Promise<{ content: string; isError: boolean }> {
  const effectiveTimeout = Math.min(
    Math.max(0, timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS),
    MAX_TOOL_TIMEOUT_MS,
  );

  try {
    const result = await Promise.race([
      tool.execute(input, ctx),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `Tool "${tool.name}" timed out after ${effectiveTimeout / 1000}s`,
              ),
            ),
          effectiveTimeout,
        );
        // Clear timer on abort to avoid leaking timers
        if (ctx.abortSignal) {
          ctx.abortSignal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new AbortError());
            },
            { once: true },
          );
        }
      }),
    ]);
    const content = truncateToolResult(result.content, toolResultBudget);
    return { content, isError: result.isError };
  } catch (err: unknown) {
    // Re-throw abort errors so the caller's abort detection handles them
    if (isAbortError(err, ctx.abortSignal)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `Tool execution error: ${message}`,
      isError: true,
    };
  }
}

/** Check if the abort signal has been triggered. */
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AbortError(signal.reason ?? 'Operation was aborted');
  }
}

/** Build tool context from query config and session state. */
function buildToolContext(
  config: QueryConfig,
  sessionId: string,
  costTracker: CostTracker,
  currentTurn: number,
): ToolContext {
  return {
    sessionId,
    cwd: config.cwd,
    abortSignal: config.abortSignal,
    costTracker,
    currentTurn,
    env: config.env as Record<string, string | undefined>,
  };
}

/** Find a tool by name. */
function findTool(tools: Tool[], name: string): Tool | undefined {
  return tools.find((t) => t.name === name);
}

// ---------------------------------------------------------------------------
// Stream accumulator — collects stream events into a complete response
// ---------------------------------------------------------------------------

interface AccumulatedResponse {
  content: ContentBlock[];
  usage: UsageInfo;
  stopReason: string;
  id: string;
  model: string;
}

/**
 * Translate an internal StreamEvent to the CC SDK wire format for consumer
 * compatibility.
 *
 * The CC SDK (and Anthropic API) use `content_block_delta` with a nested
 * `delta` object for incremental content updates, whereas our internal
 * StreamEvent type uses flattened top-level events for ergonomic internal use.
 *
 * Consumer code (stream-processor.ts) reads:
 *   `event.type === 'content_block_delta'`
 *   `event.delta?.type === 'text_delta'`, `event.delta.text`
 *   `event.delta?.type === 'thinking_delta'`, `event.delta.thinking`
 *   `event.delta?.type === 'input_json_delta'`, `event.delta.partial_json`
 */
function toWireStreamEvent(event: StreamEvent): Record<string, unknown> {
  switch (event.type) {
    case 'text_delta':
      return {
        type: 'content_block_delta',
        index: event.index,
        delta: { type: 'text_delta', text: event.text },
      };
    case 'thinking_delta':
      return {
        type: 'content_block_delta',
        index: event.index,
        delta: { type: 'thinking_delta', thinking: event.thinking },
      };
    case 'input_json_delta':
      return {
        type: 'content_block_delta',
        index: event.index,
        delta: { type: 'input_json_delta', partial_json: event.partialJson },
      };
    case 'signature_delta':
      return {
        type: 'content_block_delta',
        index: event.index,
        delta: { type: 'signature_delta', signature: event.signature },
      };
    case 'reasoning_delta':
      // Map provider-specific reasoning_delta → thinking_delta (same concept)
      return {
        type: 'content_block_delta',
        index: event.index,
        delta: { type: 'thinking_delta', thinking: event.reasoning },
      };
    case 'message_start':
      // Anthropic wire format wraps the message metadata inside a `message` object:
      // { type: 'message_start', message: { id, model, role, content, type, usage, ... } }
      return {
        type: 'message_start',
        message: {
          id: event.id,
          type: 'message',
          role: 'assistant',
          model: event.model,
          content: [],
          usage: event.usage,
          stop_reason: null,
          stop_sequence: null,
        },
      };
    case 'message_delta':
      // Anthropic wire format: { type: 'message_delta', delta: { stop_reason, type }, usage }
      return {
        type: 'message_delta',
        delta: {
          type: 'message_delta',
          stop_reason: event.stopReason ?? null,
          stop_sequence: null,
        },
        usage: event.usage ?? { output_tokens: 0 },
      };
    case 'content_block_start':
      // Already wire-compatible: { type, index, content_block }
      return event as unknown as Record<string, unknown>;
    case 'content_block_stop':
      // Already wire-compatible: { type, index }
      return event as unknown as Record<string, unknown>;
    case 'message_stop':
      // Already wire-compatible: { type: 'message_stop' }
      return event as unknown as Record<string, unknown>;
    default:
      // error and any future events — pass through as-is
      return event as unknown as Record<string, unknown>;
  }
}

/**
 * Real-time streaming accumulator — yields `stream_event` SDKMessages as
 * tokens arrive and returns the fully-assembled `AccumulatedResponse` when done.
 *
 * This replaces the previous pattern where events were collected into a
 * `pendingStreamEvents[]` buffer and only yielded *after* the full LLM
 * response completed — which broke the consumer's real-time streaming UI.
 *
 * Usage: `const result = yield* accumulateAndStream(stream, signal, sessionId);`
 */
async function* accumulateAndStream(
  stream: AsyncGenerator<StreamEvent, void, undefined>,
  signal: AbortSignal,
  sessionId: string,
  includeEvents: boolean,
  onProgress?: (msg: SDKMessage) => void,
): AsyncGenerator<SDKMessage, AccumulatedResponse, undefined> {
  const textChunks: string[] = [];
  const toolCallBlocks = new Map<number, { id: string; name: string; jsonParts: string[] }>();
  let thinkingChunks: string[] = [];
  let thinkingIndex = -1;
  let thinkingSignature = '';
  const usage: UsageInfo = { input_tokens: 0, output_tokens: 0 };
  let stopReason = 'end_turn';
  let msgId = '';
  let msgModel = '';

  let _dbgStreamEventCount = 0;
  for await (const event of stream) {
    if (signal.aborted) {
      throw new AbortError(signal.reason ?? 'Operation was aborted');
    }

    // Yield stream event immediately — real-time delivery to consumer.
    // Transform to CC SDK wire format: flat delta events become `content_block_delta`
    // with a nested `delta` object, matching what consumer stream-processor.ts expects.
    if (includeEvents) {
      const streamMsg: SDKMessage = {
        type: 'stream_event',
        // Cast: consumer reads via `(sdkMessage as any).event`, type is advisory only.
        event: toWireStreamEvent(event) as unknown as StreamEvent,
        parent_tool_use_id: null,
        uuid: randomUUID(),
        session_id: sessionId,
      };
      _dbgStreamEventCount++;
      console.log(`[QUERY-LOOP] stream_event#${_dbgStreamEventCount} inner_type=${event.type} t=${Date.now()}`);
      yield streamMsg;
      onProgress?.(streamMsg);
    }

    // Accumulate event into response state
    switch (event.type) {
      case 'message_start':
        msgId = event.id;
        msgModel = event.model;
        usage.input_tokens = event.usage.input_tokens;
        usage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
        usage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
        break;

      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          const tb = event.content_block as ToolUseBlock;
          toolCallBlocks.set(event.index, { id: tb.id, name: tb.name, jsonParts: [] });
        } else if (event.content_block.type === 'thinking') {
          thinkingIndex = event.index;
          thinkingChunks = [];
          thinkingSignature = '';
        }
        break;

      case 'text_delta':
        textChunks.push(event.text);
        break;

      case 'thinking_delta':
        if (event.index === thinkingIndex) {
          thinkingChunks.push(event.thinking);
        }
        break;

      case 'signature_delta':
        // Anthropic extended thinking: signature is part of the thinking block.
        // Accumulate and include it when building the final ThinkingBlock so it
        // can be sent back to the API unchanged in subsequent turns.
        if (event.index === thinkingIndex) {
          thinkingSignature += event.signature;
        }
        break;

      case 'reasoning_delta':
        // OpenAI-compat reasoning (Qwen/DeepSeek via ThinkTagParser).
        // No content_block_start precedes these, so thinkingIndex is -1.
        // Accumulate directly — the ThinkingBlock is assembled from these
        // chunks at the end of the stream regardless of index matching.
        thinkingChunks.push(event.reasoning);
        break;

      case 'input_json_delta': {
        const tc = toolCallBlocks.get(event.index);
        if (tc) {
          tc.jsonParts.push(event.partialJson);
        }
        break;
      }

      case 'message_delta':
        if (event.stopReason) {
          stopReason = event.stopReason;
        }
        if (event.usage) {
          usage.output_tokens = event.usage.output_tokens ?? usage.output_tokens;
        }
        break;

      case 'content_block_stop':
      case 'message_stop':
        break;

      case 'error':
        throw new ProviderError(event.message, {
          retryable: event.errorType === 'overloaded_error',
        });
    }
  }

  // Build content blocks
  const content: ContentBlock[] = [];

  if (thinkingChunks.length > 0) {
    const thinkingBlock: ThinkingBlock = {
      type: 'thinking',
      thinking: thinkingChunks.join(''),
      ...(thinkingSignature ? { signature: thinkingSignature } : {}),
    };
    content.push(thinkingBlock);
  }

  const combinedText = textChunks.join('');
  if (combinedText) {
    content.push({ type: 'text', text: combinedText });
  }

  // Tool use blocks (sorted by index for determinism)
  const sortedIndices = [...toolCallBlocks.keys()].sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    const tc = toolCallBlocks.get(idx)!;
    let input: Record<string, unknown> = {};
    const jsonStr = tc.jsonParts.join('');
    if (jsonStr) {
      try {
        input = JSON.parse(jsonStr);
      } catch {
        input = {};
      }
    }
    content.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
  }

  console.log(`[QUERY-LOOP] accumulateAndStream done. stopReason=${stopReason} textLen=${textChunks.join('').length} tools=${toolCallBlocks.size} t=${Date.now()}`);
  return { content, usage, stopReason, id: msgId || randomUUID(), model: msgModel };
}

// ---------------------------------------------------------------------------
// queryLoop — the main ReAct loop
// ---------------------------------------------------------------------------

/**
 * The main agentic query loop.
 *
 * Implements the ReAct pattern:
 * 1. Send messages to LLM
 * 2. If response contains tool_use blocks, execute tools
 * 3. Feed tool results back to LLM
 * 4. Repeat until end_turn, max_turns, or max_budget
 *
 * Yields SDKMessage events for each step.
 */
/**
 * Mutable config overrides — written by Query control methods (setModel,
 * setPermissionMode, setMaxThinkingTokens) and read by the query loop at
 * the start of each turn so that changes take effect mid-conversation.
 */
export interface MutableConfigOverrides {
  model?: string;
  permissionMode?: string;
  maxThinkingTokens?: number | null;
}

export interface QueryLoopOptions {
  onProgress?: (msg: SDKMessage) => void;
  sessionId?: string;
  /** MCP server connection statuses (for init message). */
  mcpServerStatuses?: Array<{ name: string; status: string; error?: string }>;
  /** Slash command names available in this session (for init message). */
  slashCommands?: string[];
  /** Skill names available in this session (for init message). */
  skills?: string[];
  /** Shared mutable overrides written by Query control methods. */
  configOverrides?: MutableConfigOverrides;
}

export async function* queryLoop(
  config: QueryConfig,
  provider: LlmProvider,
  tools: Tool[],
  initialPrompt: string | Message[],
  options?: QueryLoopOptions,
): AsyncGenerator<SDKMessage, void, undefined> {
  const sessionId = options?.sessionId ?? randomUUID();
  const costTracker = new CostTracker(config.model);
  const compactState = new AutoCompactState();
  const tokenBudget = new TokenBudget(config.model, config.maxTokens);
  const tokenAnchor = new ApiTokenAnchor();
  const startTime = Date.now();

  // Build system prompt
  const systemPrompt = buildSystemPrompt(config, tools);

  // Build tool definitions for the API
  const toolDefs = tools.map(toToolDefinition);

  // Initialize messages
  const messages: Message[] = [];
  if (typeof initialPrompt === 'string') {
    messages.push(buildUserMessage(initialPrompt));
  } else {
    messages.push(...initialPrompt);
  }

  // Build agent names from config.agents (CC SDK emits string[], not objects)
  const agentNames = config.agents
    ? Object.keys(config.agents)
    : undefined;

  // Determine API key source for init message
  const apiKeySource = resolveApiKeySource(config.env);

  // Yield init event (CC SDK SDKSystemMessage shape)
  const initMsg: SDKMessage = {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    tools: tools.map((t) => t.name),
    model: config.model,
    cwd: config.cwd,
    permissionMode: config.permissionMode,
    mcp_servers: options?.mcpServerStatuses ?? [],
    slash_commands: options?.slashCommands ?? [],
    skills: options?.skills ?? [],
    agents: agentNames,
    apiKeySource,
    claude_code_version: SDK_VERSION,
    betas: config.betas,
    output_style: config.outputFormat?.type ?? 'text',
    plugins: [],
    uuid: randomUUID(),
  };
  yield initMsg;
  options?.onProgress?.(initMsg);

  /** Helper to build an error result message. */
  function buildErrorResult(
    subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries',
    errors: string[],
    numTurns: number,
    stopReason: string | null = null,
  ): SDKMessage {
    return {
      type: 'result',
      subtype,
      errors,
      result: errors.join('\n'),
      is_error: true,
      num_turns: numTurns,
      total_cost_usd: costTracker.totalCostUsd,
      usage: costTracker.getUsage(),
      modelUsage: costTracker.getModelUsage(),
      session_id: sessionId,
      stop_reason: stopReason,
      duration_ms: Date.now() - startTime,
      duration_api_ms: totalApiTimeMs,
      permission_denials: permissionDenials,
      uuid: randomUUID(),
    };
  }

  let turn = 0;
  let maxTokensRecoveryCount = 0;
  let effectiveModel = config.model;
  let usedFallback = false;
  let retryAttempt = 0;
  // Track cumulative time spent waiting for LLM API calls (excludes tool execution).
  // Used for duration_api_ms in result messages.
  let totalApiTimeMs = 0;

  // Track permission denials for the result message (CC SDK SDKPermissionDenial[])
  const permissionDenials: Array<{ tool_name: string; tool_use_id: string; tool_input: Record<string, unknown> }> = [];

  // H16: Streaming fallback — after MAX_STREAMING_FAILURES consecutive
  // streaming-specific errors, fall back to non-streaming API calls.
  const MAX_STREAMING_FAILURES = 3;
  let consecutiveStreamingFailures = 0;
  let useNonStreamingFallback = false;

  while (true) {
    turn++;

    // Apply mutable config overrides from Query control methods (C1)
    const overrides = options?.configOverrides;
    if (overrides) {
      if (overrides.model !== undefined) {
        effectiveModel = overrides.model;
      }
      if (overrides.permissionMode !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any).permissionMode = overrides.permissionMode;
      }
      if (overrides.maxThinkingTokens !== undefined) {
        if (overrides.maxThinkingTokens === null || overrides.maxThinkingTokens === 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (config as any).thinking = { type: 'disabled' };
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (config as any).thinking = { type: 'enabled', budgetTokens: overrides.maxThinkingTokens };
        }
      }
    }

    // Check abort
    checkAbort(config.abortSignal);

    // Check max turns
    if (turn > config.maxTurns) {
      const resultMsg = buildErrorResult(
        'error_max_turns',
        [`Max turns exceeded: ${turn - 1} turns completed, limit is ${config.maxTurns}`],
        turn - 1,
        'max_turns',
      );
      yield resultMsg;
      options?.onProgress?.(resultMsg);
      return;
    }

    // Check budget
    if (costTracker.isOverBudget(config.maxBudgetUsd)) {
      const resultMsg = buildErrorResult(
        'error_max_budget_usd',
        [`Budget exceeded: $${costTracker.totalCostUsd.toFixed(4)} spent, limit is $${config.maxBudgetUsd.toFixed(4)}`],
        turn - 1,
        'max_budget',
      );
      yield resultMsg;
      options?.onProgress?.(resultMsg);
      return;
    }

    // Tier 1: Micro-compact — truncate old tool results
    if (config.toolResultBudget > 0) {
      const { messages: budgeted, truncatedCount } = microCompact(messages, config.toolResultBudget);
      if (truncatedCount > 0) {
        messages.length = 0;
        messages.push(...budgeted);
      }
    }

    // Tier 2: API-compact — strip oldest messages if over MAX_INPUT_TOKENS
    const apiCompacted = apiCompact(messages, tokenAnchor);
    if (apiCompacted) {
      messages.length = 0;
      messages.push(...apiCompacted);
    }

    // Build the provider request
    const [cacheablePart, dynamicPart] = splitAtBoundary(systemPrompt);
    const fullSystemPrompt = dynamicPart
      ? [
          { type: 'text' as const, text: cacheablePart, cache_control: { type: 'ephemeral' as const } },
          { type: 'text' as const, text: dynamicPart },
        ]
      : systemPrompt;

    // Stream LLM response — stream_events are yielded in real-time as tokens arrive.
    // `accumulateAndStream` is a generator: it yields SDKMessage (stream_event) immediately
    // and returns the fully-assembled AccumulatedResponse when the stream ends.
    //
    // H16: If streaming has failed consecutively, fall back to non-streaming.
    let accumulated: AccumulatedResponse;
    try {
      // Resolve effort level to thinking/temperature/reasoningEffort
      const resolved = resolveEffort(config.thinking, config.effort);

      const providerOpts = {
        signal: config.abortSignal,
        ...(resolved.reasoningEffort
          ? { reasoning_effort: resolved.reasoningEffort }
          : {}),
      };

      const apiCallStart = Date.now();

      if (useNonStreamingFallback) {
        // H16: Non-streaming fallback — make a single createMessage call
        const response = await provider.createMessage({
          model: effectiveModel,
          messages: [...messages],
          systemPrompt: fullSystemPrompt,
          tools: toolDefs,
          maxTokens: config.maxTokens,
          thinking: resolved.thinking,
          temperature: resolved.temperature,
          stream: false,
          providerOptions: providerOpts,
        });
        accumulated = {
          content: response.content,
          usage: response.usage,
          stopReason: response.stopReason,
          id: response.id,
          model: response.model,
        };
      } else {
        const stream = provider.createMessageStream({
          model: effectiveModel,
          messages: [...messages],
          systemPrompt: fullSystemPrompt,
          tools: toolDefs,
          maxTokens: config.maxTokens,
          thinking: resolved.thinking,
          temperature: resolved.temperature,
          stream: true,
          providerOptions: providerOpts,
        });

        // Delegate to the streaming accumulator — yields stream_events in real-time,
        // returns AccumulatedResponse when done.
        accumulated = yield* accumulateAndStream(
          stream,
          config.abortSignal,
          sessionId,
          config.includePartialMessages,
          options?.onProgress,
        );
      }
      totalApiTimeMs += Date.now() - apiCallStart;

      // Reset retry counter and streaming failure counter on success
      retryAttempt = 0;
      consecutiveStreamingFailures = 0;
    } catch (err: unknown) {
      // H16: Track streaming-specific failures. If the error looks like a
      // streaming/connection issue (not auth, rate limit, or context overflow),
      // increment the counter. After MAX_STREAMING_FAILURES, switch to
      // non-streaming mode and retry immediately.
      if (
        !useNonStreamingFallback &&
        !isAbortError(err, config.abortSignal) &&
        !isContextWindowExceededError(err) &&
        !(err instanceof ProviderError && (err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 402))
      ) {
        consecutiveStreamingFailures++;
        if (consecutiveStreamingFailures >= MAX_STREAMING_FAILURES) {
          useNonStreamingFallback = true;
          // Retry immediately with non-streaming
          turn--;
          continue;
        }
      }

      // Handle retryable errors
      if (err instanceof ProviderError && err.retryable) {
        // Try fallback model first (no cost)
        if (!usedFallback && config.fallbackModel) {
          effectiveModel = config.fallbackModel;
          usedFallback = true;
          turn--;
          continue;
        }
        // Retry with exponential backoff up to DEFAULT_RETRY.maxRetries attempts
        if (retryAttempt < DEFAULT_RETRY.maxRetries) {
          const delayMs = delayForAttempt(DEFAULT_RETRY, retryAttempt);
          retryAttempt++;

          // Emit api_retry so the consumer can display retry progress in the UI
          const retryMsg: SDKMessage = {
            type: 'system',
            subtype: 'api_retry',
            attempt: retryAttempt,
            max_retries: DEFAULT_RETRY.maxRetries,
            retry_delay_ms: delayMs,
            error_status: err.statusCode ?? null,
            error: classifyApiError(err.statusCode),
            session_id: sessionId,
            uuid: randomUUID(),
          };
          yield retryMsg;
          options?.onProgress?.(retryMsg);

          try {
            await sleep(delayMs, config.abortSignal);
          } catch {
            // Aborted during sleep — checkAbort() at top of next iteration handles it
          }
          turn--;
          continue;
        }
      }

      // C5: Reactive compact — when the API returns context_window_exceeded,
      // trigger emergency compaction and retry instead of failing fatally.
      // This is the most critical resilience feature for long conversations.
      if (
        isContextWindowExceededError(err) &&
        !compactState.disabled &&
        messages.length > 2
      ) {
        try {
          const compactResult = await fullCompact(
            messages,
            provider,
            effectiveModel,
            systemPrompt,
          );
          if (compactResult.messages.length < messages.length) {
            messages.length = 0;
            messages.push(...compactResult.messages);
            compactState.onSuccess();
            // Reset the token anchor since message history changed
            tokenAnchor.reset();

            // Emit compact_boundary so consumer sees the compaction
            const compactMsg: SDKMessage = {
              type: 'system',
              subtype: 'compact_boundary',
              summary: compactResult.summary,
              compact_metadata: {
                trigger: 'auto',
                pre_tokens: tokenAnchor.lastApiTokens || 0,
              },
              session_id: sessionId,
              uuid: randomUUID(),
            };
            yield compactMsg;
            options?.onProgress?.(compactMsg);

            // Retry the turn with compacted context
            turn--;
            continue;
          }
        } catch {
          compactState.onFailure();
          // Fall through to unrecoverable error handling
        }
      }

      // Handle abort — detect all variants (our AbortError, Anthropic SDK
      // APIUserAbortError, DOMException from fetch, signal.aborted)
      if (isAbortError(err, config.abortSignal)) {
        const resultMsg = buildErrorResult(
          'error_during_execution',
          ['Operation was aborted'],
          turn - 1,
        );
        yield resultMsg;
        options?.onProgress?.(resultMsg);
        return;
      }

      // Unrecoverable error
      const errorMessage = err instanceof Error ? err.message : String(err);
      const resultMsg = buildErrorResult(
        'error_during_execution',
        [errorMessage],
        turn - 1,
      );
      yield resultMsg;
      options?.onProgress?.(resultMsg);
      return;
    }

    // Track costs and anchor token counts from API-reported usage
    costTracker.add(accumulated.usage, effectiveModel);
    tokenBudget.updateFromUsage(accumulated.usage.input_tokens);
    // Anchor the heuristic estimate to API-reported tokens for drift correction
    tokenAnchor.anchor(
      accumulated.usage.input_tokens,
      estimateMessageTokens(messages),
    );

    // Build and push assistant message
    const assistantMessage: Message = {
      role: 'assistant',
      content: accumulated.content,
    };
    messages.push(assistantMessage);

    // Yield the assistant message.
    // `message` is a BetaMessage-compatible object with id, type, model,
    // stop_reason, stop_sequence fields so that consumer code reading
    // `assistantMsg.message.id` / `assistantMsg.message.model` etc. works.
    const assistantUuid = randomUUID();
    const assistantMsg: SDKMessage = {
      type: 'assistant',
      message: {
        id: accumulated.id || `msg_${assistantUuid}`,
        type: 'message',
        role: 'assistant',
        model: accumulated.model || effectiveModel,
        content: accumulated.content,
        stop_reason: accumulated.stopReason || null,
        stop_sequence: null,
        usage: accumulated.usage,
      },
      parent_tool_use_id: null,
      uuid: assistantUuid,
      session_id: sessionId,
      usage: accumulated.usage,
    };
    yield assistantMsg;
    options?.onProgress?.(assistantMsg);

    // Tier 3: Auto-compact (full compact) — LLM-based summarization if needed
    if (shouldAutoCompact(accumulated.usage.input_tokens, config.model, compactState)) {
      const preTokens = accumulated.usage.input_tokens;

      // Fire PreCompact hook before the LLM compaction call
      await runEventHooks(
        config.hooks,
        'PreCompact',
        {
          hook_event_name: 'PreCompact',
          session_id: sessionId,
          cwd: config.cwd,
          context_length: preTokens,
        },
        config.abortSignal,
      ).catch(() => {});

      const compactResult = await autoCompactIfNeeded(
        messages,
        preTokens,
        config.model,
        provider,
        systemPrompt,
        compactState,
      );
      if (compactResult) {
        messages.length = 0;
        messages.push(...compactResult.messages);

        // Fire PostCompact hook after successful compaction
        await runEventHooks(
          config.hooks,
          'PostCompact',
          {
            hook_event_name: 'PostCompact',
            session_id: sessionId,
            cwd: config.cwd,
            summary: compactResult.summary,
            tokens_freed: compactResult.tokensFreed,
          },
          config.abortSignal,
        ).catch(() => {});

        const compactMsg: SDKMessage = {
          type: 'system',
          subtype: 'compact_boundary',
          summary: compactResult.summary,
          compact_metadata: {
            trigger: 'auto',
            pre_tokens: preTokens,
          },
          session_id: sessionId,
          uuid: randomUUID(),
        };
        yield compactMsg;
        options?.onProgress?.(compactMsg);
      }
    }

    // Extract tool use blocks
    const toolUseBlocks = extractToolUseBlocks(assistantMessage);

    // Check termination: no tool calls means the model is done
    if (toolUseBlocks.length === 0) {
      // Handle max_tokens recovery (model hit output limit)
      if (accumulated.stopReason === 'max_tokens') {
        if (maxTokensRecoveryCount < MAX_TOKENS_RECOVERY_LIMIT) {
          maxTokensRecoveryCount++;
          messages.push(buildUserMessage(MAX_TOKENS_RECOVERY_MSG));
          continue;
        }
      }

      // Success — model completed its turn.
      // Extract text from the last assistant message as the result string.
      const lastContent = accumulated.content;
      const textBlocks = lastContent.filter((b) => b.type === 'text');
      const resultText = textBlocks
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n');

      console.log(`[QUERY-LOOP] yielding result (success) turn=${turn} stopReason=${accumulated.stopReason} t=${Date.now()}`);
      const resultMsg: SDKMessage = {
        type: 'result',
        subtype: 'success',
        result: resultText,
        is_error: false,
        num_turns: turn,
        total_cost_usd: costTracker.totalCostUsd,
        usage: costTracker.getUsage(),
        modelUsage: costTracker.getModelUsage(),
        session_id: sessionId,
        stop_reason: accumulated.stopReason,
        duration_ms: Date.now() - startTime,
        duration_api_ms: totalApiTimeMs,
        permission_denials: permissionDenials,
        uuid: randomUUID(),
      };
      yield resultMsg;
      options?.onProgress?.(resultMsg);
      return;
    }

    // Reset max_tokens recovery counter when tools are being called
    maxTokensRecoveryCount = 0;

    // Execute tools in parallel, collecting progress messages for yielding
    const toolCtx = buildToolContext(config, sessionId, costTracker, turn);
    const pendingToolProgress: SDKMessage[] = [];

    // Per-tool sub-agent message buffers (Agent tool forwards child messages here)
    const subAgentMsgBuffers = new Map<string, SDKMessage[]>();

    /** Build a tool_progress message with required uuid/session_id fields. */
    function toolProgress(
      toolName: string,
      toolUseId: string,
      elapsedTimeSec?: number,
    ): SDKMessage {
      return {
        type: 'tool_progress',
        tool_name: toolName,
        tool_use_id: toolUseId,
        parent_tool_use_id: null,
        ...(elapsedTimeSec !== undefined ? { elapsed_time_seconds: elapsedTimeSec } : {}),
        uuid: randomUUID(),
        session_id: sessionId,
      };
    }

    const toolStartTimes = new Map<string, number>();

    const toolResultPromises = toolUseBlocks.map(async (toolUse) => {
      const tool = findTool(tools, toolUse.name);
      toolStartTimes.set(toolUse.id, Date.now());

      // Build per-call context with toolUseId + sub-agent message forwarding
      const subAgentMsgs: SDKMessage[] = [];
      subAgentMsgBuffers.set(toolUse.id, subAgentMsgs);
      const perCallCtx: ToolContext = {
        ...toolCtx,
        toolUseId: toolUse.id,
        onSubAgentMessage: (msg) => subAgentMsgs.push(msg as SDKMessage),
      };

      // Emit tool_progress: running
      const runningMsg = toolProgress(toolUse.name, toolUse.id);
      pendingToolProgress.push(runningMsg);
      options?.onProgress?.(runningMsg);

      if (!tool) {
        const errorContent = `Tool "${toolUse.name}" not found. Available tools: ${tools.map((t) => t.name).join(', ')}`;
        const elapsed = (Date.now() - (toolStartTimes.get(toolUse.id) ?? Date.now())) / 1000;
        const doneMsg = toolProgress(toolUse.name, toolUse.id, elapsed);
        pendingToolProgress.push(doneMsg);
        options?.onProgress?.(doneMsg);
        return { toolUseId: toolUse.id, content: errorContent, isError: true };
      }

      // --- PreToolUse hooks ---
      const preHookResult = await runPreToolUseHooks(
        config.hooks,
        toolUse.name,
        toolUse.input,
        toolUse.id,
        sessionId,
        config.cwd,
        config.abortSignal,
      );

      // Hook can deny tool execution
      if (preHookResult.decision === 'deny') {
        const reason = preHookResult.decisionReason || 'Denied by PreToolUse hook';
        const elapsed = (Date.now() - (toolStartTimes.get(toolUse.id) ?? Date.now())) / 1000;
        const doneMsg = toolProgress(toolUse.name, toolUse.id, elapsed);
        pendingToolProgress.push(doneMsg);
        options?.onProgress?.(doneMsg);
        return { toolUseId: toolUse.id, content: reason, isError: true };
      }

      // Hook can modify tool input
      if (preHookResult.updatedInput) {
        Object.assign(toolUse.input, preHookResult.updatedInput);
      }

      // Check canUseTool permission callback (after hooks, so hooks can modify input first).
      // When bypassPermissions + allowDangerouslySkipPermissions, skip the check entirely.
      const skipPermissionCheck = config.permissionMode === 'bypassPermissions';
      if (config.canUseTool && !skipPermissionCheck) {
        try {
          const permResult = await config.canUseTool(toolUse.name, toolUse.input, {
            signal: config.abortSignal,
            toolUseID: toolUse.id,
          });
          if (permResult.behavior === 'deny') {
            // Track denial for the result message (CC SDK SDKPermissionDenial)
            permissionDenials.push({
              tool_name: toolUse.name,
              tool_use_id: toolUse.id,
              tool_input: { ...toolUse.input },
            });

            const deniedContent = permResult.message
              ? `Permission denied: ${permResult.message}`
              : 'Permission denied';
            const elapsed = (Date.now() - (toolStartTimes.get(toolUse.id) ?? Date.now())) / 1000;
            const doneMsg = toolProgress(toolUse.name, toolUse.id, elapsed);
            pendingToolProgress.push(doneMsg);
            options?.onProgress?.(doneMsg);

            return { toolUseId: toolUse.id, content: deniedContent, isError: true, interrupt: !!permResult.interrupt };
          }
          // Apply updated input if provided
          if (permResult.updatedInput) {
            Object.assign(toolUse.input, permResult.updatedInput);
          }
        } catch (permErr: unknown) {
          const errMsg = permErr instanceof Error ? permErr.message : String(permErr);
          return { toolUseId: toolUse.id, content: `Permission check error: ${errMsg}`, isError: true };
        }
      }

      const result = await executeTool(tool, toolUse.input, perCallCtx, config.toolResultBudget);

      // --- PostToolUse / PostToolUseFailure hooks ---
      if (result.isError) {
        await runPostToolUseFailureHooks(
          config.hooks,
          toolUse.name,
          toolUse.input,
          result.content,
          toolUse.id,
          sessionId,
          config.cwd,
          config.abortSignal,
        );
      } else {
        const postResult = await runPostToolUseHooks(
          config.hooks,
          toolUse.name,
          toolUse.input,
          result.content,
          toolUse.id,
          sessionId,
          config.cwd,
          config.abortSignal,
        );

        // PostToolUse hooks can append additional context
        if (postResult.additionalContext) {
          result.content += `\n\n${postResult.additionalContext}`;
        }
      }

      // Prepend additional context from PreToolUse hooks (if any)
      if (preHookResult.additionalContext) {
        result.content = `${preHookResult.additionalContext}\n\n${result.content}`;
      }

      const elapsed = (Date.now() - (toolStartTimes.get(toolUse.id) ?? Date.now())) / 1000;
      const completedMsg = toolProgress(toolUse.name, toolUse.id, elapsed);
      pendingToolProgress.push(completedMsg);
      options?.onProgress?.(completedMsg);

      return { toolUseId: toolUse.id, content: result.content, isError: result.isError };
    });

    const toolResults = await Promise.all(toolResultPromises);

    // Check if any tool result requested interrupt (permission denied with interrupt: true)
    const shouldInterrupt = toolResults.some((r) => (r as { interrupt?: boolean }).interrupt);

    // Yield all collected tool_progress messages from the generator
    for (const progressMsg of pendingToolProgress) {
      yield progressMsg;
    }

    // Yield sub-agent messages forwarded by Agent tool (task lifecycle + child messages).
    // Emitted in tool-call order to ensure task_started precedes child messages.
    for (const toolUse of toolUseBlocks) {
      const subMsgs = subAgentMsgBuffers.get(toolUse.id);
      if (subMsgs) {
        for (const subMsg of subMsgs) {
          yield subMsg;
          options?.onProgress?.(subMsg);
        }
      }
    }

    // Build tool result message and add to conversation
    const toolResultMessage = buildToolResultMessage(toolResults);
    messages.push(toolResultMessage);

    // Yield user message (tool results)
    const userUuid = randomUUID();
    const userMsg: SDKMessage = {
      type: 'user',
      message: toolResultMessage as { role: 'user'; content: ContentBlock[] },
      parent_tool_use_id: null,
      uuid: userUuid,
      session_id: sessionId,
    };
    yield userMsg;
    options?.onProgress?.(userMsg);

    // If a permission denial requested interrupt, stop the loop
    if (shouldInterrupt) {
      const resultMsg = buildErrorResult(
        'error_during_execution',
        ['Interrupted by permission denial'],
        turn,
      );
      yield resultMsg;
      options?.onProgress?.(resultMsg);
      return;
    }

    // Continue to next turn
  }
}

