/**
 * Unit tests for retry utility functions.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  delayForAttempt,
  isRetryableStatus,
  parseRetryAfterMs,
  sleep,
  DEFAULT_RETRY,
} from './retry.js';

// ---------------------------------------------------------------------------
// delayForAttempt
// ---------------------------------------------------------------------------

describe('delayForAttempt', () => {
  it('returns initial delay for attempt 0', () => {
    const d = delayForAttempt(DEFAULT_RETRY, 0);
    // initialDelayMs=1000, no backoff yet; should be roughly 1000-1100ms
    expect(d).toBeGreaterThanOrEqual(1000);
    expect(d).toBeLessThanOrEqual(1100);
  });

  it('doubles with each attempt (exponential backoff)', () => {
    const d0 = delayForAttempt({ ...DEFAULT_RETRY, initialDelayMs: 1000, backoffMultiplier: 2 }, 0);
    const d1 = delayForAttempt({ ...DEFAULT_RETRY, initialDelayMs: 1000, backoffMultiplier: 2 }, 1);
    // d1 base = 2000, d0 base = 1000 → ratio ≈ 2
    expect(d1 / d0).toBeGreaterThan(1.5);
    expect(d1 / d0).toBeLessThan(2.5);
  });

  it('caps at maxDelayMs', () => {
    const cfg = { ...DEFAULT_RETRY, initialDelayMs: 1000, maxDelayMs: 5000, backoffMultiplier: 10 };
    const d = delayForAttempt(cfg, 5);
    expect(d).toBeLessThanOrEqual(5000);
  });
});

// ---------------------------------------------------------------------------
// isRetryableStatus
// ---------------------------------------------------------------------------

describe('isRetryableStatus', () => {
  it('returns true for 429 (rate limit)', () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it('returns true for 529 (Anthropic overloaded)', () => {
    expect(isRetryableStatus(529)).toBe(true);
  });

  it('returns true for 500 series errors', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
  });

  it('returns false for 200, 400, 401, 403, 404', () => {
    for (const status of [200, 201, 400, 401, 403, 404]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// parseRetryAfterMs
// ---------------------------------------------------------------------------

function makeHeaders(pairs: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(pairs)) {
    h.set(k, v);
  }
  return h;
}

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds integer', () => {
    const ms = parseRetryAfterMs(makeHeaders({ 'retry-after': '30' }));
    expect(ms).toBe(30_000);
  });

  it('parses delta-seconds float (rounds up)', () => {
    const ms = parseRetryAfterMs(makeHeaders({ 'retry-after': '1.5' }));
    expect(ms).toBe(2_000);
  });

  it('parses HTTP-date in the future', () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const ms = parseRetryAfterMs(makeHeaders({ 'retry-after': future }));
    expect(ms).toBeDefined();
    expect(ms!).toBeGreaterThan(50_000);
    expect(ms!).toBeLessThan(70_000);
  });

  it('returns undefined when header absent', () => {
    expect(parseRetryAfterMs(new Headers())).toBeUndefined();
  });

  it('returns undefined for unparseable value', () => {
    const ms = parseRetryAfterMs(makeHeaders({ 'retry-after': 'not-a-date' }));
    expect(ms).toBeUndefined();
  });

  it('returns undefined for past HTTP-date', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    const ms = parseRetryAfterMs(makeHeaders({ 'retry-after': past }));
    expect(ms).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sleep
// ---------------------------------------------------------------------------

describe('sleep', () => {
  it('resolves after the specified delay', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('rejects immediately when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort(new Error('aborted'));
    await expect(sleep(10_000, ac.signal)).rejects.toThrow('aborted');
  });

  it('rejects when signal aborts mid-sleep', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    await expect(sleep(10_000, ac.signal)).rejects.toBeDefined();
  });
});
