/**
 * Unit tests for token estimation utilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { estimateTokens, estimateMessageTokens, ApiTokenAnchor, isWithinBudget } from './tokens.js';
import type { Message } from '../types/provider.js';

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns positive value for non-empty string', () => {
    expect(estimateTokens('Hello world')).toBeGreaterThan(0);
  });

  it('uses approx 0.75 chars-per-token ratio', () => {
    // 100 chars → ceil(100 * 0.75) = 75
    expect(estimateTokens('a'.repeat(100))).toBe(75);
  });

  it('longer strings produce higher estimates', () => {
    const short = estimateTokens('Short');
    const long = estimateTokens('A'.repeat(1000));
    expect(long).toBeGreaterThan(short);
  });
});

// ---------------------------------------------------------------------------
// estimateMessageTokens
// ---------------------------------------------------------------------------

describe('estimateMessageTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it('estimates tokens for string content', () => {
    const msgs: Message[] = [{ role: 'user', content: 'Hello' }];
    const est = estimateMessageTokens(msgs);
    expect(est).toBeGreaterThan(0);
    // "Hello" → 5 chars → ceil(5*0.75)=4 + 4 overhead = 8
    expect(est).toBe(8);
  });

  it('estimates tokens for block content', () => {
    const msgs: Message[] = [{
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello world' }],
    }];
    expect(estimateMessageTokens(msgs)).toBeGreaterThan(0);
  });

  it('includes tool_use block estimation', () => {
    const msgs: Message[] = [{
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'tu1',
        name: 'Bash',
        input: { command: 'ls -la /usr/local' },
      }],
    }];
    expect(estimateMessageTokens(msgs)).toBeGreaterThan(10);
  });

  it('adds up multiple messages', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'A'.repeat(100) },
      { role: 'assistant', content: 'B'.repeat(100) },
    ];
    const single = estimateMessageTokens([msgs[0]]);
    const both = estimateMessageTokens(msgs);
    expect(both).toBeGreaterThan(single);
  });
});

// ---------------------------------------------------------------------------
// ApiTokenAnchor
// ---------------------------------------------------------------------------

describe('ApiTokenAnchor', () => {
  let anchor: ApiTokenAnchor;

  beforeEach(() => {
    anchor = new ApiTokenAnchor();
  });

  it('starts without an anchor', () => {
    expect(anchor.hasAnchor).toBe(false);
    expect(anchor.lastApiTokens).toBe(0);
  });

  it('establishes anchor on first anchor() call', () => {
    anchor.anchor(1000, 800);
    expect(anchor.hasAnchor).toBe(true);
    expect(anchor.lastApiTokens).toBe(1000);
  });

  it('scales local estimate by API/local ratio', () => {
    // Anchor: API says 2000 tokens, local estimate was 1000 → ratio = 2
    anchor.anchor(2000, 1000);

    const msgs: Message[] = [{ role: 'user', content: 'a'.repeat(400) }];
    const localEst = estimateMessageTokens(msgs); // should be ~304
    const anchored = anchor.estimateWithAnchor(msgs);

    // anchored ≈ localEst * 2
    expect(anchored).toBeCloseTo(localEst * 2, -1); // within 10 tokens
  });

  it('falls back to raw estimate when no anchor', () => {
    const msgs: Message[] = [{ role: 'user', content: 'Hello' }];
    const raw = estimateMessageTokens(msgs);
    const estimated = anchor.estimateWithAnchor(msgs);
    expect(estimated).toBe(raw);
  });

  it('reset() clears the anchor', () => {
    anchor.anchor(1000, 800);
    anchor.reset();
    expect(anchor.hasAnchor).toBe(false);
    expect(anchor.lastApiTokens).toBe(0);
  });

  it('ignores anchor() calls with zero values', () => {
    anchor.anchor(0, 800);
    expect(anchor.hasAnchor).toBe(false);
    anchor.anchor(1000, 0);
    expect(anchor.hasAnchor).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isWithinBudget
// ---------------------------------------------------------------------------

describe('isWithinBudget', () => {
  it('returns true when well within budget', () => {
    expect(isWithinBudget(1000, 10000)).toBe(true);
  });

  it('returns false when at 100% of budget', () => {
    expect(isWithinBudget(10000, 10000)).toBe(false);
  });

  it('returns false when over budget', () => {
    expect(isWithinBudget(9500, 10000)).toBe(false); // 9500 > 9000 threshold
  });

  it('returns true when at exactly the threshold (90% by default)', () => {
    // 9000 <= 10000 * 0.9 = 9000 → true (boundary)
    expect(isWithinBudget(9000, 10000)).toBe(true);
  });

  it('respects custom threshold', () => {
    // threshold=0.5: max=1000, limit=500
    expect(isWithinBudget(500, 1000, 0.5)).toBe(true);
    expect(isWithinBudget(501, 1000, 0.5)).toBe(false);
  });
});
