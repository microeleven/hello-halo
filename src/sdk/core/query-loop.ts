/**
 * @module core/query-loop
 * The ReAct query loop — the heart of the Agent-Core SDK.
 * Mirrors CC Rust: crates/query/src/lib.rs run_query_loop()
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import type {
  Message,
  ContentBlock,
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
import { microCompact, apiCompact, autoCompactIfNeeded, AutoCompactState } from './compact.js';
import { assembleSystemPrompt, splitAtBoundary } from '../prompt/system-prompt.js';
import type { SystemPromptConfig } from '../prompt/system-prompt.js';
import { truncateToolResult } from '../utils/truncate.js';
import { ProviderError, AbortError } from '../utils/errors.js';
import {
  runPreToolUseHooks,
  runPostToolUseHooks,
  runPostToolUseFailureHooks,
} from './hooks.js';
import {
  MAX_TOKENS_RECOVERY_LIMIT,
  MAX_TOKENS_RECOVERY_MSG,
  contextWindowForModel,
} from '../prompt/constants.js';
import type { EffortLevel, ThinkingConfig as CfgThinkingConfig } from '../types/config.js';
import type { ThinkingConfig } from '../types/provider.js';

// ---------------------------------------------------------------------------
// Effort level → provider parameters resolution
// ---------------------------------------------------------------------------

/**
 * Effort-level thinking budget mapping (matches CC Rust: crates/core/src/effort.rs).
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
 * Map effort level to OpenAI-compatible reasoning_effort string
 * (CC Rust: crates/query/src/lib.rs build_provider_options).
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
 * Field naming follows CC SDK's snake_case convention for wire-level
 * compatibility with consumer code (hello-halo, agent-workspace-backend, etc.).
 */
export type SDKMessage =
  // System init
  | {
      type: 'system';
      subtype: 'init';
      session_id: string;
      tools: string[];
      model: string;
      mcp_servers?: Array<{ name: string; status: string }>;
      cwd?: string;
      permissionMode?: string;
      slash_commands?: string[];
      skills?: string[];
      agents?: Array<{ name: string; description: string; model?: string }>;
      uuid: string;
    }
  // Assistant message
  | {
      type: 'assistant';
      message: { role: 'assistant'; content: ContentBlock[] };
      parent_tool_use_id: string | null;
      uuid: string;
      session_id: string;
      usage?: UsageInfo;
      error?: string;
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
      permission_denials: unknown[];
      uuid: string;
    }
  // Result — error
  | {
      type: 'result';
      subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd';
      errors: string[];
      is_error: true;
      num_turns: number;
      total_cost_usd: number;
      usage: UsageInfo;
      modelUsage: Record<string, ModelUsageEntry>;
      session_id: string;
      duration_ms: number;
      duration_api_ms: number;
      permission_denials: unknown[];
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
      session_id: string;
      uuid: string;
    };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

