/**
 * Unit tests for the hook execution engine.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runHooks,
  runPreToolUseHooks,
  runPostToolUseHooks,
  runPostToolUseFailureHooks,
  runEventHooks,
} from './hooks.js';
import type { HookCallbackMatcher, HookEvent } from '../types/config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = new AbortController().signal;

function makeHook(result?: Record<string, unknown>) {
  return vi.fn().mockResolvedValue(result ?? {});
}

function makeMatcher(
  hooks: HookCallbackMatcher['hooks'],
  matcher?: string,
): HookCallbackMatcher {
  return { hooks, matcher };
}

/** Build the hooks config object used by runPreToolUseHooks / runPostToolUseHooks etc. */
function makeHooksConfig(
  event: HookEvent,
  matchers: HookCallbackMatcher[],
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return { [event]: matchers };
}

const TEST_SESSION_ID = 'session-test-123';
const TEST_CWD = '/test/cwd';

// ---------------------------------------------------------------------------
// runHooks — base hook executor
// ---------------------------------------------------------------------------

describe('runHooks', () => {
  it('returns empty array when no matchers provided', async () => {
    const result = await runHooks('PreToolUse', undefined, {}, undefined, noop);
    expect(result).toEqual([]);
  });

  it('calls matching hooks and returns their results', async () => {
    const hook = makeHook({ x: 1 });
    const matchers = [makeMatcher([hook])];
    const results = await runHooks('PreToolUse', matchers, {}, 'tu1', noop, 'Bash');
    expect(hook).toHaveBeenCalledOnce();
    expect(results).toEqual([{ x: 1 }]);
  });

  it('skips hooks when tool name does not match exact matcher', async () => {
    const hook = makeHook({ x: 1 });
    const matchers = [makeMatcher([hook], 'Write')];
    await runHooks('PreToolUse', matchers, {}, 'tu1', noop, 'Bash');
    expect(hook).not.toHaveBeenCalled();
  });

  it('matches all tools when matcher is undefined', async () => {
    const hook = makeHook({});
    const matchers = [makeMatcher([hook])];
    await runHooks('PreToolUse', matchers, {}, undefined, noop, 'AnyTool');
    expect(hook).toHaveBeenCalledOnce();
  });

  it('supports glob-style wildcard matcher (e.g., "mcp__*")', async () => {
    const hook = makeHook({});
    const matchers = [makeMatcher([hook], 'mcp__*')];
    await runHooks('PreToolUse', matchers, {}, undefined, noop, 'mcp__memory__get');
    expect(hook).toHaveBeenCalledOnce();
  });

  it('does not match non-matching wildcard', async () => {
    const hook = makeHook({});
    const matchers = [makeMatcher([hook], 'mcp__*')];
    await runHooks('PreToolUse', matchers, {}, undefined, noop, 'Bash');
    expect(hook).not.toHaveBeenCalled();
  });

  it('logs and continues when a hook throws', async () => {
    const failHook = vi.fn().mockRejectedValue(new Error('hook failed'));
    const okHook = makeHook({ ok: true });
    const matchers = [makeMatcher([failHook, okHook])];
    const results = await runHooks('PostToolUse', matchers, {}, undefined, noop, 'Bash');
    const hasError = results.some(r => r.hookError);
    const hasOk = results.some(r => r.ok);
    expect(hasError).toBe(true);
    expect(hasOk).toBe(true);
  });

  it('stops running hooks when signal is aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const hook = makeHook({ x: 1 });
    const matchers = [makeMatcher([hook])];
    await runHooks('PreToolUse', matchers, {}, undefined, ac.signal, 'Bash');
    expect(hook).not.toHaveBeenCalled();
  });

  it('executes hooks sequentially, not in parallel', async () => {
    const order: number[] = [];
    const h1 = vi.fn(async () => { order.push(1); return {}; });
    const h2 = vi.fn(async () => { order.push(2); return {}; });
    const matchers = [makeMatcher([h1, h2])];
    await runHooks('PostToolUse', matchers, {}, undefined, noop, 'Bash');
    expect(order).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// runPreToolUseHooks
// Signature: (hooks, toolName, toolInput, toolUseId, sessionId, cwd, signal)
// Hook output uses permissionDecision ('allow'|'deny'), not decision
// ---------------------------------------------------------------------------

describe('runPreToolUseHooks', () => {
  it('merges allow decision from hook', async () => {
    const hook = vi.fn().mockResolvedValue({
      permissionDecision: 'allow',
      permissionDecisionReason: 'approved',
    });
    const hooks = makeHooksConfig('PreToolUse', [makeMatcher([hook])]);
    const result = await runPreToolUseHooks(hooks, 'Bash', {}, 'tu1', TEST_SESSION_ID, TEST_CWD, noop);
    expect(result.decision).toBe('allow');
    expect(result.decisionReason).toBe('approved');
  });

  it('merges deny decision from hook', async () => {
    const hook = vi.fn().mockResolvedValue({ permissionDecision: 'deny' });
    const hooks = makeHooksConfig('PreToolUse', [makeMatcher([hook])]);
    const result = await runPreToolUseHooks(hooks, 'Bash', {}, 'tu1', TEST_SESSION_ID, TEST_CWD, noop);
    expect(result.decision).toBe('deny');
  });

  it('passes additionalContext from hook', async () => {
    const hook = vi.fn().mockResolvedValue({ additionalContext: 'extra info' });
    const hooks = makeHooksConfig('PreToolUse', [makeMatcher([hook])]);
    const result = await runPreToolUseHooks(hooks, 'Bash', {}, 'tu1', TEST_SESSION_ID, TEST_CWD, noop);
    expect(result.additionalContext).toBe('extra info');
  });

  it('returns no decision when hooks have no opinion', async () => {
    const hook = makeHook({});
    const hooks = makeHooksConfig('PreToolUse', [makeMatcher([hook])]);
    const result = await runPreToolUseHooks(hooks, 'Bash', {}, 'tu1', TEST_SESSION_ID, TEST_CWD, noop);
    expect(result.decision).toBeUndefined();
  });

  it('passes updatedInput from hook through to result', async () => {
    const hook = vi.fn().mockResolvedValue({ updatedInput: { newParam: 'modified' } });
    const hooks = makeHooksConfig('PreToolUse', [makeMatcher([hook])]);
    const result = await runPreToolUseHooks(hooks, 'Bash', {}, 'tu1', TEST_SESSION_ID, TEST_CWD, noop);
    expect(result.updatedInput).toEqual({ newParam: 'modified' });
  });

  it('returns empty result when no PreToolUse hooks registered', async () => {
    const result = await runPreToolUseHooks(undefined, 'Bash', {}, 'tu1', TEST_SESSION_ID, TEST_CWD, noop);
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// runPostToolUseHooks
// Signature: (hooks, toolName, toolInput, toolResponse, toolUseId, sessionId, cwd, signal)
// ---------------------------------------------------------------------------

describe('runPostToolUseHooks', () => {
  it('returns empty result when no hooks', async () => {
    const result = await runPostToolUseHooks(undefined, 'Bash', {}, {}, 'tu1', TEST_SESSION_ID, TEST_CWD, noop);
    expect(result.additionalContext).toBeUndefined();
    expect(result.updatedToolOutput).toBeUndefined();
  });

  it('merges additionalContext from hook', async () => {
    const hook = vi.fn().mockResolvedValue({ additionalContext: 'extra' });
    const hooks = makeHooksConfig('PostToolUse', [makeMatcher([hook])]);
    const result = await runPostToolUseHooks(hooks, 'Bash', {}, {}, 'tu1', TEST_SESSION_ID, TEST_CWD, noop);
    expect(result.additionalContext).toBe('extra');
  });

  it('passes updatedMCPToolOutput as updatedToolOutput', async () => {
    const hook = vi.fn().mockResolvedValue({ updatedMCPToolOutput: { modified: true } });
    const hooks = makeHooksConfig('PostToolUse', [makeMatcher([hook])]);
    const result = await runPostToolUseHooks(hooks, 'Bash', {}, {}, 'tu1', TEST_SESSION_ID, TEST_CWD, noop);
    expect(result.updatedToolOutput).toEqual({ modified: true });
  });
});

// ---------------------------------------------------------------------------
// runPostToolUseFailureHooks
// Signature: (hooks, toolName, toolInput, error: string, toolUseId, sessionId, cwd, signal)
// ---------------------------------------------------------------------------

describe('runPostToolUseFailureHooks', () => {
  it('calls hooks and returns undefined on success', async () => {
    const hook = makeHook({});
    const hooks = makeHooksConfig('PostToolUseFailure', [makeMatcher([hook])]);
    await expect(runPostToolUseFailureHooks(hooks, 'Bash', {}, 'error message', 'tu1', TEST_SESSION_ID, TEST_CWD, noop)).resolves.toBeUndefined();
    expect(hook).toHaveBeenCalledOnce();
  });

  it('returns undefined when no hooks registered', async () => {
    await expect(runPostToolUseFailureHooks(undefined, 'Bash', {}, 'err', 'tu1', TEST_SESSION_ID, TEST_CWD, noop)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runEventHooks
// Signature: (hooks, event, input, signal)
// ---------------------------------------------------------------------------

describe('runEventHooks', () => {
  it('calls event hook and returns array of results', async () => {
    const hook = makeHook({ fired: true });
    const hooks = makeHooksConfig('SessionStart', [makeMatcher([hook])]);
    const results = await runEventHooks(hooks, 'SessionStart', {}, noop);
    expect(hook).toHaveBeenCalledOnce();
    expect(results).toEqual([{ fired: true }]);
  });

  it('returns empty array when no hooks registered', async () => {
    const results = await runEventHooks(undefined, 'SessionEnd', {}, noop);
    expect(results).toEqual([]);
  });

  it('returns empty array when event not in hooks map', async () => {
    const hooks = makeHooksConfig('SessionStart', [makeMatcher([makeHook()])]);
    const results = await runEventHooks(hooks, 'SessionEnd', {}, noop);
    expect(results).toEqual([]);
  });
});
