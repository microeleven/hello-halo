/**
 * @module tools/bash/shell-state
 * Persistent shell state management across Bash tool invocations.
 * Tracks cwd and env variables so `cd` and `export` persist across tool calls.
 * @license MIT
 */

import type { ShellState } from '../../types/tool.js';

/**
 * Manages shell state per session and agent.
 * Each session+agent combination has its own ShellState that persists cwd
 * and env vars across multiple Bash tool invocations.
 *
 * Sub-agents get isolated shell state by using a composite key of
 * sessionId + agentId. This prevents cwd/env leaks between parent
 * and child agents sharing the same sessionId.
 */
export class ShellStateManager {
  private states = new Map<string, ShellState>();

  /**
   * Build a composite key for state isolation.
   * When agentId is provided (sub-agent context), the key is
   * `sessionId:agentId` to prevent cross-agent state leaks.
   */
  private key(sessionId: string, agentId?: string): string {
    return agentId ? `${sessionId}:${agentId}` : sessionId;
  }

  /** Get or create the ShellState for a session (optionally scoped to an agent). */
  get(sessionId: string, defaultCwd: string, agentId?: string): ShellState {
    const k = this.key(sessionId, agentId);
    let state = this.states.get(k);
    if (!state) {
      state = {
        cwd: defaultCwd,
        envVars: new Map(),
      };
      this.states.set(k, state);
    }
    return state;
  }

  /** Update the ShellState for a session (optionally scoped to an agent). */
  update(sessionId: string, state: ShellState, agentId?: string): void {
    this.states.set(this.key(sessionId, agentId), state);
  }

  /** Remove state for a session (optionally scoped to an agent). */
  remove(sessionId: string, agentId?: string): void {
    this.states.delete(this.key(sessionId, agentId));
  }

  /** Remove all states for a session (including all agent-scoped states). */
  removeAll(sessionId: string): void {
    const prefix = sessionId + ':';
    for (const key of this.states.keys()) {
      if (key === sessionId || key.startsWith(prefix)) {
        this.states.delete(key);
      }
    }
  }
}

/** Global shell state manager singleton. */
export const shellStateManager = new ShellStateManager();

/**
 * Extract `export VAR=value` patterns from a command string.
 * Only handles simple single-line exports; complex shell constructs are
 * handled by the full env-dump approach.
 */
export function extractExportsFromCommand(command: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|(\S*))/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    const key = match[1];
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    map.set(key, val);
  }
  return map;
}
