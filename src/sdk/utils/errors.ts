/**
 * @module utils/errors
 * Error type hierarchy for the Agent-Core SDK.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

/** Base error class for all SDK errors. */
export class SDKError extends Error {
  /** Machine-readable error code */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SDKError';
    this.code = code;
    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Provider errors (API / network / auth)
// ---------------------------------------------------------------------------

/** Error originating from an LLM provider (API errors, network failures). */
export class ProviderError extends SDKError {
  /** HTTP status code, if available */
  readonly statusCode?: number;
  /** Whether the caller should retry this request */
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: { statusCode?: number; retryable?: boolean },
  ) {
    super('PROVIDER_ERROR', message);
    this.name = 'ProviderError';
    this.statusCode = options?.statusCode;
    this.retryable = options?.retryable ?? false;
  }

  /** Create a rate-limit error (HTTP 429). */
  static rateLimit(message = 'Rate limit exceeded'): ProviderError {
    return new ProviderError(message, { statusCode: 429, retryable: true });
  }

  /** Create an overloaded error (HTTP 529). */
  static overloaded(message = 'API overloaded'): ProviderError {
    return new ProviderError(message, { statusCode: 529, retryable: true });
  }

  /** Create a context-window-exceeded error. */
  static contextWindowExceeded(
    message = 'Context window exceeded',
  ): ProviderError {
    return new ProviderError(message, { statusCode: 400, retryable: false });
  }

  /**
   * Check whether this error represents a context-window-exceeded / prompt-too-long
   * condition. The Anthropic API returns HTTP 400 with error type
   * "invalid_request_error" and a message containing "prompt is too long" or
   * "context_window_exceeded".
   */
  get isContextWindowExceeded(): boolean {
    if (this.statusCode !== 400) return false;
    const msg = this.message.toLowerCase();
    return (
      msg.includes('prompt is too long') ||
      msg.includes('context_window_exceeded') ||
      msg.includes('prompt_too_long') ||
      msg.includes('context window')
    );
  }
}

/**
 * Check whether an arbitrary error represents a context-window-exceeded condition.
 * Works with both ProviderError and raw Error objects from provider SDKs.
 */
export function isContextWindowExceededError(err: unknown): boolean {
  if (err instanceof ProviderError) return err.isContextWindowExceeded;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const status = (err as { status?: number }).status;
    if (status === 400) {
      return (
        msg.includes('prompt is too long') ||
        msg.includes('context_window_exceeded') ||
        msg.includes('prompt_too_long') ||
        msg.includes('context window')
      );
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tool execution error
// ---------------------------------------------------------------------------

/** Error thrown when a tool fails during execution. */
export class ToolExecutionError extends SDKError {
  /** Name of the tool that failed */
  readonly toolName: string;
  /** Input that was passed to the tool */
  readonly toolInput: Record<string, unknown>;

  constructor(
    toolName: string,
    toolInput: Record<string, unknown>,
    message: string,
  ) {
    super('TOOL_EXECUTION_ERROR', message);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
    this.toolInput = toolInput;
  }
}

// ---------------------------------------------------------------------------
// Budget exceeded
// ---------------------------------------------------------------------------

/** Error thrown when the cost budget has been exceeded. */
export class BudgetExceededError extends SDKError {
  /** Current accumulated cost in USD */
  readonly currentCostUsd: number;
  /** Configured maximum budget in USD */
  readonly maxBudgetUsd: number;

  constructor(currentCostUsd: number, maxBudgetUsd: number) {
    super(
      'BUDGET_EXCEEDED',
      `Budget exceeded: $${currentCostUsd.toFixed(4)} spent, limit is $${maxBudgetUsd.toFixed(4)}`,
    );
    this.name = 'BudgetExceededError';
    this.currentCostUsd = currentCostUsd;
    this.maxBudgetUsd = maxBudgetUsd;
  }
}

// ---------------------------------------------------------------------------
// Max turns exceeded
// ---------------------------------------------------------------------------

/** Error thrown when the maximum number of conversation turns is reached. */
export class MaxTurnsExceededError extends SDKError {
  /** Number of turns completed */
  readonly turns: number;
  /** Configured maximum turns */
  readonly maxTurns: number;

  constructor(turns: number, maxTurns: number) {
    super(
      'MAX_TURNS_EXCEEDED',
      `Max turns exceeded: ${turns} turns completed, limit is ${maxTurns}`,
    );
    this.name = 'MaxTurnsExceededError';
    this.turns = turns;
    this.maxTurns = maxTurns;
  }
}

// ---------------------------------------------------------------------------
// Abort error
// ---------------------------------------------------------------------------

/** Error thrown when an operation is cancelled via AbortSignal. */
export class AbortError extends SDKError {
  constructor(message = 'Operation was aborted') {
    super('ABORTED', message);
    this.name = 'AbortError';
  }
}

// ---------------------------------------------------------------------------
// Multi-variant abort detection
// ---------------------------------------------------------------------------

/**
 * Detect whether an error represents an abort/cancellation, regardless of
 * source. Covers:
 * - Our own `AbortError`
 * - Anthropic SDK's `APIUserAbortError`
 * - DOM `DOMException` with name "AbortError" (fetch)
 * - Any error where the associated signal is already aborted
 */
export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (err instanceof AbortError) return true;

  if (err instanceof Error) {
    // DOMException thrown by fetch when the signal is aborted
    if (err.name === 'AbortError') return true;
    // Anthropic SDK abort class
    if (err.name === 'APIUserAbortError') return true;
    // Some libraries set err.code
    if ((err as { code?: string }).code === 'ABORT_ERR') return true;
  }

  // Signal-based detection: if the signal is aborted, treat any error as abort
  if (signal?.aborted) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Compact error
// ---------------------------------------------------------------------------

/** Error thrown when context compaction fails. */
export class CompactError extends SDKError {
  constructor(message = 'Context compaction failed') {
    super('COMPACT_ERROR', message);
    this.name = 'CompactError';
  }
}
