/**
 * @module orchestrator/spawner
 * AgentSpawner — runs sub-agent query loops in-process.
 *
 * Supports both foreground (blocking) and background (fire-and-forget) modes.
 * The parent's tool execution either awaits the child loop or returns immediately
 * with an agent ID for polling.
 *
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmProvider, ContentBlock } from '../types/provider.js';
import type { Tool, ToolContext, ToolResult } from '../types/tool.js';
import { CostTracker } from '../core/cost.js';
import { toolSuccess, toolError } from '../types/tool.js';
import type { Options, QueryConfig, AgentDefinition } from '../types/config.js';
import { resolveQueryConfig } from '../core/context.js';
import { queryLoop } from '../core/query-loop.js';
import type { SDKMessage } from '../core/query-loop.js';
import { filterTools } from '../tools/registry.js';
import type { AgentSpawnRequest } from '../tools/agent/index.js';
import { AgentRegistry } from './registry.js';

// ---------------------------------------------------------------------------
// Model alias resolution
// ---------------------------------------------------------------------------

const MODEL_ALIASES: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4',
  haiku: 'claude-haiku-3-5',
};

function resolveModel(model: string | undefined, parentModel: string): string {
  if (!model) return parentModel;
  return MODEL_ALIASES[model] ?? model;
}

// ---------------------------------------------------------------------------
// Git worktree isolation helpers
// ---------------------------------------------------------------------------

/** Run a git command and return stdout on success, null on failure. */
function runGit(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd }, (err, stdout) => {
      if (err) {
        resolve(null);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/** Walk up from `start` to find the nearest `.git` directory. */
function findGitRoot(start: string): string | null {
  let dir = start;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const s = statSync(join(dir, '.git'));
      if (s) return dir;
    } catch { /* not a git root, keep going */ }
    const parent = join(dir, '..');
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/**
 * Create a detached git worktree for agent isolation.
 * Returns the worktree directory path on success, null on failure.
 */
async function createWorktree(gitRoot: string, agentId: string): Promise<string | null> {
  const worktreeDir = join(tmpdir(), `claude-agent-${agentId}`);
  const result = await runGit(gitRoot, [
    'worktree', 'add', '--detach', worktreeDir, 'HEAD',
  ]);
  return result !== null ? worktreeDir : null;
}

/** Remove a git worktree (force, ignoring errors). */
async function removeWorktree(gitRoot: string, worktreeDir: string): Promise<void> {
  await runGit(gitRoot, ['worktree', 'remove', '--force', worktreeDir]);
}

// ---------------------------------------------------------------------------
// Extract final assistant text from SDKMessages
// ---------------------------------------------------------------------------

function extractFinalText(messages: SDKMessage[]): string {
  // Walk backwards to find the last assistant message with text
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'assistant') {
      const textBlocks = msg.message.content
        .filter((b: ContentBlock) => b.type === 'text')
        .map((b: ContentBlock) => (b as { type: 'text'; text: string }).text);
      if (textBlocks.length > 0) {
        return textBlocks.join('\n');
      }
    }
  }
  return '(Agent completed with no text output)';
}

// ---------------------------------------------------------------------------
// Build sub-agent tools
// ---------------------------------------------------------------------------

function buildSubAgentTools(
  parentTools: Tool[],
  request: AgentSpawnRequest,
): Tool[] {
  // Start with parent tools, excluding the Agent tool itself (prevent recursion)
  let tools = parentTools.filter((t) => t.name !== 'Agent');

  // If the request specifies allowed tools (from agent type or explicit), filter
  if (request.tools && request.tools.length > 0) {
    tools = filterTools(tools, { allowedTools: request.tools });
  }

  return tools;
}

// ---------------------------------------------------------------------------
// Build sub-agent system prompt
// ---------------------------------------------------------------------------

function buildSubAgentPrompt(request: AgentSpawnRequest, agentDef?: AgentDefinition): string {
  // Priority: explicit systemPrompt > agentDef.prompt > default
  if (request.systemPrompt) return request.systemPrompt;
  if (agentDef?.prompt) return agentDef.prompt;

  // Default sub-agent prompt
  const type = request.agentType?.name ?? 'general-purpose';
  return (
    `You are a sub-agent (type: ${type}) spawned to handle a specific task.\n\n` +
    `Task description: ${request.description}\n\n` +
    `Complete the task described in the user prompt. Be thorough but concise. ` +
    `When finished, provide your final answer as text.`
  );
}

// ---------------------------------------------------------------------------
// Run a sub-agent query loop
// ---------------------------------------------------------------------------

