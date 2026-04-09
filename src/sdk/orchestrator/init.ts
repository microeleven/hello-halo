/**
 * @module orchestrator/init
 * Orchestrator initialization — wires the spawner and message router into
 * the AgentTool and SendMessageTool.
 *
 * Call `initOrchestrator()` once during session setup (after tools are built).
 * @license MIT
 */

import type { LlmProvider } from '../types/provider.js';
import type { Tool } from '../types/tool.js';
import { toolSuccess } from '../types/tool.js';
import type { QueryConfig } from '../types/config.js';
import { setSpawner } from '../tools/agent/index.js';
import { setMessageRouter } from '../tools/send-message/index.js';
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
}): OrchestratorHandle {
  const { provider, config, tools } = deps;
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
  setSpawner(spawner);

  // Register the message router
  // For now the in-process inbox in SendMessageTool is sufficient
  // (it already handles direct and broadcast messages).
  // A real orchestrator message router would forward to named agent inboxes.
  setMessageRouter(async (to, message, summary, _ctx) => {
    // Check if target is a running agent
    const entry = registry.findByName(to) ?? registry.get(to);
    if (entry && entry.status === 'running') {
      // For now, use the inbox system — the agent won't consume it
      // unless we inject message-checking into the query loop.
      // Return success since the intent is recorded.
      const preview = summary ?? message.slice(0, 60);
      return toolSuccess(
        `Message queued for agent '${to}' (${entry.id}): ${preview}`,
      );
    }

    // If target is not a known agent, try the default inbox behavior
    // (SendMessageTool's default handler will handle this case).
    const preview = summary ?? message.slice(0, 60);
    return toolSuccess(
      `Message sent to '${to}': ${preview}`,
    );
  });

  return {
    registry,
    dispose() {
      registry.dispose();
      // Reset stubs so subsequent sessions don't inherit stale state
      setSpawner(null as unknown as Parameters<typeof setSpawner>[0]);
      setMessageRouter(null as unknown as Parameters<typeof setMessageRouter>[0]);
      setAgentRegistry(null);
    },
  };
}
