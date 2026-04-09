/**
 * @module tools/task/list
 * TaskListTool, TaskGetTool, TaskStopTool, TaskOutputTool.
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import {
  TASK_LIST_TOOL_NAME,
  TASK_LIST_DESCRIPTION,
  TASK_LIST_INPUT_SCHEMA,
  TASK_GET_TOOL_NAME,
  TASK_GET_DESCRIPTION,
  TASK_GET_INPUT_SCHEMA,
  TASK_STOP_TOOL_NAME,
  TASK_STOP_DESCRIPTION,
  TASK_STOP_INPUT_SCHEMA,
  TASK_OUTPUT_TOOL_NAME,
  TASK_OUTPUT_DESCRIPTION,
  TASK_OUTPUT_INPUT_SCHEMA,
} from './schema.js';
import { taskStore, taskToSummary, taskToFull } from './store.js';
import type { AgentRegistry } from '../../orchestrator/registry.js';

// ---------------------------------------------------------------------------
// AgentRegistry bridge
// ---------------------------------------------------------------------------

/**
 * Per-session AgentRegistry injected by the orchestrator.
 * Allows TaskOutputTool and TaskStopTool to query and abort background agents
 * that are registered in AgentRegistry (not in taskStore).
 */
let _agentRegistry: AgentRegistry | null = null;

/**
 * Register (or clear) the AgentRegistry for this session.
 * Called by initOrchestrator() during session setup.
 * Pass null during dispose to avoid cross-session state leaks.
 */
export function setAgentRegistry(registry: AgentRegistry | null): void {
  _agentRegistry = registry;
}

/** Get the current AgentRegistry (may be null if session not initialized). */
export function getAgentRegistry(): AgentRegistry | null {
  return _agentRegistry;
}

// ---------------------------------------------------------------------------
// TaskListTool
// ---------------------------------------------------------------------------

export const TaskListTool: Tool = {
  name: TASK_LIST_TOOL_NAME,
  description: TASK_LIST_DESCRIPTION,
  inputSchema: TASK_LIST_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const includeCompleted = input.include_completed === true;

    const tasks = Array.from(taskStore.values())
      .filter((task) => {
        if (task.status === 'deleted') return false;
        if (task.status === 'completed') return includeCompleted;
        return true;
      })
      .map(taskToSummary);

    // Also include background agents from the registry
    const agentEntries = _agentRegistry
      ? _agentRegistry.list().filter((a) => {
          if (a.status === 'completed') return includeCompleted;
          return true;
        })
      : [];
    const agentSummaries = agentEntries.map((a) => ({
      id: a.id,
      subject: a.description,
      status: a.status,
      owner: null,
      blocked_by: [],
      type: 'agent',
    }));

    return toolSuccess(JSON.stringify([...tasks, ...agentSummaries], null, 2));
  },
};

// ---------------------------------------------------------------------------
// TaskGetTool
// ---------------------------------------------------------------------------

export const TaskGetTool: Tool = {
  name: TASK_GET_TOOL_NAME,
  description: TASK_GET_DESCRIPTION,
  inputSchema: TASK_GET_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const taskId = (input.task_id ?? input.taskId) as string | undefined;
    if (!taskId) {
      return toolError('Missing required parameter: task_id');
    }

    // Check taskStore first
    const task = taskStore.get(taskId);
    if (task) {
      return toolSuccess(JSON.stringify(taskToFull(task), null, 2));
    }

    // Fallback: check the agent registry for background agents
    const agentEntry = _agentRegistry?.get(taskId);
    if (agentEntry) {
      return toolSuccess(
        JSON.stringify(
          {
            id: agentEntry.id,
            subject: agentEntry.description,
            description: agentEntry.description,
            status: agentEntry.status,
            type: 'agent',
            result: agentEntry.result ?? null,
            error: agentEntry.error ?? null,
            started_at: new Date(agentEntry.startedAt).toISOString(),
            ended_at: agentEntry.endedAt
              ? new Date(agentEntry.endedAt).toISOString()
              : null,
          },
          null,
          2,
        ),
      );
    }

    return toolSuccess(JSON.stringify(null, null, 2));
  },
};

