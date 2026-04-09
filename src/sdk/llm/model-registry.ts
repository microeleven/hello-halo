/**
 * @module llm/model-registry
 * Model capability registry with pre-registered models and runtime lookup.
 * @license MIT
 */

// ---------------------------------------------------------------------------
// ModelRegistryEntry
// ---------------------------------------------------------------------------

/** Extended model information with capabilities and pricing. */
export interface ModelRegistryEntry {
  /** Model unique identifier (e.g. "claude-sonnet-4-6") */
  id: string;
  /** Human-readable display name (e.g. "Claude Sonnet 4.6") */
  displayName: string;
  /** Short description of model capabilities. */
  description?: string;
  /** Provider identifier (e.g. "anthropic", "openai", "deepseek") */
  provider: string;
  /** Total context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens per response */
  maxOutputTokens: number;
  /** Supports extended thinking / chain-of-thought */
  supportsThinking: boolean;
  /** Whether this model supports effort levels. */
  supportsEffort?: boolean;
  /** Available effort levels for this model. */
  supportedEffortLevels?: Array<'low' | 'medium' | 'high' | 'max'>;
  /** Accepts image inputs */
  supportsImages: boolean;
  /** Accepts PDF document inputs */
  supportsPdf: boolean;
  /** Supports prompt caching */
  supportsCaching: boolean;
  /** Supports function / tool calling */
  supportsToolUse: boolean;
  /** USD per 1M input tokens */
  inputCostPer1M: number;
  /** USD per 1M output tokens */
  outputCostPer1M: number;
}

// ---------------------------------------------------------------------------
// ModelRegistry
// ---------------------------------------------------------------------------

/** Registry of known models with capability and pricing lookups. */
export class ModelRegistry {
  private entries: Map<string, ModelRegistryEntry> = new Map();

  /** Register a model entry. Overwrites any existing entry with the same id. */
  register(entry: ModelRegistryEntry): void {
    this.entries.set(entry.id, entry);
  }

  /** Look up a model by its ID. */
  lookup(modelId: string): ModelRegistryEntry | undefined {
    // Exact match
    const exact = this.entries.get(modelId);
    if (exact) return exact;

    // Prefix match: some model IDs include version suffixes
    for (const [key, entry] of this.entries) {
      if (key.startsWith(modelId) || modelId.startsWith(key)) {
        return entry;
      }
    }

    return undefined;
  }

  /** Return all registered models. */
  listModels(): ModelRegistryEntry[] {
    return Array.from(this.entries.values());
  }

  /** Return all models for a specific provider. */
  listByProvider(provider: string): ModelRegistryEntry[] {
    return this.listModels().filter((e) => e.provider === provider);
  }

  /**
   * Detect the provider for a bare model name using well-known prefixes.
   * Returns `undefined` if the model cannot be matched.
   */
  detectProvider(modelName: string): string | undefined {
    const lower = modelName.toLowerCase();

    if (lower.startsWith('claude')) return 'anthropic';
    if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) return 'openai';
    if (lower.startsWith('gemini') || lower.startsWith('gemma')) return 'google';
    if (lower.startsWith('deepseek')) return 'deepseek';
    if (lower.startsWith('qwen')) return 'qwen';
    if (lower.startsWith('mistral') || lower.startsWith('codestral') || lower.startsWith('pixtral')) return 'mistral';
    if (lower.startsWith('grok')) return 'xai';
    if (lower.startsWith('command-r') || lower.startsWith('command-a')) return 'cohere';
    if (lower.startsWith('sonar')) return 'perplexity';
    if (lower.startsWith('llama')) return 'meta';

    // Check registry entries
    const entry = this.lookup(modelName);
    if (entry) return entry.provider;

    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Default registry factory
// ---------------------------------------------------------------------------

/** Create a ModelRegistry pre-populated with well-known models. */
export function getDefaultRegistry(): ModelRegistry {
  const registry = new ModelRegistry();

  // --- Anthropic ---
  registry.register({
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    description: 'Fast, intelligent model for everyday coding tasks.',
    provider: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    supportsThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
    supportsImages: true,
    supportsPdf: true,
    supportsCaching: true,
    supportsToolUse: true,
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
  });

  registry.register({
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6',
    description: 'Most capable model for complex reasoning and analysis.',
    provider: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    supportsThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
    supportsImages: true,
    supportsPdf: true,
    supportsCaching: true,
    supportsToolUse: true,
    inputCostPer1M: 15.0,
    outputCostPer1M: 75.0,
  });

  registry.register({
    id: 'claude-haiku-3-5',
    displayName: 'Claude Haiku 3.5',
    description: 'Fastest model for simple tasks and quick interactions.',
    provider: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
    supportsImages: true,
    supportsPdf: true,
    supportsCaching: true,
    supportsToolUse: true,
    inputCostPer1M: 0.8,
    outputCostPer1M: 4.0,
  });

  // --- OpenAI ---
  registry.register({
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsImages: true,
    supportsPdf: false,
    supportsCaching: false,
    supportsToolUse: true,
    inputCostPer1M: 2.5,
    outputCostPer1M: 10.0,
  });

  registry.register({
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    provider: 'openai',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsImages: true,
    supportsPdf: false,
    supportsCaching: false,
    supportsToolUse: true,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
  });

  // --- DeepSeek ---
  registry.register({
    id: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    provider: 'deepseek',
    contextWindow: 64_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
    supportsImages: false,
    supportsPdf: false,
    supportsCaching: false,
    supportsToolUse: true,
    inputCostPer1M: 0.14,
    outputCostPer1M: 0.28,
  });

  // --- Qwen ---
  registry.register({
    id: 'qwen-plus',
    displayName: 'Qwen Plus',
    provider: 'qwen',
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsImages: false,
    supportsPdf: false,
    supportsCaching: false,
    supportsToolUse: true,
    inputCostPer1M: 0.8,
    outputCostPer1M: 2.0,
  });

  return registry;
}

// ---------------------------------------------------------------------------
// Singleton accessor for Query.supportedModels()
// ---------------------------------------------------------------------------

let _singleton: ModelRegistry | null = null;

/**
 * Get the module-level singleton model registry.
 * Lazily initialized on first call via getDefaultRegistry().
 */
export function getModelRegistry(): Record<string, ModelRegistryEntry> {
  if (!_singleton) {
    _singleton = getDefaultRegistry();
  }
  const result: Record<string, ModelRegistryEntry> = {};
  for (const entry of _singleton.listModels()) {
    result[entry.id] = entry;
  }
  return result;
}
