/**
 * Unit tests for CostTracker and pricing utilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker, getPricingForModel } from './cost.js';

// ---------------------------------------------------------------------------
// getPricingForModel
// ---------------------------------------------------------------------------

describe('getPricingForModel', () => {
  it('matches claude-opus by substring', () => {
    const p = getPricingForModel('claude-opus-4-5');
    expect(p.inputPerMtk).toBe(15.0);
    expect(p.outputPerMtk).toBe(75.0);
  });

  it('matches claude-haiku by substring', () => {
    const p = getPricingForModel('claude-haiku-3-5');
    expect(p.inputPerMtk).toBe(0.8);
  });

  it('matches claude-sonnet by substring', () => {
    const p = getPricingForModel('claude-sonnet-4-6');
    expect(p.inputPerMtk).toBe(3.0);
    expect(p.outputPerMtk).toBe(15.0);
  });

  it('matches gpt-4o-mini before gpt-4o (order matters)', () => {
    const mini = getPricingForModel('gpt-4o-mini');
    expect(mini.inputPerMtk).toBe(0.15);
    const full = getPricingForModel('gpt-4o');
    expect(full.inputPerMtk).toBe(2.5);
  });

  it('matches deepseek model', () => {
    const p = getPricingForModel('deepseek/deepseek-chat');
    expect(p.inputPerMtk).toBe(0.27);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const p = getPricingForModel('unknown-model-xyz');
    expect(p.inputPerMtk).toBe(3.0);
    expect(p.outputPerMtk).toBe(15.0);
  });
});

// ---------------------------------------------------------------------------
// CostTracker — basic accumulation
// ---------------------------------------------------------------------------

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker('claude-sonnet-4-6');
  });

  it('starts at zero', () => {
    expect(tracker.totalCostUsd).toBe(0);
    expect(tracker.totalInputTokens).toBe(0);
    expect(tracker.totalOutputTokens).toBe(0);
  });

  it('accumulates tokens from a single add()', () => {
    tracker.add({ input_tokens: 1000, output_tokens: 500 });
    expect(tracker.totalInputTokens).toBe(1000);
    expect(tracker.totalOutputTokens).toBe(500);
    // cost = (1000 * 3 + 500 * 15) / 1_000_000 = (3000 + 7500) / 1e6 = 0.0105
    expect(tracker.totalCostUsd).toBeCloseTo(0.0105, 6);
  });

  it('accumulates tokens across multiple add() calls', () => {
    tracker.add({ input_tokens: 1000, output_tokens: 0 });
    tracker.add({ input_tokens: 2000, output_tokens: 0 });
    expect(tracker.totalInputTokens).toBe(3000);
  });

  it('calculates cost with cache tokens', () => {
    tracker.add({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 0,
    });
    // cache creation = 3.75 per MTk
    expect(tracker.totalCostUsd).toBeCloseTo(3.75, 4);
  });

  it('isOverBudget returns true when over limit', () => {
    tracker.add({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(tracker.isOverBudget(0.001)).toBe(true);
  });

  it('isOverBudget returns false when under limit', () => {
    tracker.add({ input_tokens: 100, output_tokens: 100 });
    expect(tracker.isOverBudget(1000)).toBe(false);
  });

  it('reset() clears all counters', () => {
    tracker.add({ input_tokens: 5000, output_tokens: 1000 });
    tracker.reset();
    expect(tracker.totalInputTokens).toBe(0);
    expect(tracker.totalOutputTokens).toBe(0);
    expect(tracker.totalCostUsd).toBe(0);
    expect(Object.keys(tracker.getModelUsage())).toHaveLength(0);
  });

  it('getModelUsage() tracks per-model entry', () => {
    tracker.add({ input_tokens: 1000, output_tokens: 0 }, 'claude-opus-4-5');
    const usage = tracker.getModelUsage();
    expect(usage['claude-opus-4-5']).toBeDefined();
    expect(usage['claude-opus-4-5'].input_tokens).toBe(1000);
  });

  it('does not reprice earlier calls when model changes', () => {
    // First call with sonnet pricing
    tracker.add({ input_tokens: 1_000_000, output_tokens: 0 });
    const costAfterSonnet = tracker.totalCostUsd; // should be 3.0

    // Second call with opus (more expensive) — should NOT retroactively reprice first call
    tracker.add({ input_tokens: 0, output_tokens: 0 }, 'claude-opus-4-5');
    expect(tracker.totalCostUsd).toBeCloseTo(costAfterSonnet, 4);
  });

  it('addChildCost() rolls up child totals', () => {
    const child = new CostTracker('claude-haiku-3-5');
    child.add({ input_tokens: 100_000, output_tokens: 50_000 });

    const parentCostBefore = tracker.totalCostUsd;
    tracker.addChildCost(child);

    expect(tracker.totalCostUsd).toBeGreaterThan(parentCostBefore);
    expect(tracker.totalInputTokens).toBe(100_000);
    expect(tracker.totalOutputTokens).toBe(50_000);
  });

  it('summary() includes token count', () => {
    tracker.add({ input_tokens: 1000, output_tokens: 500 });
    const s = tracker.summary();
    expect(s).toContain('1500');
  });

  it('getUsage() returns flat usage object', () => {
    tracker.add({
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 25,
    });
    const u = tracker.getUsage();
    expect(u.input_tokens).toBe(100);
    expect(u.output_tokens).toBe(200);
    expect(u.cache_creation_input_tokens).toBe(50);
    expect(u.cache_read_input_tokens).toBe(25);
  });
});