// ---------------------------------------------------------------------------
// TaskStopTool
// ---------------------------------------------------------------------------

export const TaskStopTool: Tool = {
  name: TASK_STOP_TOOL_NAME,
  description: TASK_STOP_DESCRIPTION,
  inputSchema: TASK_STOP_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'execute',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const taskId = (input.task_id ?? input.shell_id) as string | undefined;
    if (!taskId) {
      return toolError('Missing required parameter: task_id');
    }

    // Check the agent registry first (background agents)
    if (_agentRegistry) {
      const agentEntry = _agentRegistry.get(taskId);
      if (agentEntry) {
        if (agentEntry.status !== 'running') {
          return toolError(
            `Agent '${taskId}' is not running (status: ${agentEntry.status})`,
          );
        }
        const stopped = _agentRegistry.stop(taskId);
        if (stopped) {
          return toolSuccess(
            JSON.stringify(
              { message: 'Agent stopped', task_id: taskId },
              null,
              2,
            ),
          );
        }
        return toolError(`Failed to stop agent '${taskId}'`);
      }
    }

    // Fallback: check taskStore
    const task = taskStore.get(taskId);
    if (!task) {
      return toolError(`Task '${taskId}' not found`);
    }

    if (task.status !== 'running' && task.status !== 'in_progress') {
      return toolError(
        `Task '${taskId}' is not running (status: ${task.status})`,
      );
    }

    task.status = 'completed';
    task.updatedAt = new Date().toISOString();

    return toolSuccess(
      JSON.stringify({ message: 'Task stopped', task_id: taskId }, null, 2),
    );
  },
};

// ---------------------------------------------------------------------------
// TaskOutputTool
// ---------------------------------------------------------------------------

export const TaskOutputTool: Tool = {
  name: TASK_OUTPUT_TOOL_NAME,
  description: TASK_OUTPUT_DESCRIPTION,
  inputSchema: TASK_OUTPUT_INPUT_SCHEMA as unknown as Record<string, unknown>,
  permissionLevel: 'none',

  async execute(
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const taskId = input.task_id as string | undefined;
    if (!taskId) {
      return toolError('Missing required parameter: task_id');
    }

    const block = input.block !== false; // default true
    const timeoutMs =
      typeof input.timeout === 'number' && input.timeout > 0
        ? input.timeout
        : 30_000;

    // Check the agent registry first (background agents spawned by AgentTool)
    if (_agentRegistry) {
      const agentEntry = _agentRegistry.get(taskId);
      if (agentEntry) {
        // If blocking mode and agent is still running, wait for completion (with timeout)
        if (block && agentEntry.status === 'running') {
          try {
            await Promise.race([
              agentEntry.done,
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), timeoutMs),
              ),
            ]);
          } catch {
            // Timed out or agent failed — continue to read current status below
          }
        }

        // Re-read entry after potential wait (status/result/error may have changed)
        const entry = _agentRegistry.get(taskId) ?? agentEntry;
        const retrievalStatus = entry.status === 'running' ? 'not_ready' : 'success';

        return toolSuccess(
          JSON.stringify(
            {
              retrieval_status: retrievalStatus,
              task: {
                task_id: entry.id,
                description: entry.description,
                status: entry.status,
                result: entry.result ?? null,
                error: entry.error ?? null,
                started_at: new Date(entry.startedAt).toISOString(),
                ended_at: entry.endedAt
                  ? new Date(entry.endedAt).toISOString()
                  : null,
              },
            },
            null,
            2,
          ),
        );
      }
    }

    // Fallback: check taskStore (for non-agent background tasks)
    const task = taskStore.get(taskId);
    if (!task) {
      return toolError(`Task '${taskId}' not found`);
    }

    let retrievalStatus: string;

    if (task.status === 'completed' || task.status === 'failed') {
      retrievalStatus = 'success';
    } else if (task.status === 'running' || task.status === 'in_progress') {
      retrievalStatus = block ? 'success' : 'not_ready';
    } else {
      retrievalStatus = 'success';
    }

    return toolSuccess(
      JSON.stringify(
        { retrieval_status: retrievalStatus, task: taskToFull(task) },
        null,
        2,
      ),
    );
  },
};