async function runSubAgent(
  agentId: string,
  request: AgentSpawnRequest,
  parentConfig: QueryConfig,
  provider: LlmProvider,
  parentTools: Tool[],
  agentAbortSignal: AbortSignal,
  parentAgents?: Record<string, AgentDefinition>,
  parentToolUseId?: string,
  onMessage?: (msg: Record<string, unknown>) => void,
  parentSessionId?: string,
): Promise<{ text: string; messages: SDKMessage[]; costUsd: number; turns: number }> {
  const model = resolveModel(request.model, parentConfig.model);
  const tools = buildSubAgentTools(parentTools, request);

  // Resolve agent definition from parent's agents config
  const agentDef = request.agentType?.name && parentAgents
    ? parentAgents[request.agentType.name]
    : undefined;

  const systemPrompt = buildSubAgentPrompt(request, agentDef);

  // Resolve worktree isolation if requested
  const useWorktree = request.isolation === 'worktree';
  let worktreeDir: string | null = null;
  let gitRoot: string | null = null;
  let effectiveCwd = parentConfig.cwd;

  if (useWorktree) {
    gitRoot = findGitRoot(parentConfig.cwd);
    if (gitRoot) {
      worktreeDir = await createWorktree(gitRoot, agentId);
      if (worktreeDir) {
        effectiveCwd = worktreeDir;
      } else {
        console.warn(
          `[SDK] Worktree creation failed for agent ${agentId}; using shared cwd`,
        );
      }
    } else {
      console.warn(
        `[SDK] No git root found for agent ${agentId}; isolation=worktree ignored`,
      );
    }
  }

  // Build sub-agent options
  const subOptions: Options = {
    model,
    maxTurns: request.maxTurns ?? agentDef?.maxTurns ?? parentConfig.maxTurns,
    maxBudgetUsd: parentConfig.maxBudgetUsd,
    cwd: effectiveCwd,
    env: parentConfig.env,
    systemPrompt,
    thinking: parentConfig.thinking,
    effort: parentConfig.effort,
    abortController: new AbortController(),
  };

  // Wire the parent abort signal to the child
  const subAbort = subOptions.abortController!;
  const onParentAbort = () => subAbort.abort();
  agentAbortSignal.addEventListener('abort', onParentAbort, { once: true });

  const subConfig = resolveQueryConfig(subOptions);
  const configWithSignal = { ...subConfig, abortSignal: subAbort.signal };

  // Session ID used for emitted messages — use parent session ID for proper routing
  const sessionIdForMessages = parentSessionId ?? '';

  // Emit task_started — signals the consumer to initialize task progress UI
  if (onMessage && parentToolUseId) {
    onMessage({
      type: 'system',
      subtype: 'task_started',
      task_id: agentId,
      tool_use_id: parentToolUseId,
      description: request.description,
      session_id: sessionIdForMessages,
      uuid: randomUUID(),
    });
  }

  const collected: SDKMessage[] = [];
  let costUsd = 0;
  let turns = 0;
  let toolUseCount = 0;
  let lastToolName: string | undefined;
  const startedAt = Date.now();

  try {
    const gen = queryLoop(configWithSignal, provider, tools, request.prompt);

    for await (const msg of gen) {
      collected.push(msg);

      if (msg.type === 'result') {
        costUsd = msg.total_cost_usd;
        turns = msg.num_turns;
      }

      // Forward assistant/user messages to parent stream with parent_tool_use_id tagged.
      // This lets the consumer render a real-time sub-agent timeline.
      if (onMessage && (msg.type === 'assistant' || msg.type === 'user')) {
        const tagged: Record<string, unknown> = {
          ...(msg as unknown as Record<string, unknown>),
          parent_tool_use_id: parentToolUseId ?? null,
          uuid: randomUUID(), // fresh uuid so parent stream deduplicates correctly
        };
        onMessage(tagged);

        // Track tool_use blocks from assistant messages for task_progress stats
        if (msg.type === 'assistant') {
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content as unknown as Array<Record<string, unknown>>) {
              if (block.type === 'tool_use') {
                toolUseCount++;
                if (typeof block.name === 'string') lastToolName = block.name;
              }
            }
          }
        }

        // Emit task_progress after each completed turn (user message = tool results returned)
        if (msg.type === 'user') {
          onMessage({
            type: 'system',
            subtype: 'task_progress',
            task_id: agentId,
            session_id: sessionIdForMessages,
            uuid: randomUUID(),
            last_tool_name: lastToolName,
            usage: {
              total_tokens: 0, // sub-agent token counts tracked separately via CostTracker
              tool_uses: toolUseCount,
              duration_ms: Date.now() - startedAt,
            },
          });
        }
      }
    }
  } finally {
    agentAbortSignal.removeEventListener('abort', onParentAbort);
  }

  // Emit task_notification — signals the consumer that the agent has finished
  if (onMessage) {
    const completionStatus = agentAbortSignal.aborted ? 'stopped' : 'completed';
    onMessage({
      type: 'system',
      subtype: 'task_notification',
      task_id: agentId,
      status: completionStatus,
      session_id: sessionIdForMessages,
      uuid: randomUUID(),
      output_file: '',
      usage: {
        total_tokens: 0,
        tool_uses: toolUseCount,
        duration_ms: Date.now() - startedAt,
      },
      summary: extractFinalText(collected),
    });
  }

  // Cleanup worktree if one was created
  if (worktreeDir && gitRoot) {
    await removeWorktree(gitRoot, worktreeDir).catch(() => {
      console.warn(`[SDK] Failed to remove worktree ${worktreeDir}`);
    });
  }

  const text = extractFinalText(collected);
  return { text, messages: collected, costUsd, turns };
}

