/**
 * @module tools/bash
 * BashTool — Execute shell commands with timeout, background support,
 * and persistent shell state (cwd + env) across invocations.
 * @license MIT
 */

import { spawn } from 'node:child_process';
import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { BASH_TOOL_NAME, BASH_TOOL_DESCRIPTION, BASH_INPUT_SCHEMA } from './schema.js';
import { shellStateManager, extractExportsFromCommand } from './shell-state.js';
import { buildWrapperScript, splitOutputAtSentinel, parseShellStateBlock } from './wrapper.js';
import { truncateBashOutput } from './truncate.js';
import { runInBackground } from './background.js';

/** Default timeout: 2 minutes. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Maximum timeout: 10 minutes. */
const MAX_TIMEOUT_MS = 600_000;

export const BashTool: Tool = {
  name: BASH_TOOL_NAME,
  description: BASH_TOOL_DESCRIPTION,
  inputSchema: BASH_INPUT_SCHEMA,
  permissionLevel: 'execute',

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const command = input.command as string | undefined;
    if (!command || typeof command !== 'string') {
      return toolError('Missing required parameter: command');
    }

    const timeoutMs = Math.min(
      Math.max(0, Number(input.timeout) || DEFAULT_TIMEOUT_MS),
      MAX_TIMEOUT_MS,
    );
    const runBg = Boolean(input.run_in_background);

    // Get or create persistent shell state for this session.
    // Uses agentId for sub-agent isolation when available.
    const agentId = (ctx as unknown as Record<string, unknown>).agentId as string | undefined;
    const state = shellStateManager.get(ctx.sessionId, ctx.cwd, agentId);

    // --- Background path ---
    if (runBg) {
      const result = runInBackground(command, state.cwd, timeoutMs);
      return toolSuccess(result.message);
    }

    // --- Foreground path ---
    const script = buildWrapperScript(command, state);

    return new Promise<ToolResult>((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const child = spawn('bash', ['-c', script], {
        cwd: ctx.cwd, // wrapper script will cd to the tracked cwd
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...ctx.env },
      });

      child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      // Timeout handling: SIGTERM first, then SIGKILL after 5s
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* already dead */ }
        }, 5000);
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);

        if (killed) {
          resolve(toolError(`Command timed out after ${timeoutMs}ms`));
          return;
        }

        const exitCode = code ?? -1;
        const stdoutStr = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderrStr = Buffer.concat(stderrChunks).toString('utf-8');

        const stdoutLines = stdoutStr.split('\n');
        // Remove trailing empty line from split
        if (stdoutLines.length > 0 && stdoutLines[stdoutLines.length - 1] === '') {
          stdoutLines.pop();
        }

        // Split into user output and state block
        const [userLines, stateLines] = splitOutputAtSentinel(stdoutLines);

        // Update persistent shell state from the state block
        if (stateLines.length > 0) {
          const parsed = parseShellStateBlock(stateLines);
          if (parsed) {
            state.cwd = parsed.cwd;
            // Merge (not replace) so vars set in earlier calls survive
            for (const [k, v] of parsed.envVars) {
              state.envVars.set(k, v);
            }
            shellStateManager.update(ctx.sessionId, state, agentId);
          }
        }

        // Also capture explicit exports from the command text (fast path)
        const exports = extractExportsFromCommand(command);
        if (exports.size > 0) {
          for (const [k, v] of exports) {
            state.envVars.set(k, v);
          }
          shellStateManager.update(ctx.sessionId, state, agentId);
        }

        // Build output string
        let output = '';
        if (userLines.length > 0) {
          output = userLines.join('\n');
        }
        if (stderrStr.trim()) {
          if (output) output += '\n';
          output += 'STDERR:\n' + stderrStr.trim();
        }
        if (!output) {
          output = '(no output)';
        }

        // Truncate if too long
        output = truncateBashOutput(output);

        if (exitCode !== 0) {
          resolve(toolError(`Command exited with code ${exitCode}\n${output}`));
        } else {
          resolve(toolSuccess(output));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(toolError(`Failed to spawn command: ${err.message}`));
      });

      // Handle abort signal
      if (ctx.abortSignal) {
        const onAbort = () => {
          child.kill('SIGTERM');
          setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* already dead */ }
          }, 2000);
        };
        if (ctx.abortSignal.aborted) {
          onAbort();
        } else {
          ctx.abortSignal.addEventListener('abort', onAbort, { once: true });
        }
      }
    });
  },
};
