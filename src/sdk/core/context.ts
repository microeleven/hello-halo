/**
 * @module core/context
 * AgentContext factory — creates isolated state for each agent instance.
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import type { Message } from '../types/provider.js';
import type { LlmProvider } from '../types/provider.js';
import type {
  Options,
  QueryConfig,
  AgentContext,
} from '../types/config.js';
import type { Tool, ToolContext, ShellState } from '../types/tool.js';
import { CostTracker } from './cost.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_MAX_TURNS = 100;
const DEFAULT_MAX_BUDGET_USD = Infinity;
const DEFAULT_TOOL_RESULT_BUDGET = 50_000;

// ---------------------------------------------------------------------------
// resolveQueryConfig — Options → QueryConfig with defaults
// ---------------------------------------------------------------------------

/**
 * Resolve user-provided Options into a fully populated QueryConfig.
 * Fills in defaults for any unset fields.
 */
export function resolveQueryConfig(options: Options): QueryConfig {
  const abortController = options.abortController ?? new AbortController();

  return {
    model: options.model ?? DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
    maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
    maxBudgetUsd: options.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? {},
    systemPrompt: options.systemPrompt ?? { type: 'preset', preset: 'claude_code' },
    thinking: options.thinking ?? { type: 'disabled' },
    effort: options.effort ?? 'high',
    toolResultBudget: options.toolResultBudget ?? DEFAULT_TOOL_RESULT_BUDGET,
    includePartialMessages: options.includePartialMessages ?? false,
    permissionMode: options.permissionMode ?? 'default',
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    agents: options.agents,
    mcpServers: options.mcpServers,
    hooks: options.hooks,
    canUseTool: options.canUseTool,
    abortSignal: abortController.signal,
    fallbackModel: options.fallbackModel,
    betas: options.betas,
    outputFormat: options.outputFormat,
  };
}

// ---------------------------------------------------------------------------
// createAgentContext — factory function
// ---------------------------------------------------------------------------

/**
 * Create an isolated AgentContext for a query session.
 *
 * @param options - User-provided SDK Options
 * @param provider - LLM provider instance (must be supplied by the caller)
 * @param tools - Array of registered Tool instances
 * @param isSubAgent - Whether this context is for a sub-agent
 * @param parentAgentId - Parent agent ID (if sub-agent)
 * @returns A fully initialized AgentContext
 */
export function createAgentContext(
  options: Options,
  provider: LlmProvider,
  tools: Tool[],
  isSubAgent = false,
  parentAgentId?: string,
): AgentContext {
  const config = resolveQueryConfig(options);
  const sessionId = options.sessionId ?? randomUUID();
  const costTracker = new CostTracker(config.model);

  const shellState: ShellState = {
    cwd: config.cwd,
    envVars: new Map(),
  };

  const messages: Message[] = [];

  const toolContext: ToolContext = {
    sessionId,
    cwd: config.cwd,
    abortSignal: config.abortSignal,
    costTracker,
    shellState,
    fileReadCache: new Map(),
    currentTurn: 0,
    env: config.env as Record<string, string | undefined>,
    additionalDirectories: options.additionalDirectories,
  };

  return {
    sessionId,
    config,
    provider,
    tools,
    costTracker,
    messages,
    toolContext,
    shellState,
    currentTurn: 0,
    isSubAgent,
    parentAgentId,
  };
}
