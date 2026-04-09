/**
 * @module core/cost
 * CostTracker and ModelPricing for budget tracking and enforcement.
 * @license MIT
 */

import type { UsageInfo } from '../types/provider.js';
import { contextWindowForModel } from '../prompt/constants.js';

// ---------------------------------------------------------------------------
// ModelPricing — per-model token pricing in USD per million tokens
// ---------------------------------------------------------------------------

/** Per-model pricing tiers (USD per million tokens). */
export interface ModelPricing {
  /** Cost per million input tokens */
  inputPerMtk: number;
  /** Cost per million output tokens */
  outputPerMtk: number;
  /** Cost per million cache-creation input tokens */
  cacheCreationPerMtk: number;
  /** Cost per million cache-read input tokens */
  cacheReadPerMtk: number;
}

/** Known model pricing table. */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus': {
    inputPerMtk: 15.0,
    outputPerMtk: 75.0,
    cacheCreationPerMtk: 18.75,
    cacheReadPerMtk: 1.5,
  },
  'claude-sonnet': {
    inputPerMtk: 3.0,
    outputPerMtk: 15.0,
    cacheCreationPerMtk: 3.75,
    cacheReadPerMtk: 0.3,
  },
  'claude-haiku': {
    inputPerMtk: 0.8,
    outputPerMtk: 4.0,
    cacheCreationPerMtk: 1.0,
    cacheReadPerMtk: 0.08,
  },

  // OpenAI
  'gpt-4o': {
    inputPerMtk: 2.5,
    outputPerMtk: 10.0,
    cacheCreationPerMtk: 0,
    cacheReadPerMtk: 1.25,
  },
  'gpt-4o-mini': {
    inputPerMtk: 0.15,
    outputPerMtk: 0.6,
    cacheCreationPerMtk: 0,
    cacheReadPerMtk: 0.075,
  },

  // DeepSeek
  'deepseek-chat': {
    inputPerMtk: 0.27,
    outputPerMtk: 1.1,
    cacheCreationPerMtk: 0,
    cacheReadPerMtk: 0.07,
  },

  // Qwen
  'qwen-plus': {
    inputPerMtk: 0.8,
    outputPerMtk: 2.0,
    cacheCreationPerMtk: 0,
    cacheReadPerMtk: 0,
  },
};

/** Fallback pricing for unknown models (uses Sonnet pricing as default). */
const FALLBACK_PRICING: ModelPricing = {
  inputPerMtk: 3.0,
  outputPerMtk: 15.0,
  cacheCreationPerMtk: 3.75,
  cacheReadPerMtk: 0.3,
};

/**
 * Resolve pricing for a model by matching against known model name patterns.
 * Falls back to Sonnet pricing if no match is found.
 */
export function getPricingForModel(model: string): ModelPricing {
  const lower = model.toLowerCase();

  // Exact key match first
  if (MODEL_PRICING[lower]) {
    return MODEL_PRICING[lower];
  }

  // Substring matching (order: most expensive first to avoid false positives)
  if (lower.includes('opus')) return MODEL_PRICING['claude-opus'];
  if (lower.includes('haiku')) return MODEL_PRICING['claude-haiku'];
  if (lower.includes('sonnet')) return MODEL_PRICING['claude-sonnet'];
  if (lower.includes('gpt-4o-mini')) return MODEL_PRICING['gpt-4o-mini'];
  if (lower.includes('gpt-4o')) return MODEL_PRICING['gpt-4o'];
  if (lower.includes('deepseek')) return MODEL_PRICING['deepseek-chat'];
  if (lower.includes('qwen')) return MODEL_PRICING['qwen-plus'];

  return FALLBACK_PRICING;
}

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

/**
 * Tracks accumulated token usage and cost across a session.
 * Used for budget enforcement via `maxBudgetUsd`.
 */
/** Per-model usage entry for modelUsage tracking. */
export interface ModelUsageEntry {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_cost_usd: number;
  /** Context window size for this model in tokens. */
  contextWindow: number;
}

export class CostTracker {
  private _inputTokens = 0;
  private _outputTokens = 0;
  private _cacheCreationTokens = 0;
  private _cacheReadTokens = 0;
  /** Running total cost in USD, accumulated per-call with correct pricing. */
  private _totalCostUsd = 0;
  private _pricing: ModelPricing;
  private _modelUsage = new Map<string, ModelUsageEntry>();

  constructor(model = 'claude-sonnet-4-6') {
    this._pricing = getPricingForModel(model);
  }

  /** Update the pricing tier for a new model. */
  setModel(model: string): void {
    this._pricing = getPricingForModel(model);
  }

