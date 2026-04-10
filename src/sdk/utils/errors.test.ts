/**
 * @module utils/errors.test
 * Unit tests for the SDK error type hierarchy and detection utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  SDKError,
  ProviderError,
  isContextWindowExceededError,
  ToolExecutionError,
  BudgetExceededError,
  MaxTurnsExceededError,
  AbortError,
  isAbortError,
  CompactError,
} from './errors.js';

// ---------------------------------------------------------------------------
// SDKError
// ---------------------------------------------------------------------------

describe('SDKError', () => {
  it('sets name, code, and message', () => {
    const err = new SDKError('MY_CODE', 'my message');
    expect(err.name).toBe('SDKError');
    expect(err.code).toBe('MY_CODE');
    expect(err.message).toBe('my message');
  });

  it('is an instanceof Error', () => {
    const err = new SDKError('X', 'y');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SDKError);
  });

  it('has a stack trace', () => {
    const err = new SDKError('X', 'y');
    expect(err.stack).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ProviderError
// ---------------------------------------------------------------------------

describe('ProviderError', () => {
  it('defaults retryable to false and no statusCode', () => {
    const err = new ProviderError('oops');
    expect(err.name).toBe('ProviderError');
    expect(err.retryable).toBe(false);
    expect(err.statusCode).toBeUndefined();
    expect(err.code).toBe('PROVIDER_ERROR');
  });

  it('accepts statusCode and retryable overrides', () => {
    const err = new ProviderError('bad gateway', { statusCode: 502, retryable: true });
    expect(err.statusCode).toBe(502);
    expect(err.retryable).toBe(true);
  });

  it('is instanceof SDKError and Error', () => {
    const err = new ProviderError('x');
    expect(err).toBeInstanceOf(SDKError);
    expect(err).toBeInstanceOf(Error);
  });

  describe('static factories', () => {
    it('rateLimit() creates a 429 retryable error', () => {
      const err = ProviderError.rateLimit();
      expect(err.statusCode).toBe(429);
      expect(err.retryable).toBe(true);
      expect(err.message).toBe('Rate limit exceeded');
    });

    it('rateLimit() accepts a custom message', () => {
      const err = ProviderError.rateLimit('custom rate limit');
      expect(err.message).toBe('custom rate limit');
    });

    it('overloaded() creates a 529 retryable error', () => {
      const err = ProviderError.overloaded();
      expect(err.statusCode).toBe(529);
      expect(err.retryable).toBe(true);
      expect(err.message).toBe('API overloaded');
    });

    it('contextWindowExceeded() creates a 400 non-retryable error', () => {
      const err = ProviderError.contextWindowExceeded();
      expect(err.statusCode).toBe(400);
      expect(err.retryable).toBe(false);
      expect(err.message).toBe('Context window exceeded');
    });
  });

  describe('isContextWindowExceeded getter', () => {
    it('returns false for non-400 errors', () => {
      const err = new ProviderError('too many requests', { statusCode: 429 });
      expect(err.isContextWindowExceeded).toBe(false);
    });

    it('returns false for 400 with unrelated message', () => {
      const err = new ProviderError('bad input format', { statusCode: 400 });
      expect(err.isContextWindowExceeded).toBe(false);
    });

    it('detects "prompt is too long"', () => {
      const err = new ProviderError('prompt is too long for this model', { statusCode: 400 });
      expect(err.isContextWindowExceeded).toBe(true);
    });

    it('detects "context_window_exceeded"', () => {
      const err = new ProviderError('context_window_exceeded limit hit', { statusCode: 400 });
      expect(err.isContextWindowExceeded).toBe(true);
    });

    it('detects "prompt_too_long"', () => {
      const err = new ProviderError('prompt_too_long error', { statusCode: 400 });
      expect(err.isContextWindowExceeded).toBe(true);
    });

    it('detects "context window" phrase', () => {
      const err = new ProviderError('context window limit exceeded', { statusCode: 400 });
      expect(err.isContextWindowExceeded).toBe(true);
    });

    it('is case-insensitive', () => {
      const err = new ProviderError('PROMPT IS TOO LONG', { statusCode: 400 });
      expect(err.isContextWindowExceeded).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// isContextWindowExceededError
// ---------------------------------------------------------------------------

describe('isContextWindowExceededError', () => {
  it('returns true for ProviderError with context window condition', () => {
    const err = ProviderError.contextWindowExceeded();
    expect(isContextWindowExceededError(err)).toBe(true);
  });

  it('returns false for ProviderError without context window condition', () => {
    const err = ProviderError.rateLimit();
    expect(isContextWindowExceededError(err)).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isContextWindowExceededError(null)).toBe(false);
    expect(isContextWindowExceededError(undefined)).toBe(false);
    expect(isContextWindowExceededError('string error')).toBe(false);
    expect(isContextWindowExceededError(42)).toBe(false);
  });

  it('detects raw Error with status=400 and context window message', () => {
    const err = Object.assign(new Error('prompt is too long'), { status: 400 });
    expect(isContextWindowExceededError(err)).toBe(true);
  });

  it('returns false for raw Error with status=400 but unrelated message', () => {
    const err = Object.assign(new Error('bad request: unknown field'), { status: 400 });
    expect(isContextWindowExceededError(err)).toBe(false);
  });

  it('returns false for raw Error with matching message but wrong status', () => {
    const err = Object.assign(new Error('prompt is too long'), { status: 500 });
    expect(isContextWindowExceededError(err)).toBe(false);
  });

  it('returns false for plain Error without status field', () => {
    const err = new Error('context window exceeded');
    expect(isContextWindowExceededError(err)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ToolExecutionError
// ---------------------------------------------------------------------------

describe('ToolExecutionError', () => {
  it('stores toolName, toolInput, and message', () => {
    const input = { path: '/tmp/foo.txt' };
    const err = new ToolExecutionError('Read', input, 'file not found');
    expect(err.name).toBe('ToolExecutionError');
    expect(err.toolName).toBe('Read');
    expect(err.toolInput).toBe(input);
    expect(err.message).toBe('file not found');
    expect(err.code).toBe('TOOL_EXECUTION_ERROR');
  });

  it('is instanceof SDKError and Error', () => {
    const err = new ToolExecutionError('Bash', {}, 'fail');
    expect(err).toBeInstanceOf(SDKError);
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// BudgetExceededError
// ---------------------------------------------------------------------------

describe('BudgetExceededError', () => {
  it('stores currentCostUsd and maxBudgetUsd', () => {
    const err = new BudgetExceededError(1.5, 1.0);
    expect(err.name).toBe('BudgetExceededError');
    expect(err.currentCostUsd).toBe(1.5);
    expect(err.maxBudgetUsd).toBe(1.0);
    expect(err.code).toBe('BUDGET_EXCEEDED');
  });

  it('includes dollar amounts in the message', () => {
    const err = new BudgetExceededError(2.1234, 2.0);
    expect(err.message).toContain('$2.1234');
    expect(err.message).toContain('$2.0000');
  });

  it('is instanceof SDKError', () => {
    const err = new BudgetExceededError(0, 0);
    expect(err).toBeInstanceOf(SDKError);
  });
});

// ---------------------------------------------------------------------------
// MaxTurnsExceededError
// ---------------------------------------------------------------------------

describe('MaxTurnsExceededError', () => {
  it('stores turns and maxTurns', () => {
    const err = new MaxTurnsExceededError(10, 5);
    expect(err.name).toBe('MaxTurnsExceededError');
    expect(err.turns).toBe(10);
    expect(err.maxTurns).toBe(5);
    expect(err.code).toBe('MAX_TURNS_EXCEEDED');
  });

  it('includes counts in the message', () => {
    const err = new MaxTurnsExceededError(10, 5);
    expect(err.message).toContain('10');
    expect(err.message).toContain('5');
  });

  it('is instanceof SDKError', () => {
    expect(new MaxTurnsExceededError(1, 1)).toBeInstanceOf(SDKError);
  });
});

// ---------------------------------------------------------------------------
// AbortError
// ---------------------------------------------------------------------------

describe('AbortError', () => {
  it('uses default message', () => {
    const err = new AbortError();
    expect(err.message).toBe('Operation was aborted');
    expect(err.name).toBe('AbortError');
    expect(err.code).toBe('ABORTED');
  });

  it('accepts a custom message', () => {
    const err = new AbortError('user cancelled');
    expect(err.message).toBe('user cancelled');
  });

  it('is instanceof SDKError', () => {
    expect(new AbortError()).toBeInstanceOf(SDKError);
  });
});

// ---------------------------------------------------------------------------
// isAbortError
// ---------------------------------------------------------------------------

describe('isAbortError', () => {
  it('returns true for AbortError instances', () => {
    expect(isAbortError(new AbortError())).toBe(true);
  });

  it('returns true for DOMException with name AbortError', () => {
    const dom = new Error('aborted');
    dom.name = 'AbortError';
    expect(isAbortError(dom)).toBe(true);
  });

  it('returns true for Anthropic SDK APIUserAbortError name', () => {
    const err = new Error('aborted by user');
    err.name = 'APIUserAbortError';
    expect(isAbortError(err)).toBe(true);
  });

  it('returns true for error with code ABORT_ERR', () => {
    const err = Object.assign(new Error('abort'), { code: 'ABORT_ERR' });
    expect(isAbortError(err)).toBe(true);
  });

  it('returns false for a regular Error', () => {
    expect(isAbortError(new Error('timeout'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError('abort')).toBe(false);
  });

  it('returns true when the provided signal is aborted, even for a generic error', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(isAbortError(new Error('generic'), ctrl.signal)).toBe(true);
  });

  it('returns false when signal is not aborted and error is not abort-like', () => {
    const ctrl = new AbortController();
    expect(isAbortError(new Error('generic'), ctrl.signal)).toBe(false);
  });

  it('returns false when signal is present but not yet aborted', () => {
    const ctrl = new AbortController();
    // Signal exists but has not been triggered
    expect(isAbortError(new ProviderError('rate limit'), ctrl.signal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CompactError
// ---------------------------------------------------------------------------

describe('CompactError', () => {
  it('uses default message', () => {
    const err = new CompactError();
    expect(err.message).toBe('Context compaction failed');
    expect(err.name).toBe('CompactError');
    expect(err.code).toBe('COMPACT_ERROR');
  });

  it('accepts a custom message', () => {
    const err = new CompactError('API compact failed');
    expect(err.message).toBe('API compact failed');
  });

  it('is instanceof SDKError', () => {
    expect(new CompactError()).toBeInstanceOf(SDKError);
  });
});

// ---------------------------------------------------------------------------
// instanceof across subclasses
// ---------------------------------------------------------------------------

describe('error class hierarchy', () => {
  it('all error subclasses are instanceof Error', () => {
    const errs: Error[] = [
      new SDKError('X', 'x'),
      new ProviderError('x'),
      new ToolExecutionError('t', {}, 'x'),
      new BudgetExceededError(0, 1),
      new MaxTurnsExceededError(1, 1),
      new AbortError(),
      new CompactError(),
    ];
    for (const e of errs) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(SDKError);
    }
  });

  it('ProviderError is not an AbortError', () => {
    expect(new ProviderError('x')).not.toBeInstanceOf(AbortError);
  });

  it('AbortError is not a ProviderError', () => {
    expect(new AbortError()).not.toBeInstanceOf(ProviderError);
  });
});