/** Execute a single tool, with error recovery. */
async function executeTool(
  tool: Tool,
  input: Record<string, unknown>,
  ctx: ToolContext,
  toolResultBudget: number,
): Promise<{ content: string; isError: boolean }> {
  try {
    const result = await tool.execute(input, ctx);
    const content = truncateToolResult(result.content, toolResultBudget);
    return { content, isError: result.isError };
  } catch (err: unknown) {
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
    throw new AbortError();
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

/** Sleep helper for retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function accumulateStream(
  stream: AsyncGenerator<StreamEvent, void, undefined>,
  signal: AbortSignal,
  onEvent?: (event: StreamEvent) => void,
): Promise<AccumulatedResponse> {
  const textChunks: string[] = [];
  // tool_call_blocks: index -> { id, name, jsonParts }
  const toolCallBlocks = new Map<number, { id: string; name: string; jsonParts: string[] }>();
  let thinkingChunks: string[] = [];
  let thinkingIndex = -1;
  const usage: UsageInfo = { input_tokens: 0, output_tokens: 0 };
  let stopReason = 'end_turn';
  let msgId = '';
  let msgModel = '';

  for await (const event of stream) {
    if (signal.aborted) {
      throw new AbortError();
    }

    onEvent?.(event);

    switch (event.type) {
      case 'message_start':
        msgId = event.id;
        msgModel = event.model;
        usage.input_tokens = event.usage.input_tokens;
        usage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
        usage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
        break;

      case 'content_block_start':
        if (event.contentBlock.type === 'tool_use') {
          const tb = event.contentBlock as ToolUseBlock;
          toolCallBlocks.set(event.index, { id: tb.id, name: tb.name, jsonParts: [] });
        } else if (event.contentBlock.type === 'thinking') {
          thinkingIndex = event.index;
          thinkingChunks = [];
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
        break;

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

  // Thinking block (if any)
  if (thinkingChunks.length > 0) {
    content.push({ type: 'thinking', thinking: thinkingChunks.join('') });
  }

  // Text block
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
export interface QueryLoopOptions {
  onProgress?: (msg: SDKMessage) => void;
  sessionId?: string;
  /** MCP server connection statuses (for init message). */
  mcpServerStatuses?: Array<{ name: string; status: string; error?: string }>;
  /** Slash command names available in this session (for init message). */
  slashCommands?: string[];
  /** Skill names available in this session (for init message). */
  skills?: string[];
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

  // Build agent info from config.agents
  const agentInfos = config.agents
    ? Object.entries(config.agents).map(([name, def]) => ({
        name,
        description: def.description,
        model: def.model,
      }))
    : undefined;

  // Yield init event
  const initMsg: SDKMessage = {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    tools: tools.map((t) => t.name),
    model: config.model,
    cwd: config.cwd,
    agents: agentInfos,
    mcp_servers: options?.mcpServerStatuses,
    slash_commands: options?.slashCommands,
    skills: options?.skills,
    uuid: randomUUID(),
  };
  yield initMsg;
  options?.onProgress?.(initMsg);

  /** Helper to build an error result message. */
  function buildErrorResult(
    subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd',
    errors: string[],
    numTurns: number,
  ): SDKMessage {
    return {
      type: 'result',
      subtype,
      errors,
      is_error: true,
      num_turns: numTurns,
      total_cost_usd: costTracker.totalCostUsd,
      usage: costTracker.getUsage(),
      modelUsage: costTracker.getModelUsage(),
      session_id: sessionId,
      duration_ms: Date.now() - startTime,
      duration_api_ms: Date.now() - startTime,
      permission_denials: [],
      uuid: randomUUID(),
    };
  }

  let turn = 0;
  let maxTokensRecoveryCount = 0;
  let effectiveModel = config.model;
  let usedFallback = false;
  let retriesLeft = 2;

  while (true) {
    turn++;

    // Check abort
    checkAbort(config.abortSignal);

    // Check max turns
    if (turn > config.maxTurns) {
      const resultMsg = buildErrorResult(
        'error_max_turns',
        [`Max turns exceeded: ${turn - 1} turns completed, limit is ${config.maxTurns}`],
        turn - 1,
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
    const apiCompacted = apiCompact(messages);
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

    // Stream LLM response
    let accumulated: AccumulatedResponse;
    const pendingStreamEvents: SDKMessage[] = [];
    try {
      const streamEventEmitter = config.includePartialMessages
        ? (event: StreamEvent) => {
            const streamMsg: SDKMessage = {
              type: 'stream_event',
              event,
              parent_tool_use_id: null,
              uuid: randomUUID(),
              session_id: sessionId,
            };
            pendingStreamEvents.push(streamMsg);
            options?.onProgress?.(streamMsg);
          }
        : undefined;

      // Resolve effort level to thinking/temperature/reasoningEffort
      const resolved = resolveEffort(config.thinking, config.effort);

      const stream = provider.createMessageStream({
        model: effectiveModel,
        messages: [...messages],
        systemPrompt: fullSystemPrompt,
        tools: toolDefs,
        maxTokens: config.maxTokens,
        thinking: resolved.thinking,
        temperature: resolved.temperature,
        stream: true,
        // Pass reasoning_effort for OpenAI-compat providers via providerOptions
        ...(resolved.reasoningEffort
          ? { providerOptions: { reasoning_effort: resolved.reasoningEffort } }
          : {}),
      });

      accumulated = await accumulateStream(stream, config.abortSignal, streamEventEmitter);

      // Reset retry counter on success
      retriesLeft = 2;
    } catch (err: unknown) {
      // Handle retryable errors
      if (err instanceof ProviderError && err.retryable) {
        // Try fallback model
        if (!usedFallback && config.fallbackModel) {
          effectiveModel = config.fallbackModel;
          usedFallback = true;
          turn--;
          continue;
        }
        // Retry with backoff
        if (retriesLeft > 0) {
          retriesLeft--;
          await sleep(1000 * (3 - retriesLeft));
          turn--;
          continue;
        }
      }

      // Handle abort
      if (err instanceof AbortError || (err instanceof Error && err.name === 'AbortError')) {
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

    // Track costs
    costTracker.add(accumulated.usage, effectiveModel);
    tokenBudget.updateFromUsage(accumulated.usage.input_tokens);

    // Yield collected stream events from the generator
    for (const streamMsg of pendingStreamEvents) {
      yield streamMsg;
    }

    // Build and push assistant message
    const assistantMessage: Message = {
      role: 'assistant',
      content: accumulated.content,
    };
    messages.push(assistantMessage);

    // Yield the assistant message
    const assistantUuid = randomUUID();
    const assistantMsg: SDKMessage = {
      type: 'assistant',
      message: { role: 'assistant', content: accumulated.content },
      parent_tool_use_id: null,
      uuid: assistantUuid,
      session_id: sessionId,
      usage: accumulated.usage,
    };
    yield assistantMsg;
    options?.onProgress?.(assistantMsg);

    // Tier 3: Auto-compact (full compact) — LLM-based summarization if needed
    if (shouldTriggerAutoCompact(accumulated.usage.input_tokens, config.model)) {
      const compactResult = await autoCompactIfNeeded(
        messages,
        accumulated.usage.input_tokens,
        config.model,
        provider,
        systemPrompt,
        compactState,
      );
      if (compactResult) {
        const preTokens = accumulated.usage.input_tokens;
        messages.length = 0;
        messages.push(...compactResult.messages);
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
        duration_api_ms: Date.now() - startTime,
        permission_denials: [],
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

      // Check canUseTool permission callback (after hooks, so hooks can modify input first)
      if (config.canUseTool) {
        try {
          const permResult = await config.canUseTool(toolUse.name, toolUse.input, {
            signal: config.abortSignal,
            toolUseID: toolUse.id,
          });
          if (permResult.behavior === 'deny') {
            const deniedContent = `Permission denied: ${permResult.message}`;
            const elapsed = (Date.now() - (toolStartTimes.get(toolUse.id) ?? Date.now())) / 1000;
            const doneMsg = toolProgress(toolUse.name, toolUse.id, elapsed);
            pendingToolProgress.push(doneMsg);
            options?.onProgress?.(doneMsg);
            return { toolUseId: toolUse.id, content: deniedContent, isError: true };
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

      const result = await executeTool(tool, toolUse.input, toolCtx, config.toolResultBudget);

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

    // Yield all collected tool_progress messages from the generator
    for (const progressMsg of pendingToolProgress) {
      yield progressMsg;
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

    // Continue to next turn
  }
}

/** Check if auto-compact should be triggered. */
function shouldTriggerAutoCompact(inputTokens: number, model: string): boolean {
  const window = contextWindowForModel(model);
  return inputTokens >= Math.floor(window * 0.9);
}
