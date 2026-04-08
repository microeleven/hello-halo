/**
 * @module types/tool
 * Tool interface, ToolResult, ToolContext, and related types.
 * @license MIT
 */

import type { CostTracker } from '../core/cost.js';

// ---------------------------------------------------------------------------
// PermissionLevel
// ---------------------------------------------------------------------------

/** Permission level required by a tool. */
export type PermissionLevel =
  | 'none'       // Read-only, purely informational
  | 'readonly'   // Read-only access to filesystem or network
  | 'write'      // Write access to filesystem
  | 'execute';   // Arbitrary command execution

// ---------------------------------------------------------------------------
// ToolResult
// ---------------------------------------------------------------------------

/** The result of executing a tool. */
export interface ToolResult {
  /** Content to send back to the model as the tool result */
  content: string;
  /** Whether this invocation was an error */
  isError: boolean;
  /** Optional structured metadata */
  metadata?: Record<string, unknown>;
}

/** Create a successful ToolResult. */
export function toolSuccess(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { content, isError: false, metadata };
}

/** Create an error ToolResult. */
export function toolError(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { content, isError: true, metadata };
}

// ---------------------------------------------------------------------------
// ShellState
// ---------------------------------------------------------------------------

/**
 * Persistent shell state shared across Bash tool invocations within one session.
 * Tracks cwd and env variables so `cd` and `export` persist across tool calls.
 */
export interface ShellState {
  /** Current working directory as tracked by the shell state */
  cwd: string;
  /** Environment variable overrides exported by previous commands */
  envVars: Map<string, string>;
}

// ---------------------------------------------------------------------------
// ToolContext
// ---------------------------------------------------------------------------

/**
 * Shared context passed to every tool invocation.
 * Provides access to session state, filesystem, cost tracking, etc.
 */
export interface ToolContext {
  /** Unique session identifier */
  sessionId: string;
  /** Current working directory for this session */
  cwd: string;
  /** Abort signal for cancellation */
  abortSignal: AbortSignal;
  /** Cost tracker for budget enforcement */
  costTracker: CostTracker;
  /** Optional MCP manager for MCP tools */
  mcpManager?: unknown;
  /** Persistent shell state for Bash tool */
  shellState?: ShellState;
  /** File read cache for deduplication */
  fileReadCache?: Map<string, { mtime: number; content: string }>;
  /** Current turn index in the query loop */
  currentTurn: number;
  /** Environment variables for this session */
  env: Record<string, string | undefined>;
  /** Additional directories the agent can access */
  additionalDirectories?: string[];
  /** Callback for recording file changes (for undo/rewind) */
  recordFileChange?: (path: string, beforeContent: Buffer, afterContent: Buffer) => void;
  /**
   * The tool_use ID for this specific invocation.
   * Set by the query loop so the AgentTool can associate messages
   * with the correct parent tool_use block.
   */
  toolUseId?: string;
  /**
   * Callback to forward sub-agent SDKMessages to the parent stream.
   * Called by AgentTool/spawner with messages tagged by parent_tool_use_id.
   * Uses Record<string,unknown> to avoid circular import with query-loop.
   */
  onSubAgentMessage?: (msg: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------------------
// Tool interface
// ---------------------------------------------------------------------------

/**
 * The interface every tool must implement.
 * Tools are capabilities the LLM can invoke during the ReAct loop.
 */
export interface Tool {
  /** Human-readable tool name */
  readonly name: string;
  /**
   * Description shown to the LLM.
   * Carefully engineered prompt — do not modify without testing LLM behavior.
   */
  readonly description: string;
  /** JSON Schema describing the tool's input parameters */
  readonly inputSchema: Record<string, unknown>;
  /** Permission level required by this tool */
  readonly permissionLevel: PermissionLevel;
  /** Execute the tool with the given input */
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// ToolDefinition (for LLM API)
// ---------------------------------------------------------------------------

/** Tool definition suitable for sending to the LLM API. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Convert a Tool to a ToolDefinition for the LLM API. */
export function toToolDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}
