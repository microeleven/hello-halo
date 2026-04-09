/**
 * @module types/config
 * Options, QueryConfig, AgentContext — the configuration surface area of the SDK.
 * @license MIT
 */

import type { LlmProvider } from './provider.js';
import type { Tool, ToolContext, ShellState } from './tool.js';
import type { CostTracker } from '../core/cost.js';

// ---------------------------------------------------------------------------
// PermissionMode
// ---------------------------------------------------------------------------

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'
  | 'auto';

// ---------------------------------------------------------------------------
// CanUseTool callback
// ---------------------------------------------------------------------------

/** Permission callback function for controlling tool usage. */
export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    toolUseID: string;
    agentID?: string;
  },
) => Promise<PermissionResult>;

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message?: string; interrupt?: boolean };

// ---------------------------------------------------------------------------
// HookEvent system (simplified — SDK preserves callback interface)
// ---------------------------------------------------------------------------

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact';

export type HookCallback = (
  input: Record<string, unknown>,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<Record<string, unknown>>;

export interface HookCallbackMatcher {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
}

// ---------------------------------------------------------------------------
// MCP Server Config
// ---------------------------------------------------------------------------

export type McpStdioServerConfig = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpSSEServerConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
};

export type McpHttpServerConfig = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

export type McpSdkServerConfig = {
  type: 'sdk';
  name: string;
};

export type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfig
  | McpSdkServerConfigWithInstance;

/**
 * SDK server config with a live instance (not serializable).
 * Created by `createSdkMcpServer()`.
 */
export type McpSdkServerConfigWithInstance = McpSdkServerConfig & {
  instance: import('../tools/mcp/sdk-server.js').SdkMcpServerInstance;
};

export type McpServerStatus = {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverInfo?: { name: string; version: string };
  error?: string;
  tools?: Array<{ name: string; description?: string }>;
};

export type McpSetServersResult = {
  added: string[];
  removed: string[];
  errors: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Agent Definition
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  /** Natural language description of when to use this agent */
  description: string;
  /** Array of allowed tool names */
  tools?: string[];
  /** Array of tool names to explicitly disallow */
  disallowedTools?: string[];
  /** The agent's system prompt */
  prompt: string;
  /** Model alias or full model ID */
  model?: string;
  /** MCP servers for this agent */
  mcpServers?: Array<string | Record<string, McpServerConfig>>;
  /** Maximum agentic turns */
  maxTurns?: number;
  /** Run as background task */
  background?: boolean;
  /** Permission mode */
  permissionMode?: PermissionMode;
}

// ---------------------------------------------------------------------------
// Output Format
// ---------------------------------------------------------------------------

