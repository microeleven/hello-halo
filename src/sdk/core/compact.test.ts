/**
 * Unit tests for compaction utilities.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutoCompactState,
  shouldAutoCompact,
  calculateTokenWarningState,
  microCompact,
  apiCompact,
  formatCompactSummary,
} from './compact.js';
import type { Message, ToolResultBlock } from '../types/provider.js';

// ---------------------------------------------------------------------------
// AutoCompactState — circuit breaker
// ---------------------------------------------------------------------------

describe('AutoCompactState', () => {
  it('starts with all zeros, not disabled', () => {
    const state = new AutoCompactState();
    expect(state.compactionCount).toBe(0);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.disabled).toBe(false);
  });

  it('onSuccess() increments compactionCount and resets consecutiveFailures', () => {
    const state = new AutoCompactState();
    state.onFailure();
    state.onSuccess();
    expect(state.compactionCount).toBe(1);
    expect(state.consecutiveFailures).toBe(0);
  });

  it('onFailure() increments consecutiveFailures', () => {
    const state = new AutoCompactState();
    state.onFailure();
    state.onFailure();
    expect(state.consecutiveFailures).toBe(2);
    expect(state.disabled).toBe(false);
  });

  it('opens circuit breaker after MAX_CONSECUTIVE_COMPACT_FAILURES (3) failures', () => {
    const state = new AutoCompactState();
    state.onFailure();
    state.onFailure();
    expect(state.disabled).toBe(false);
    state.onFailure(); // 3rd failure → open
    expect(state.disabled).toBe(true);
  });

  it('success resets consecutiveFailures but does not re-enable after circuit open', () => {
    const state = new AutoCompactState();
    state.onFailure();
    state.onFailure();
    state.onFailure(); // circuit open
    state.onSuccess();
    // Circuit stays open — once tripped, manual reset is needed
    expect(state.disabled).toBe(true);
    expect(state.consecutiveFailures).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shouldAutoCompact
// ---------------------------------------------------------------------------

describe('shouldAutoCompact', () => {
  it('returns false when circuit breaker is open', () => {
    const state = new AutoCompactState();
    state.disabled = true;
    expect(shouldAutoCompact(1_000_000, 'claude-sonnet-4-6', state)).toBe(false);
  });

  it('returns false when tokens are below threshold (90% of context window)', () => {
    const state = new AutoCompactState();
    // claude-sonnet-4-6 → 200k context window; threshold = 180k
    expect(shouldAutoCompact(150_000, 'claude-sonnet-4-6', state)).toBe(false);
  });

  it('returns true when tokens exceed threshold', () => {
    const state = new AutoCompactState();
    expect(shouldAutoCompact(190_000, 'claude-sonnet-4-6', state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateTokenWarningState
// ---------------------------------------------------------------------------

describe('calculateTokenWarningState', () => {
  it('returns ok when usage is low', () => {
    expect(calculateTokenWarningState(50_000, 'claude-sonnet-4-6')).toBe('ok');
  });

  it('returns warning at 80%+', () => {
    // 200k window → 80% = 160k
    expect(calculateTokenWarningState(165_000, 'claude-sonnet-4-6')).toBe('warning');
  });

  it('returns critical at 95%+', () => {
    // 200k window → 95% = 190k
    expect(calculateTokenWarningState(195_000, 'claude-sonnet-4-6')).toBe('critical');
  });
});

// ---------------------------------------------------------------------------
// microCompact — replaces large tool results with placeholders
// microCompact returns { messages, truncatedCount }
// ---------------------------------------------------------------------------

function makeToolResultMsg(content: string): Message {
  return {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: 'tu1',
      content,
    } as ToolResultBlock],
  };
}

describe('microCompact', () => {
  it('returns messages unchanged when no large tool results', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const { messages, truncatedCount } = microCompact(msgs, 1_000_000);
    expect(messages).toHaveLength(2);
    expect(truncatedCount).toBe(0);
    expect(messages[0].content).toBe('Hello');
  });

  it('truncates large tool results when over budget', () => {
    const bigContent = 'x'.repeat(100_000);
    const msgs: Message[] = [makeToolResultMsg(bigContent)];
    // Pass a small budget to force truncation
    const { messages, truncatedCount } = microCompact(msgs, 100);
    expect(truncatedCount).toBeGreaterThan(0);
    const block = (messages[0].content as ToolResultBlock[])[0];
    expect(block.content).toContain('[tool result truncated');
  });

  it('returns truncatedCount=0 when within budget', () => {
    const msgs: Message[] = [makeToolResultMsg('small content')];
    const { truncatedCount } = microCompact(msgs, 1_000_000);
    expect(truncatedCount).toBe(0);
  });

  it('does not modify string-content messages', () => {
    const msgs: Message[] = [{ role: 'user', content: 'plain text' }];
    const { messages } = microCompact(msgs, 0); // budget=0 forces compaction
    expect(messages[0].content).toBe('plain text');
  });
});

// ---------------------------------------------------------------------------
// apiCompact — removes old messages, returns null when no compaction needed
// apiCompact returns Message[] | null
// ---------------------------------------------------------------------------

describe('apiCompact', () => {
  it('returns null when messages are under MAX_INPUT_TOKENS', () => {
    const msgs: Message[] = Array.from({ length: 5 }, (_, i) => ({
      role: 'user' as const,
      content: `msg ${i}`,
    }));
    // Short messages → well under 180k tokens → returns null
    const result = apiCompact(msgs);
    expect(result).toBeNull();
  });

  it('returns trimmed message array when over MAX_INPUT_TOKENS', () => {
    // Create many large messages to exceed the 180k token threshold
    // Each message is ~5000 chars ≈ 3750 tokens; 60 msgs ≈ 225k tokens
    const msgs: Message[] = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: 'a'.repeat(5000),
    }));
    const result = apiCompact(msgs);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThan(msgs.length);
  });

  it('returns null when message count is too small to trim', () => {
    // KEEP_RECENT_MESSAGES=10; with ≤11 messages, returns null
    const msgs: Message[] = Array.from({ length: 5 }, () => ({
      role: 'user' as const,
      content: 'a'.repeat(10_000), // large but not enough messages
    }));
    const result = apiCompact(msgs);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatCompactSummary
// ---------------------------------------------------------------------------

describe('formatCompactSummary', () => {
  it('returns cleaned summary without leading/trailing whitespace', () => {
    const result = formatCompactSummary('  Summary text  ');
    expect(result.trim()).toBe('Summary text');
  });

  it('returns empty string for empty input', () => {
    expect(formatCompactSummary('')).toBe('');
  });
});