  /**
   * Record token usage from a provider response.
   * @param usage - Usage info from the provider response
   * @param model - Optional model override for pricing lookup
   */
  add(usage: UsageInfo, model?: string): void {
    if (model) {
      this._pricing = getPricingForModel(model);
    }
    const input = usage.input_tokens;
    const output = usage.output_tokens;
    const cacheCreation = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;

    this._inputTokens += input;
    this._outputTokens += output;
    this._cacheCreationTokens += cacheCreation;
    this._cacheReadTokens += cacheRead;

    // Track per-model usage
    const modelKey = model ?? 'unknown';
    const existing = this._modelUsage.get(modelKey);
    const pricing = model ? getPricingForModel(model) : this._pricing;
    const callCost =
      (input * pricing.inputPerMtk +
        output * pricing.outputPerMtk +
        cacheCreation * pricing.cacheCreationPerMtk +
        cacheRead * pricing.cacheReadPerMtk) /
      1_000_000;

    // Accumulate total cost per-call so model switches don't retroactively reprice history
    this._totalCostUsd += callCost;

    if (existing) {
      existing.input_tokens += input;
      existing.output_tokens += output;
      existing.cache_creation_input_tokens += cacheCreation;
      existing.cache_read_input_tokens += cacheRead;
      existing.total_cost_usd += callCost;
    } else {
      this._modelUsage.set(modelKey, {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
        total_cost_usd: callCost,
        contextWindow: contextWindowForModel(modelKey),
      });
    }
  }

  /** Total accumulated cost in USD. */
  get totalCostUsd(): number {
    return this._totalCostUsd;
  }

  /** Total input tokens recorded. */
  get totalInputTokens(): number {
    return this._inputTokens;
  }

  /** Total output tokens recorded. */
  get totalOutputTokens(): number {
    return this._outputTokens;
  }

  /** Total cache creation tokens recorded. */
  get totalCacheCreationTokens(): number {
    return this._cacheCreationTokens;
  }

  /** Total cache read tokens recorded. */
  get totalCacheReadTokens(): number {
    return this._cacheReadTokens;
  }

  /** Total tokens across all categories. */
  get totalTokens(): number {
    return (
      this._inputTokens +
      this._outputTokens +
      this._cacheCreationTokens +
      this._cacheReadTokens
    );
  }

  /** Check whether the accumulated cost exceeds a budget. */
  isOverBudget(maxBudgetUsd: number): boolean {
    return this.totalCostUsd >= maxBudgetUsd;
  }

  /** Reset all counters to zero. */
  reset(): void {
    this._inputTokens = 0;
    this._outputTokens = 0;
    this._cacheCreationTokens = 0;
    this._cacheReadTokens = 0;
    this._totalCostUsd = 0;
    this._modelUsage.clear();
  }

  /** Get cumulative usage as a flat object. */
  getUsage(): {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  } {
    return {
      input_tokens: this._inputTokens,
      output_tokens: this._outputTokens,
      cache_creation_input_tokens: this._cacheCreationTokens,
      cache_read_input_tokens: this._cacheReadTokens,
    };
  }

  /** Get per-model usage as a plain record. */
  getModelUsage(): Record<string, ModelUsageEntry> {
    const result: Record<string, ModelUsageEntry> = {};
    for (const [key, entry] of this._modelUsage) {
      result[key] = { ...entry };
    }
    return result;
  }

  /**
   * Roll up costs from a child (sub-agent) CostTracker into this parent tracker.
   * This ensures the parent's budget check includes child spending.
   */
  addChildCost(child: CostTracker): void {
    this._inputTokens += child.totalInputTokens;
    this._outputTokens += child.totalOutputTokens;
    this._cacheCreationTokens += child.totalCacheCreationTokens;
    this._cacheReadTokens += child.totalCacheReadTokens;
    this._totalCostUsd += child.totalCostUsd;

    // Merge per-model usage
    for (const [modelKey, childEntry] of Object.entries(child.getModelUsage())) {
      const existing = this._modelUsage.get(modelKey);
      if (existing) {
        existing.input_tokens += childEntry.input_tokens;
        existing.output_tokens += childEntry.output_tokens;
        existing.cache_creation_input_tokens +=
          childEntry.cache_creation_input_tokens;
        existing.cache_read_input_tokens += childEntry.cache_read_input_tokens;
        existing.total_cost_usd += childEntry.total_cost_usd;
      } else {
        this._modelUsage.set(modelKey, { ...childEntry });
      }
    }
  }

  /** Human-readable summary string. */
  summary(): string {
    const cost = this.totalCostUsd;
    const total = this.totalTokens;
    if (cost < 0.01) {
      return `${total} tokens (<$0.01)`;
    }
    return `${total} tokens ($${cost.toFixed(2)})`;
  }
}