export type OutputFormat = {
  type: 'json_schema';
  schema: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// SdkBeta
// ---------------------------------------------------------------------------

export type SdkBeta = 'context-1m-2025-08-07' | string;

// ---------------------------------------------------------------------------
// SettingSource
// ---------------------------------------------------------------------------

export type SettingSource = 'user' | 'project' | 'local';

// ---------------------------------------------------------------------------
// ModelInfo
// ---------------------------------------------------------------------------

export interface ModelInfo {
  value: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: Array<'low' | 'medium' | 'high' | 'max'>;
  supportsAdaptiveThinking?: boolean;
}

// ---------------------------------------------------------------------------
// SlashCommand
// ---------------------------------------------------------------------------

export interface SlashCommand {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// ThinkingConfig
// ---------------------------------------------------------------------------

export type ThinkingConfig =
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'adaptive' }
  | { type: 'disabled' };

// ---------------------------------------------------------------------------
// EffortLevel
// ---------------------------------------------------------------------------

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

// ---------------------------------------------------------------------------
// Options — the primary configuration for query()
// ---------------------------------------------------------------------------

/**
 * Options for the query function.
 */
export interface Options {
  /** Controller for cancelling the query */
  abortController?: AbortController;
  /** Additional directories Claude can access beyond cwd */
  additionalDirectories?: string[];
  /** Agent name for the main thread */
  agent?: string;
  /** Custom subagent definitions */
  agents?: Record<string, AgentDefinition>;
  /** Tool names that are auto-allowed without prompting */
  allowedTools?: string[];
  /** Custom permission handler */
  canUseTool?: CanUseTool;
  /** Continue the most recent conversation */
  continue?: boolean;
  /** Current working directory */
  cwd?: string;
  /** Tool names that are disallowed */
  disallowedTools?: string[];
  /** Base set of available built-in tools */
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  /** Environment variables */
  env?: Record<string, string | undefined>;
  /** Fallback model */
  fallbackModel?: string;
  /** Enable file checkpointing */
  enableFileCheckpointing?: boolean;
  /** Per-tool configuration for built-in tools. */
  toolConfig?: Record<string, Record<string, unknown>>;
  /** Fork session on resume */
  forkSession?: boolean;
  /** Beta features */
  betas?: SdkBeta[];
  /** Hook callbacks */
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  /** Session persistence */
  persistSession?: boolean;
  /** Include hook lifecycle events in the output stream. */
  includeHookEvents?: boolean;
  /** Include streaming events in output */
  includePartialMessages?: boolean;
  /** Thinking configuration */
  thinking?: ThinkingConfig;
  /** Effort level */
  effort?: EffortLevel;
  /** @deprecated Use `thinking` instead */
  maxThinkingTokens?: number;
  /** Maximum conversation turns */
  maxTurns?: number;
  /** Maximum budget in USD */
  maxBudgetUsd?: number;
  /** API-side task budget in tokens. Sent as output_config.task_budget. */
  taskBudget?: { total: number };
  /** MCP server configurations */
  mcpServers?: Record<string, McpServerConfig>;
  /** Claude model to use */
  model?: string;
  /** Output format for structured responses */
  outputFormat?: OutputFormat;
  /** Permission mode */
  permissionMode?: PermissionMode;
  /** Must be true when using bypassPermissions */
  allowDangerouslySkipPermissions?: boolean;
  /** MCP tool name for permission prompts */
  permissionPromptToolName?: string;
  /** Session ID to resume */
  resume?: string;
  /** Custom session ID */
  sessionId?: string;
  /** Resume up to a specific message */
  resumeSessionAt?: string;
  /** Settings sources to load */
  settingSources?: SettingSource[];
  /** Stderr callback */
  stderr?: (data: string) => void;
  /** Strict MCP config validation */
  strictMcpConfig?: boolean;
  /** System prompt configuration */
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };

  // --- Agent-Core SDK extensions (superset) ---

  /** LLM provider instance (if not set, uses default Anthropic) */
  provider?: LlmProvider;
  /** Custom tool instances to add to the registry */
  customTools?: Tool[];
  /** Maximum characters per tool result before truncation */
  toolResultBudget?: number;
  /** Slash commands available in this session (names or full objects). */
  slashCommands?: Array<string | SlashCommand>;
  /** Skill names available in this session. */
  skills?: string[];
  /** Path to Claude Code executable (ignored in-process). */
  pathToClaudeCodeExecutable?: string;
  /** JavaScript runtime (ignored in-process). */
  executable?: string;
  /** Additional runtime arguments (ignored in-process). */
  executableArgs?: string[];
  /** Additional CLI arguments (ignored in-process). */
  extraArgs?: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// QueryConfig — internal resolved configuration
// ---------------------------------------------------------------------------

/** Internal resolved configuration derived from Options. */
export interface QueryConfig {
  model: string;
  maxTokens: number;
  maxTurns: number;
  maxBudgetUsd: number;
  cwd: string;
  env: Record<string, string | undefined>;
  systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append?: string };
  thinking: ThinkingConfig;
  effort: EffortLevel;
  toolResultBudget: number;
  includePartialMessages: boolean;
  permissionMode: PermissionMode;
  allowedTools?: string[];
  disallowedTools?: string[];
  agents?: Record<string, AgentDefinition>;
  mcpServers?: Record<string, McpServerConfig>;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  canUseTool?: CanUseTool;
  abortSignal: AbortSignal;
  fallbackModel?: string;
  betas?: SdkBeta[];
  outputFormat?: OutputFormat;
}

// ---------------------------------------------------------------------------
// AgentContext — isolated state for each agent instance
// ---------------------------------------------------------------------------

/** Isolated state for each agent instance (main thread or sub-agent). */
export interface AgentContext {
  /** Unique session identifier */
  sessionId: string;
  /** Resolved configuration */
  config: QueryConfig;
  /** LLM provider instance */
  provider: LlmProvider;
  /** Registered tools */
  tools: Tool[];
  /** Cost tracker */
  costTracker: CostTracker;
  /** Message history */
  messages: Array<import('./provider.js').Message>;
  /** Tool context for tool execution */
  toolContext: ToolContext;
  /** Shell state for Bash tool persistence */
  shellState: ShellState;
  /** Current turn index */
  currentTurn: number;
  /** Whether this is a sub-agent */
  isSubAgent: boolean;
  /** Parent agent ID (if sub-agent) */
  parentAgentId?: string;
}