// ---------------------------------------------------------------------------
// createSpawner — factory that returns the AgentSpawner function
// ---------------------------------------------------------------------------

export interface SpawnerDeps {
  provider: LlmProvider;
  /** Current parent config — use a getter so callers can provide a live reference. */
  parentConfig: QueryConfig | (() => QueryConfig);
  parentTools: Tool[];
  registry: AgentRegistry;
  /** Parent cost tracker — sub-agent costs are rolled up into this after completion. */
  parentCostTracker?: CostTracker;
}

/**
 * Create an AgentSpawner function that can be registered via `setSpawner()`.
 *
 * The spawner supports:
 * - Foreground (synchronous): parent tool awaits child completion
 * - Background: returns immediately with agent_id, child runs in background
 */
export function createSpawner(deps: SpawnerDeps) {
  const { provider, parentConfig: parentConfigOrGetter, parentTools, registry } = deps;

  /** Resolve the parent config — supports both static value and getter. */
  const getParentConfig = typeof parentConfigOrGetter === 'function'
    ? parentConfigOrGetter
    : () => parentConfigOrGetter;

  return async function spawnAgent(
    request: AgentSpawnRequest,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const agentId = `agent-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const agentAbortController = new AbortController();

    // Create a deferred promise for the registry entry
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    // Register the agent
    registry.register({
      id: agentId,
      description: request.description,
      status: 'running',
      abortController: agentAbortController,
      messages: [],
      startedAt: Date.now(),
      done: donePromise,
    });

    // Wire parent abort signal
    if (ctx.abortSignal) {
      ctx.abortSignal.addEventListener('abort', () => {
        agentAbortController.abort();
      }, { once: true });
    }

    // Sub-agent message forwarding: only for foreground agents (background returns immediately,
    // so the message buffer is already drained before the sub-agent runs).
    const onMessage = request.runInBackground ? undefined : ctx.onSubAgentMessage;
    const parentToolUseId = request.runInBackground ? undefined : ctx.toolUseId;

    const runAgent = async () => {
      try {
        // Resolve parent config at spawn time (not at createSpawner time)
        // so that mid-session model/thinking changes are picked up.
        const currentParentConfig = getParentConfig();
        const result = await runSubAgent(
          agentId,
          request,
          currentParentConfig,
          provider,
          parentTools,
          agentAbortController.signal,
          currentParentConfig.agents,
          parentToolUseId,
          onMessage,
          ctx.sessionId,
        );

        const entry = registry.get(agentId);
        if (entry) {
          entry.messages = result.messages;
        }
        registry.complete(agentId, result.text);

        // H3: Roll up sub-agent costs to parent budget.
        // Without this, parent's budget check doesn't include child spending,
        // allowing budget overruns when multiple sub-agents are spawned.
        if (ctx.costTracker && result.costUsd > 0) {
          // Extract usage from the sub-agent's result message
          const resultMsg = result.messages.find(
            (m) => m.type === 'result' && 'usage' in m,
          );
          if (resultMsg && 'usage' in resultMsg) {
            const usage = (resultMsg as unknown as { usage: Record<string, number> }).usage;
            const childTracker = new CostTracker(currentParentConfig.model);
            childTracker.add(
              {
                input_tokens: usage.input_tokens ?? 0,
                output_tokens: usage.output_tokens ?? 0,
                cache_creation_input_tokens:
                  usage.cache_creation_input_tokens ?? 0,
                cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
              },
              currentParentConfig.model,
            );
            ctx.costTracker.addChildCost(childTracker);
          }
        }

        return result;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        registry.fail(agentId, msg);
        throw err;
      } finally {
        resolveDone();
      }
    };

    // Background mode
    if (request.runInBackground) {
      // Fire and forget — don't await
      runAgent().catch(() => {
        // Error already recorded in registry
      });

      return toolSuccess(
        JSON.stringify({
          agent_id: agentId,
          status: 'running',
          description: request.description,
          message:
            `Agent '${request.description}' started in background (id: ${agentId}). ` +
            `Use TaskOutput tool with task_id '${agentId}' to check status.`,
        }),
      );
    }

    // Foreground mode — await completion
    try {
      const result = await runAgent();

      return toolSuccess(result.text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`Agent '${request.description}' failed: ${msg}`);
    }
  };
}
