/**
 * Unit tests for TokenBudget.
 */

import { describe, it, expect } from 'vitest';
import { TokenBudget } from './token-budget.js';
import type { Message } from '../types/provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Message array to produce a known token estimate. */
function makeMessages(totalChars: number): Message[] {
  // estimateMessageTokens uses a ~4 chars/token heuristic.
  // Build a single user message with enough text.
  return [
    {
      role: 'user',
      content: [{ type: 'text', text: 'a'.repeat(totalChars) }],
    },
  ];
}

// ---------------------------------------------------------------------------
// Constructor / contextWindow
// ---------------------------------------------------------------------------

describe('TokenBudget — constructor', () => {
  it('picks 200k window for claude-sonnet-4-6', () => {
    const b = new TokenBudget('claude-sonnet-4-6');
    expect(b.contextWindow).toBe(200_000);
  });

  it('picks 200k window for claude-opus-4', () => {
    const b = new TokenBudget('claude-opus-4');
    expect(b.contextWindow).toBe(200_000);
  });

  it('falls back to 100k window for unknown model', () => {
    const b = new TokenBudget('gpt-4o');
    expect(b.contextWindow).toBe(100_000);
  });

  it('uses supplied maxOutputTokens', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 8192);
    expect(b.maxOutputTokens).toBe(8192);
  });

  it('defaults maxOutputTokens to 16384', () => {
    const b = new TokenBudget('claude-sonnet-4-6');
    expect(b.maxOutputTokens).toBe(16384);
  });
});

// ---------------------------------------------------------------------------
// updateFromUsage / currentInputTokens
// ---------------------------------------------------------------------------

describe('TokenBudget — currentInputTokens', () => {
  it('falls back to heuristic estimate when no API usage is set', () => {
    const b = new TokenBudget('claude-sonnet-4-6');
    // 4000 chars ≈ 1000 tokens under 4-char heuristic
    const msgs = makeMessages(4000);
    const tokens = b.currentInputTokens(msgs);
    // Just ensure the estimate is reasonable (>0)
    expect(tokens).toBeGreaterThan(0);
  });

  it('prefers API usage count over heuristic estimate', () => {
    const b = new TokenBudget('claude-sonnet-4-6');
    b.updateFromUsage(50_000);
    // Even with a non-empty message list, API usage wins
    const msgs = makeMessages(100);
    expect(b.currentInputTokens(msgs)).toBe(50_000);
  });

  it('returns API usage after update even for empty message list', () => {
    const b = new TokenBudget('claude-sonnet-4-6');
    b.updateFromUsage(12_345);
    expect(b.currentInputTokens([])).toBe(12_345);
  });

  it('sequential updateFromUsage calls override each other', () => {
    const b = new TokenBudget('claude-sonnet-4-6');
    b.updateFromUsage(1_000);
    b.updateFromUsage(2_000);
    expect(b.currentInputTokens([])).toBe(2_000);
  });
});

// ---------------------------------------------------------------------------
// remainingInputTokens
// ---------------------------------------------------------------------------

describe('TokenBudget — remainingInputTokens', () => {
  it('computes remaining as (contextWindow - maxOutputTokens - usedTokens)', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384); // cw=200k
    b.updateFromUsage(10_000);
    // available = 200k - 16384 = 183616; used = 10k
    expect(b.remainingInputTokens([])).toBe(183_616 - 10_000);
  });

  it('returns 0 when usage exceeds available budget', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    b.updateFromUsage(300_000); // over the context window
    expect(b.remainingInputTokens([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// usageRatio
// ---------------------------------------------------------------------------

describe('TokenBudget — usageRatio', () => {
  it('returns 0 when no tokens used', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    // No API usage set; empty message list → heuristic returns 0
    expect(b.usageRatio([])).toBe(0);
  });

  it('returns fraction proportional to API usage', () => {
    // cw=200k, maxOut=16384 → available=183616
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    b.updateFromUsage(91_808); // exactly 50% of 183616
    const ratio = b.usageRatio([]);
    expect(ratio).toBeCloseTo(0.5, 2);
  });

  it('caps at 1.0 when over budget', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    b.updateFromUsage(500_000);
    expect(b.usageRatio([])).toBe(1.0);
  });

  it('returns 1.0 when available is 0 (maxOutputTokens >= contextWindow)', () => {
    const b = new TokenBudget('gpt-4o', 200_000); // cw=100k, maxOut=200k
    expect(b.usageRatio([])).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// shouldCompact
// ---------------------------------------------------------------------------

describe('TokenBudget — shouldCompact', () => {
  it('returns false below 90% usage', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    // 80% of available (183616) = 146892
    b.updateFromUsage(Math.floor(183_616 * 0.8));
    expect(b.shouldCompact([])).toBe(false);
  });

  it('returns true at exactly 90% usage', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    // Use ceil to ensure ratio lands at or above the 0.9 threshold
    b.updateFromUsage(Math.ceil(183_616 * 0.9));
    expect(b.shouldCompact([])).toBe(true);
  });

  it('returns true above 90% usage', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    b.updateFromUsage(Math.floor(183_616 * 0.95));
    expect(b.shouldCompact([])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldReduceToolResults
// ---------------------------------------------------------------------------

describe('TokenBudget — shouldReduceToolResults', () => {
  it('returns false below 70% usage', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    b.updateFromUsage(Math.floor(183_616 * 0.6));
    expect(b.shouldReduceToolResults([])).toBe(false);
  });

  it('returns true at exactly 70% usage', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    // Use ceil to ensure ratio lands at or above the 0.7 threshold
    b.updateFromUsage(Math.ceil(183_616 * 0.7));
    expect(b.shouldReduceToolResults([])).toBe(true);
  });

  it('returns true above 70% usage', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    b.updateFromUsage(Math.floor(183_616 * 0.85));
    expect(b.shouldReduceToolResults([])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

describe('TokenBudget — summary', () => {
  it('returns a human-readable string with token counts', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    b.updateFromUsage(10_000);
    const s = b.summary([]);
    expect(s).toContain('10,000');
    expect(s).toContain('200,000');
    expect(s).toMatch(/%/);
  });

  it('shows correct percentage for half-used budget', () => {
    const b = new TokenBudget('claude-sonnet-4-6', 16_384);
    b.updateFromUsage(91_808); // ~50% of 183616
    const s = b.summary([]);
    expect(s).toContain('50.');
  });
});
