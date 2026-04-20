/**
 * Model Capabilities - Type Definitions
 *
 * Describes what each model can do (context window, vision, thinking, etc.).
 * Separates model capability metadata from AI source/channel configuration.
 *
 * Design:
 *   - Preset data lives in src/shared/data/model-capabilities.json
 *   - Users can override any field per-model inside their AISource config
 *   - Priority: user override > JSON preset > built-in defaults
 */

/** Full capability description for a single model */
export interface ModelCapability {
  /** Human-readable model name */
  displayName: string
  /** Owning provider (e.g. 'deepseek', 'qwen', 'anthropic', 'openai') */
  provider: string
  /** Maximum context window in tokens */
  contextWindow: number
  /** Maximum output tokens per response */
  maxOutputTokens: number
  /** Whether the model accepts image input */
  vision: boolean
  /** Whether the model supports extended thinking / reasoning mode */
  thinking: boolean
}

/**
 * User-supplied partial override for a single model.
 * Only fields the user changes need to be present.
 */
export type ModelCapabilityOverride = Partial<ModelCapability>

/** Top-level structure of model-capabilities.json */
export interface ModelCapabilitiesPreset {
  /** Schema version for future migration support */
  version: number
  /** ISO date of when this preset was last updated */
  updatedAt: string
  /**
   * Prefix-based fallback patterns.
   * When no exact match exists in `models`, the service tries the longest
   * matching prefix from this map. Useful for model families where all
   * variants share the same capabilities (e.g. all Claude Opus → 200K).
   */
  patterns?: Record<string, ModelCapability>
  /** Map of model ID → capability data */
  models: Record<string, ModelCapability>
}
