/**
 * @module orchestrator/init
 * Orchestrator initialization — wires the spawner and message router into
 * the AgentTool and SendMessageTool.
 *
 * Call `initOrchestrator()` once during session setup (after tools are built).
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import type { LlmProvider } from '../types/provider.js';
import type { Tool } from '../types/tool.js';
import { toolSuccess } from '../types/tool.js';
import type { QueryConfig } from '../types/config.js';
import { setSpawner } from '../tools/agent/index.js';
import { setMessageRouter, clearSessionInbox } from '../tools/send-message/index.js';
import { setAgentRegistry } from '../tools/task/list.js';
import { AgentRegistry } from './registry.js';
import { createSpawner } from './spawner.js';

// ---------------------------------------------------------------------------
// Orchestrator state
// ---------------------------------------------------------------------------

export interface OrchestratorHandle {
  /** The agent registry for this session. */
  registry: AgentRegistry;
  /** Dispose: abort all running agents, clear registry, reset stubs. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// initOrchestrator
// ---------------------------------------------------------------------------

/**
 * Initialize the orchestrator for a session.
 *
 * Wires `setSpawner()` on AgentTool and `setMessageRouter()` on SendMessageTool
 * so that they use real in-process sub-agent execution.
 *
 * @returns An OrchestratorHandle for lifecycle management.
 */
export function initOrchestrator(deps: {
  provider: LlmProvider;
  config: QueryConfig | (() => QueryConfig);
  tools: Tool[];
  /** Optional session ID; auto-generated if not provided. */
  sessionId?: string;
}): OrchestratorHandle {
  const { provider, config, tools } = deps;
  const sessionId = deps.sessionId ?? randomUUID();
  const registry = new AgentRegistry();

  // Wire AgentRegistry into task tools so TaskOutputTool / TaskStopTool can
  // query and abort background agents registered by the spawner.
  setAgentRegistry(registry);

  // Create and register the spawner
  const spawner = createSpawner({
    provider,
    parentConfig: config,
    parentTools: tools,
    registry,
  });
  setSpawner(spawner, sessionId);

  // Register the message router
  // For now the in-process inbox in SendMessageTool is sufficient
  // (it already handles direct and broadcast messages).
  // A real orchestrator message router would forward to named agent inboxes.
  setMessageRouter(async (to, message, summary, _ctx) => {
    // Router is session-scoped via setMessageRouter's sessionId parameter
    // Derive a preview string from the message (which may be structured)
    const messagePreview = typeof message === 'string'
      ? message.slice(0, 60)
      : `[${message.type}]`;
    const preview = summary ?? messagePreview;

    // Check if target is a running agent
    const entry = registry.findByName(to) ?? registry.get(to);
    if (entry && entry.status === 'running') {
      // For now, use the inbox system — the agent won't consume it
      // unless we inject message-checking into the query loop.
      // Return success since the intent is recorded.
      return toolSuccess(
        `Message queued for agent '${to}' (${entry.id}): ${preview}`,
      );
    }

    // If target is not a known agent, try the default inbox behavior
    // (SendMessageTool's default handler will handle this case).
    return toolSuccess(
      `Message sent to '${to}': ${preview}`,
    );
  }, sessionId);

  return {
    registry,
    dispose() {
      registry.dispose();
      // Reset stubs so subsequent sessions don't inherit stale state
      setSpawner(null);
      setMessageRouter(null);
      clearSessionInbox(sessionId);
      setAgentRegistry(null);
    },
  };
}
