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

/**
 * Classification of a permission decision for telemetry.
 * SDK hosts that prompt users should set this to reflect what happened:
 *   - user_temporary for allow-once
 *   - user_permanent for always-allow (both the click and later cache hits)
 *   - user_reject for deny
 */
export type PermissionDecisionClassification =
  | 'user_temporary'
  | 'user_permanent'
  | 'user_reject';

/**
 * A suggested permission update that can be returned as part of a PermissionResult
 * to persistently change permission rules so the user is not prompted again.
 */
export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg';

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionUpdate =
  | { type: 'addRules'; rules: PermissionRuleValue[]; behavior: PermissionBehavior; destination: PermissionUpdateDestination }
  | { type: 'replaceRules'; rules: PermissionRuleValue[]; behavior: PermissionBehavior; destination: PermissionUpdateDestination }
  | { type: 'removeRules'; rules: PermissionRuleValue[]; behavior: PermissionBehavior; destination: PermissionUpdateDestination }
  | { type: 'setMode'; mode: PermissionMode; destination: PermissionUpdateDestination }
  | { type: 'addDirectories'; directories: string[]; destination: PermissionUpdateDestination }
  | { type: 'removeDirectories'; directories: string[]; destination: PermissionUpdateDestination };

/** Permission callback function for controlling tool usage. */
export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    /** Signaled if the operation should be aborted. */
    signal: AbortSignal;
    /** Suggestions for updating permissions so the user will not be prompted again. */
    suggestions?: PermissionUpdate[];
    /** The file path that triggered the permission request, if applicable. */
    blockedPath?: string;
    /** Explains why this permission request was triggered. */
    decisionReason?: string;
    /** Full permission prompt sentence rendered by the bridge. */
    title?: string;
    /** Short noun phrase for the tool action (e.g. "Read file"). */
    displayName?: string;
    /** Human-readable subtitle from the bridge. */
    description?: string;
    /** Unique identifier for this specific tool call. */
    toolUseID: string;
    /** If running within a sub-agent, the sub-agent's ID. */
    agentID?: string;
  },
) => Promise<PermissionResult>;

export type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
      decisionClassification?: PermissionDecisionClassification;
    }
  | {
      behavior: 'deny';
      message?: string;
      interrupt?: boolean;
      toolUseID?: string;
      decisionClassification?: PermissionDecisionClassification;
    };

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
  | 'StopFailure'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'Setup'
  | 'TeammateIdle'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'Elicitation'
  | 'ElicitationResult'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'InstructionsLoaded'
  | 'CwdChanged'
  | 'FileChanged';

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
  /** Critical reminder added to system prompt */
  criticalSystemReminder_EXPERIMENTAL?: string;
  /** Skill names to preload into the agent context */
  skills?: string[];
  /** Auto-submitted as the first user turn for main-thread agents */
  initialPrompt?: string;
  /** Maximum agentic turns */
  maxTurns?: number;
  /** Run as background task */
  background?: boolean;
  /** Agent memory scope */
  memory?: 'user' | 'project' | 'local';
  /** Reasoning effort level */
  effort?: EffortLevel | number;
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
  /** Stderr callback */
  stderr?: (data: string) => void;
  /** Strict MCP config validation */
  strictMcpConfig?: boolean;
  /** System prompt configuration */
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string };

  /** Enable prompt suggestions after each turn. */
  promptSuggestions?: boolean;
  /** Enable periodic AI-generated progress summaries for subagents. */
  agentProgressSummaries?: boolean;
  /** Sandbox settings for command execution isolation. */
  sandbox?: Record<string, unknown>;
  /** Additional settings (path to JSON or inline object). */
  settings?: string | Record<string, unknown>;
  /** Control which filesystem settings to load. */
  settingSources?: SettingSource[];
  /** Enable debug mode. */
  debug?: boolean;
  /** Write debug logs to a specific file path. */
  debugFile?: string;
  /** Callback for handling MCP elicitation requests. */
  onElicitation?: (
    request: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<Record<string, unknown>>;
  /** Plugins to load for this session. */
  plugins?: Array<{ type: string; path: string }>;

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

  // --- CC SDK compatibility aliases ---
  // These fields allow CC SDK options objects (with apiKey/anthropicBaseUrl
  // at the top level) to be passed directly to the in-process SDK.

  /**
   * Anthropic API key. CC SDK compat alias — the in-process SDK reads this
   * and creates a provider automatically. Equivalent to env.ANTHROPIC_API_KEY.
   */
  apiKey?: string;
  /**
   * Anthropic API base URL. CC SDK compat alias.
   * Equivalent to env.ANTHROPIC_BASE_URL.
   */
  anthropicBaseUrl?: string;
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
