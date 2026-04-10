/**
 * Unit tests for resolveQueryConfig and createAgentContext.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveQueryConfig, createAgentContext } from './context.js';
import type { Options } from '../types/config.js';
import type { LlmProvider } from '../types/provider.js';

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

const stubProvider: LlmProvider = {
  id: 'stub',
  capabilities: () => ({
    streaming: false, tools: false, vision: false, thinking: false,
    betas: [], adaptiveThinking: false, supportedEffortLevels: [],
    supportsEffort: false,
  }),
  createMessage: vi.fn(),
  createMessageStream: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
};

// ---------------------------------------------------------------------------
// resolveQueryConfig — defaults
// ---------------------------------------------------------------------------

describe('resolveQueryConfig — defaults', () => {
  it('applies default model when not provided', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.model).toBe('claude-sonnet-4-6');
  });

  it('applies provided model', () => {
    const cfg = resolveQueryConfig({ model: 'claude-opus-4' } as Options);
    expect(cfg.model).toBe('claude-opus-4');
  });

  it('sets maxTokens to 16384', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.maxTokens).toBe(16384);
  });

  it('applies default maxTurns of 100', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.maxTurns).toBe(100);
  });

  it('applies provided maxTurns', () => {
    const cfg = resolveQueryConfig({ maxTurns: 5 } as Options);
    expect(cfg.maxTurns).toBe(5);
  });

  it('applies default maxBudgetUsd of Infinity', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.maxBudgetUsd).toBe(Infinity);
  });

  it('applies provided maxBudgetUsd', () => {
    const cfg = resolveQueryConfig({ maxBudgetUsd: 1.5 } as Options);
    expect(cfg.maxBudgetUsd).toBe(1.5);
  });

  it('defaults cwd to process.cwd()', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.cwd).toBe(process.cwd());
  });

  it('applies provided cwd', () => {
    const cfg = resolveQueryConfig({ cwd: '/tmp/test' } as Options);
    expect(cfg.cwd).toBe('/tmp/test');
  });

  it('defaults env to {}', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.env).toEqual({});
  });

  it('applies provided env', () => {
    const cfg = resolveQueryConfig({ env: { FOO: 'bar' } } as Options);
    expect(cfg.env).toEqual({ FOO: 'bar' });
  });

  it('defaults systemPrompt to cc preset', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
  });

  it('applies custom systemPrompt', () => {
    const cfg = resolveQueryConfig({
      systemPrompt: { type: 'custom', value: 'Be helpful' },
    } as Options);
    expect(cfg.systemPrompt).toEqual({ type: 'custom', value: 'Be helpful' });
  });

  it('defaults effort to high', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.effort).toBe('high');
  });

  it('applies provided effort level', () => {
    const cfg = resolveQueryConfig({ effort: 'max' } as Options);
    expect(cfg.effort).toBe('max');
  });

  it('defaults toolResultBudget to 50000', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.toolResultBudget).toBe(50_000);
  });

  it('defaults includePartialMessages to false', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.includePartialMessages).toBe(false);
  });

  it('defaults permissionMode to default', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.permissionMode).toBe('default');
  });

  it('applies provided permissionMode', () => {
    const cfg = resolveQueryConfig({ permissionMode: 'bypassPermissions' } as Options);
    expect(cfg.permissionMode).toBe('bypassPermissions');
  });

  it('creates abortSignal when no abortController is provided', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.abortSignal).toBeInstanceOf(AbortSignal);
    expect(cfg.abortSignal.aborted).toBe(false);
  });

  it('uses provided abortController signal', () => {
    const ac = new AbortController();
    ac.abort();
    const cfg = resolveQueryConfig({ abortController: ac } as Options);
    expect(cfg.abortSignal.aborted).toBe(true);
  });

  it('passes through optional fields as undefined when not provided', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.allowedTools).toBeUndefined();
    expect(cfg.disallowedTools).toBeUndefined();
    expect(cfg.agents).toBeUndefined();
    expect(cfg.mcpServers).toBeUndefined();
    expect(cfg.hooks).toBeUndefined();
    expect(cfg.canUseTool).toBeUndefined();
    expect(cfg.fallbackModel).toBeUndefined();
    expect(cfg.betas).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveQueryConfig — thinking resolution
// ---------------------------------------------------------------------------

describe('resolveQueryConfig — thinking', () => {
  it('defaults to disabled thinking', () => {
    const cfg = resolveQueryConfig({} as Options);
    expect(cfg.thinking).toEqual({ type: 'disabled' });
  });

  it('uses explicit thinking config when provided', () => {
    const cfg = resolveQueryConfig({
      thinking: { type: 'enabled', budgetTokens: 5000 },
    } as Options);
    expect(cfg.thinking).toEqual({ type: 'enabled', budgetTokens: 5000 });
  });

  it('explicit thinking config takes precedence over maxThinkingTokens', () => {
    const cfg = resolveQueryConfig({
      thinking: { type: 'enabled', budgetTokens: 3000 },
      maxThinkingTokens: 9000,
    } as Options);
    expect(cfg.thinking).toEqual({ type: 'enabled', budgetTokens: 3000 });
  });

  it('maxThinkingTokens > 0 on adaptive model → adaptive thinking', () => {
    const cfg = resolveQueryConfig({
      model: 'claude-sonnet-4-6',
      maxThinkingTokens: 8000,
    } as Options);
    expect(cfg.thinking).toEqual({ type: 'adaptive' });
  });

  it('maxThinkingTokens > 0 on adaptive model (opus) → adaptive thinking', () => {
    const cfg = resolveQueryConfig({
      model: 'claude-opus-4',
      maxThinkingTokens: 10000,
    } as Options);
    expect(cfg.thinking).toEqual({ type: 'adaptive' });
  });

  it('maxThinkingTokens > 0 on non-adaptive model → enabled with budget', () => {
    const cfg = resolveQueryConfig({
      model: 'claude-3-5-sonnet-20241022',
      maxThinkingTokens: 4000,
    } as Options);
    expect(cfg.thinking).toEqual({ type: 'enabled', budgetTokens: 4000 });
  });

  it('maxThinkingTokens = 0 → disabled thinking', () => {
    const cfg = resolveQueryConfig({
      model: 'claude-sonnet-4-6',
      maxThinkingTokens: 0,
    } as Options);
    expect(cfg.thinking).toEqual({ type: 'disabled' });
  });
});

// ---------------------------------------------------------------------------
// createAgentContext
// ---------------------------------------------------------------------------

describe('createAgentContext', () => {
  it('generates a sessionId when not provided', () => {
    const ctx = createAgentContext({} as Options, stubProvider, []);
    expect(typeof ctx.sessionId).toBe('string');
    expect(ctx.sessionId.length).toBeGreaterThan(0);
  });

  it('uses provided sessionId', () => {
    const ctx = createAgentContext({ sessionId: 'my-session' } as Options, stubProvider, []);
    expect(ctx.sessionId).toBe('my-session');
  });

  it('sets the correct provider reference', () => {
    const ctx = createAgentContext({} as Options, stubProvider, []);
    expect(ctx.provider).toBe(stubProvider);
  });

  it('sets the supplied tools array', () => {
    const tools: never[] = [];
    const ctx = createAgentContext({} as Options, stubProvider, tools);
    expect(ctx.tools).toBe(tools);
  });

  it('isSubAgent defaults to false', () => {
    const ctx = createAgentContext({} as Options, stubProvider, []);
    expect(ctx.isSubAgent).toBe(false);
  });

  it('isSubAgent is propagated', () => {
    const ctx = createAgentContext({} as Options, stubProvider, [], true);
    expect(ctx.isSubAgent).toBe(true);
  });

  it('parentAgentId is undefined when not provided', () => {
    const ctx = createAgentContext({} as Options, stubProvider, [], false);
    expect(ctx.parentAgentId).toBeUndefined();
  });

  it('parentAgentId is propagated', () => {
    const ctx = createAgentContext({} as Options, stubProvider, [], true, 'parent-42');
    expect(ctx.parentAgentId).toBe('parent-42');
  });

  it('starts with empty messages array', () => {
    const ctx = createAgentContext({} as Options, stubProvider, []);
    expect(ctx.messages).toEqual([]);
  });

  it('starts with currentTurn = 0', () => {
    const ctx = createAgentContext({} as Options, stubProvider, []);
    expect(ctx.currentTurn).toBe(0);
  });

  it('shellState.cwd matches resolved cwd', () => {
    const ctx = createAgentContext({ cwd: '/tmp/mydir' } as Options, stubProvider, []);
    expect(ctx.shellState.cwd).toBe('/tmp/mydir');
  });

  it('toolContext.sessionId matches ctx.sessionId', () => {
    const ctx = createAgentContext({ sessionId: 'abc-123' } as Options, stubProvider, []);
    expect(ctx.toolContext.sessionId).toBe('abc-123');
  });

  it('toolContext.cwd matches resolved cwd', () => {
    const ctx = createAgentContext({ cwd: '/tmp/check' } as Options, stubProvider, []);
    expect(ctx.toolContext.cwd).toBe('/tmp/check');
  });

  it('toolContext starts with currentTurn = 0', () => {
    const ctx = createAgentContext({} as Options, stubProvider, []);
    expect(ctx.toolContext.currentTurn).toBe(0);
  });

  it('costTracker is a CostTracker instance', () => {
    const ctx = createAgentContext({} as Options, stubProvider, []);
    expect(ctx.costTracker).toBeDefined();
    expect(typeof ctx.costTracker.totalCostUsd).toBe('number');
  });

  it('config is fully resolved', () => {
    const ctx = createAgentContext({ model: 'claude-opus-4', maxTurns: 50 } as Options, stubProvider, []);
    expect(ctx.config.model).toBe('claude-opus-4');
    expect(ctx.config.maxTurns).toBe(50);
  });

  it('two contexts get different sessionIds', () => {
    const ctx1 = createAgentContext({} as Options, stubProvider, []);
    const ctx2 = createAgentContext({} as Options, stubProvider, []);
    expect(ctx1.sessionId).not.toBe(ctx2.sessionId);
  });
});
