/**
 * @module core/hooks
 * Hook execution engine for the Agent-Core SDK.
 * Fires registered hook callbacks (PreToolUse, PostToolUse, PostToolUseFailure,
 * PreCompact, PostCompact, SessionStart, SessionEnd, etc.) with tool-name
 * matching and optional timeout enforcement.
 *
 * Settings-based hooks are translated into
 * HookCallbackMatcher[] by the consumer and passed via Options.hooks.
 * @license MIT
 */

import type {
  HookEvent,
  HookCallbackMatcher,
  HookInput,
} from '../types/config.js';

// ---------------------------------------------------------------------------
// Hook result types
// ---------------------------------------------------------------------------

/**
 * Result from a PreToolUse hook execution.
 * If `decision` is set, the hook made a permission decision.
 */
export interface PreToolUseHookResult {
  /** Hook permission decision: 'allow', 'deny', or undefined (no opinion). */
  decision?: 'allow' | 'deny';
  /** Reason for the decision. */
  decisionReason?: string;
  /** Updated tool input (if the hook modified it). */
  updatedInput?: Record<string, unknown>;
  /** Additional context to inject into the conversation. */
  additionalContext?: string;
}

/**
 * Result from a PostToolUse hook execution.
 */
export interface PostToolUseHookResult {
  /** Additional context to inject. */
  additionalContext?: string;
  /** Updated MCP tool output (if the hook modified it). */
  updatedToolOutput?: unknown;
}

// ---------------------------------------------------------------------------
// Default timeout
// ---------------------------------------------------------------------------

const DEFAULT_HOOK_TIMEOUT_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// Matcher logic
// ---------------------------------------------------------------------------

/**
 * Check if a tool name matches a matcher pattern.
 * - undefined/empty matcher: matches all tools
 * - exact string: case-sensitive match
 * - glob-like: supports trailing '*' (e.g., "Bash*", "mcp__*")
 */
function toolMatchesMatcher(toolName: string, matcher?: string): boolean {
  if (!matcher) return true;
  if (matcher === toolName) return true;
  if (matcher.endsWith('*')) {
    return toolName.startsWith(matcher.slice(0, -1));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

/**
 * Run a callback with a timeout. Rejects with an error if the callback
 * does not resolve within the given number of milliseconds.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Hook "${label}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ---------------------------------------------------------------------------
// Core execution
// ---------------------------------------------------------------------------

/**
 * Run all matching hooks for a given event.
 * Hooks are executed sequentially (not in parallel) to preserve ordering
 * and allow earlier hooks to influence later ones.
 *
 * @returns Array of all hook outputs (including empty objects for hooks
 *          that didn't return anything meaningful).
 */
export async function runHooks(
  event: HookEvent,
  matchers: HookCallbackMatcher[] | undefined,
  input: HookInput | Record<string, unknown>,
  toolUseId: string | undefined,
  signal: AbortSignal,
  toolName?: string,
): Promise<Record<string, unknown>[]> {
  if (!matchers || matchers.length === 0) return [];

  const results: Record<string, unknown>[] = [];

  for (const matcher of matchers) {
    // Check tool name matching (for PreToolUse/PostToolUse/PostToolUseFailure)
    if (toolName !== undefined && !toolMatchesMatcher(toolName, matcher.matcher)) {
      continue;
    }

    const timeoutMs = matcher.timeout
      ? matcher.timeout * 1000 // timeout is in seconds in the config
      : DEFAULT_HOOK_TIMEOUT_MS;

    for (const hook of matcher.hooks) {
      if (signal.aborted) break;

      try {
        const result = await withTimeout(
          hook(input as HookInput, toolUseId, { signal }),
          timeoutMs,
          `${event}${matcher.matcher ? `:${matcher.matcher}` : ''}`,
        );
        if (result && typeof result === 'object') {
          results.push(result as Record<string, unknown>);
        }
      } catch (err: unknown) {
        // Log but don't propagate hook errors — hooks are advisory
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ hookError: msg });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Typed hook runners for tool lifecycle
// ---------------------------------------------------------------------------

/**
 * Run PreToolUse hooks for a specific tool invocation.
 * Returns the merged result affecting permission and input.
 */
export async function runPreToolUseHooks(
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId: string,
  sessionId: string,
  cwd: string,
  signal: AbortSignal,
): Promise<PreToolUseHookResult> {
  if (!hooks?.PreToolUse) return {};

  const input: Record<string, unknown> = {
    hook_event_name: 'PreToolUse',
    session_id: sessionId,
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: toolUseId,
  };

  const outputs = await runHooks(
    'PreToolUse',
    hooks.PreToolUse,
    input,
    toolUseId,
    signal,
    toolName,
  );

  // Merge outputs: last non-undefined decision wins
  const result: PreToolUseHookResult = {};
  for (const out of outputs) {
    if ('hookError' in out) continue;
    if (out.permissionDecision === 'allow' || out.permissionDecision === 'deny') {
      result.decision = out.permissionDecision as 'allow' | 'deny';
      if (out.permissionDecisionReason) {
        result.decisionReason = String(out.permissionDecisionReason);
      }
    }
    if (out.updatedInput && typeof out.updatedInput === 'object') {
      result.updatedInput = out.updatedInput as Record<string, unknown>;
    }
    if (out.additionalContext) {
      result.additionalContext = result.additionalContext
        ? `${result.additionalContext}\n${String(out.additionalContext)}`
        : String(out.additionalContext);
    }
  }

  return result;
}

/**
 * Run PostToolUse hooks after a tool completes successfully.
 */
export async function runPostToolUseHooks(
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: unknown,
  toolUseId: string,
  sessionId: string,
  cwd: string,
  signal: AbortSignal,
): Promise<PostToolUseHookResult> {
  if (!hooks?.PostToolUse) return {};

  const input: Record<string, unknown> = {
    hook_event_name: 'PostToolUse',
    session_id: sessionId,
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: toolResponse,
    tool_use_id: toolUseId,
  };

  const outputs = await runHooks(
    'PostToolUse',
    hooks.PostToolUse,
    input,
    toolUseId,
    signal,
    toolName,
  );

  const result: PostToolUseHookResult = {};
  for (const out of outputs) {
    if ('hookError' in out) continue;
    if (out.additionalContext) {
      result.additionalContext = result.additionalContext
        ? `${result.additionalContext}\n${String(out.additionalContext)}`
        : String(out.additionalContext);
    }
    if (out.updatedMCPToolOutput !== undefined) {
      result.updatedToolOutput = out.updatedMCPToolOutput;
    }
  }

  return result;
}

/**
 * Run PostToolUseFailure hooks when a tool execution fails.
 */
export async function runPostToolUseFailureHooks(
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined,
  toolName: string,
  toolInput: Record<string, unknown>,
  error: string,
  toolUseId: string,
  sessionId: string,
  cwd: string,
  signal: AbortSignal,
): Promise<void> {
  if (!hooks?.PostToolUseFailure) return;

  const input: Record<string, unknown> = {
    hook_event_name: 'PostToolUseFailure',
    session_id: sessionId,
    cwd,
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: toolUseId,
    error,
  };

  await runHooks(
    'PostToolUseFailure',
    hooks.PostToolUseFailure,
    input,
    toolUseId,
    signal,
    toolName,
  );
}

/**
 * Run event hooks that are not tool-specific (SessionStart, SessionEnd, etc.).
 */
export async function runEventHooks(
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined,
  event: HookEvent,
  input: HookInput | Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown>[]> {
  if (!hooks?.[event]) return [];
  return runHooks(event, hooks[event], input, undefined, signal);
}
