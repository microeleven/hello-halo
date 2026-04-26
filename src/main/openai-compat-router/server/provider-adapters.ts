/**
 * Provider Adapters
 *
 * Handles provider-specific request/response transformations.
 * Each adapter encapsulates the quirks and requirements of a specific LLM provider.
 *
 * Design principles:
 * - Single Responsibility: Each adapter handles one provider
 * - Open/Closed: Easy to add new adapters without modifying existing code
 * - Dual matching: URL-based detection (built-in providers) + adapterId (plugin providers)
 * - Minimal by default: The converter produces a spec-compliant baseline; adapters
 *   opt-in to extensions. No provider-specific fields leak into the shared interface.
 */

import type { AnthropicMessage, AnthropicRequest } from '../types'

// ============================================================================
// Types
// ============================================================================

/**
 * Original request context passed to adapters.
 * Gives adapters access to pre-conversion data (e.g. thinking blocks)
 * without polluting the shared interface with provider-specific flags.
 */
export interface AdapterContext {
  /** The original Anthropic request before any conversion */
  readonly originalRequest: AnthropicRequest
}

export interface ProviderAdapter {
  /** Unique identifier for this adapter */
  readonly id: string

  /** Human-readable name */
  readonly name: string

  /** Check if this adapter should handle the given URL */
  match(url: string): boolean

  /**
   * Transform request body before sending to provider.
   * Mutates body in place for efficiency.
   * Use context.originalRequest to access pre-conversion data (e.g. thinking blocks).
   */
  transformRequest?(body: Record<string, unknown>, context?: AdapterContext): void

  /**
   * Get additional headers to include in the request.
   * These headers are merged with existing headers (adapter headers take precedence).
   */
  getExtraHeaders?(): Record<string, string>
}

// ============================================================================
// Groq Adapter
// ============================================================================

/**
 * Groq requires temperature > 0
 *
 * When temperature is exactly 0, Groq API returns an error.
 * We convert 0 to 0.01 which is effectively deterministic but valid.
 *
 * @see https://console.groq.com/docs/api-reference#chat-create
 */
const groqAdapter: ProviderAdapter = {
  id: 'groq',
  name: 'Groq',

  match(url: string): boolean {
    return url.includes('api.groq.com')
  },

  transformRequest(body: Record<string, unknown>): void {
    if (body.temperature === 0) {
      body.temperature = 0.01
    }
  }
}

// ============================================================================
// OpenRouter Adapter
// ============================================================================

/**
 * OpenRouter recommends app attribution headers
 *
 * These headers are optional but provide:
 * - App appears in OpenRouter leaderboard
 * - Request analytics show app name instead of "Unknown"
 *
 * @see https://openrouter.ai/docs/app-attribution
 */
const openRouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  name: 'OpenRouter',

  match(url: string): boolean {
    return url.includes('openrouter.ai')
  },

  getExtraHeaders(): Record<string, string> {
    return {
      'HTTP-Referer': 'https://hello-halo.cc/',
      'X-Title': 'Halo'
    }
  }
}

// ============================================================================
// DeepSeek Adapter
// ============================================================================

/**
 * DeepSeek adapter
 *
 * When thinking mode is active (reasoning_effort is set), DeepSeek requires
 * `reasoning_content` from previous assistant turns to be echoed back.
 * Without it, the API returns HTTP 400:
 *   "The `reasoning_content` in the thinking mode must be passed back to the API."
 *
 * When thinking mode is NOT active, reasoning_content must be absent — the
 * converter already omits it by default, so no stripping is needed.
 *
 * @see https://api-docs.deepseek.com/
 */
const deepSeekAdapter: ProviderAdapter = {
  id: 'deepseek',
  name: 'DeepSeek',

  match(url: string): boolean {
    return url.includes('api.deepseek.com')
  },

  transformRequest(body: Record<string, unknown>, context?: AdapterContext): void {
    // Inject reasoning_content when:
    //   1. reasoning_effort is set (thinking mode explicitly active), OR
    //   2. Original request contains thinking blocks from previous turns
    //      (DeepSeek reasoner models return reasoning_content even without
    //      reasoning_effort; subsequent turns MUST echo it back or the API
    //      returns HTTP 400)
    const hasReasoningEffort = !!body.reasoning_effort
    const hasThinkingBlocks = context?.originalRequest?.messages?.some(
      (msg) => msg.role === 'assistant' && Array.isArray(msg.content) &&
        (msg.content as Array<{ type?: string }>).some((b) => b.type === 'thinking')
    ) ?? false

    if (!hasReasoningEffort && !hasThinkingBlocks) return

    injectReasoningContent(body, context)

    // Ensure every assistant message carries the reasoning_content field.
    // injectReasoningContent only sets it on turns that have thinking blocks;
    // turns without (e.g. after context compaction) would be missing the field
    // entirely, causing DeepSeek to reject the request with HTTP 400.
    const messages = body.messages
    if (!Array.isArray(messages)) return

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue
      const m = msg as Record<string, unknown>
      if (m.role === 'assistant' && m.reasoning_content == null) {
        m.reasoning_content = ''
      }
    }
  }
}

// ============================================================================
// Shared helper: inject reasoning_content from thinking blocks
// ============================================================================

/**
 * Injects `reasoning_content` into OpenAI assistant messages using the
 * thinking blocks from the original Anthropic request.
 *
 * Used by providers that require `reasoning_content` to be passed back in
 * multi-turn conversations (e.g. Moonshot, GLM). The converter omits this
 * field by default since it is not part of the OpenAI spec.
 *
 * Assistant messages are always converted 1:1 from Anthropic → OpenAI, so
 * thinking content can be applied in sequence without index alignment issues.
 */
function injectReasoningContent(
  body: Record<string, unknown>,
  context?: AdapterContext
): void {
  const messages = body.messages
  if (!Array.isArray(messages) || !context?.originalRequest?.messages) return

  const thinkingByAssistantTurn: string[] = []
  for (const msg of context.originalRequest.messages as AnthropicMessage[]) {
    if (msg.role !== 'assistant') continue
    if (!Array.isArray(msg.content)) { thinkingByAssistantTurn.push(''); continue }
    const thinking = msg.content
      .filter((b: any) => b.type === 'thinking' && b.thinking)
      .map((b: any) => b.thinking as string)
      .join('\n')
    thinkingByAssistantTurn.push(thinking)
  }

  let assistantIdx = 0
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    if ((msg as Record<string, unknown>).role !== 'assistant') continue
    const thinking = thinkingByAssistantTurn[assistantIdx++]
    if (thinking) {
      (msg as Record<string, unknown>).reasoning_content = thinking
    }
  }
}

// ============================================================================
// Moonshot Adapter
// ============================================================================

/**
 * Moonshot (Kimi) adapter
 *
 * Requires `reasoning_content` in assistant messages for multi-turn reasoning.
 *
 * @see https://platform.moonshot.cn/docs
 */
const moonshotAdapter: ProviderAdapter = {
  id: 'moonshot',
  name: 'Moonshot',

  match(url: string): boolean {
    return url.includes('api.moonshot.cn') || url.includes('api.moonshot.ai')
  },

  transformRequest(body: Record<string, unknown>, context?: AdapterContext): void {
    injectReasoningContent(body, context)
  }
}

// ============================================================================
// Zhipu AI (GLM) Adapter
// ============================================================================

/**
 * Zhipu AI (GLM) adapter
 *
 * GLM thinking models (GLM-Z1, GLM-4.7-Think, GLM-5-Think) require
 * `reasoning_content` in assistant messages for multi-turn reasoning,
 * with the same semantics as Moonshot. Official docs explicitly state the
 * field must be preserved verbatim to maintain reasoning coherence.
 *
 * @see https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode
 */
const zhipuAdapter: ProviderAdapter = {
  id: 'zhipu',
  name: 'Zhipu AI (GLM)',

  match(url: string): boolean {
    return url.includes('open.bigmodel.cn')
  },

  transformRequest(body: Record<string, unknown>, context?: AdapterContext): void {
    injectReasoningContent(body, context)
  }
}

// ============================================================================
// Tencent Adapter
// ============================================================================

/**
 * Tencent Hunyuan / CodeBuddy API uses flat reasoning parameters
 *
 * Tencent's API expects:
 * - reasoning_effort: 'low' | 'medium' | 'high'
 * - reasoningEffort: 'low' | 'medium' | 'high'  (camelCase alias)
 * - reasoning_summary: 'auto'
 *
 * We handle two incoming formats:
 * - Chat Completions: top-level `reasoning_effort` string (already correct key)
 * - Responses API: nested `reasoning: { effort }` object
 *
 * Matched via adapterId from provider plugins.
 */
const tencentAdapter: ProviderAdapter = {
  id: 'tencent',
  name: 'Tencent',

  match(url: string): boolean {
    return url.includes('copilot.tencent.com')
  },

  transformRequest(body: Record<string, unknown>): void {
    // Chat Completions format: top-level reasoning_effort string
    if (typeof body.reasoning_effort === 'string') {
      const effort = body.reasoning_effort as string
      body.reasoningEffort = effort
      body.reasoning_summary = 'auto'
      console.log(`[TencentAdapter] reasoning_effort transform: effort=${effort}`)
      return
    }

    // Responses API format: nested reasoning.effort object
    const reasoning = body.reasoning as { effort?: string } | undefined
    if (reasoning?.effort) {
      const effort = reasoning.effort
      body.reasoning_effort = effort
      body.reasoningEffort = effort
      body.reasoning_summary = 'auto'
      delete body.reasoning
      console.log(`[TencentAdapter] reasoning object transform: effort=${effort}`)
    }
  }
}

// ============================================================================
// Registry
// ============================================================================

/**
 * All registered provider adapters
 * Order matters: first matching adapter wins
 */
const adapters: readonly ProviderAdapter[] = [
  groqAdapter,
  openRouterAdapter,
  deepSeekAdapter,
  moonshotAdapter,
  zhipuAdapter,
  tencentAdapter
]

/**
 * Find the adapter matching the given URL or adapterId
 *
 * Resolution order:
 * 1. Explicit adapterId (from BackendRequestConfig) — exact match on adapter.id
 * 2. URL pattern matching — adapter.match(url)
 */
export function findAdapter(url: string, adapterId?: string): ProviderAdapter | undefined {
  if (adapterId) {
    const byId = adapters.find(a => a.id === adapterId)
    if (byId) return byId
  }
  return adapters.find(adapter => adapter.match(url))
}

/**
 * Apply provider-specific transformations to request
 *
 * @param url - Target API URL
 * @param body - Request body (will be mutated if adapter has transformRequest)
 * @param headers - Request headers (adapter headers will be merged)
 * @param adapterId - Explicit adapter ID from provider config (takes priority over URL matching)
 * @param context - Original request context; gives adapters access to pre-conversion data
 * @returns The adapter that was applied, or undefined if none matched
 */
export function applyProviderAdapter(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  adapterId?: string,
  context?: AdapterContext
): ProviderAdapter | undefined {
  const adapter = findAdapter(url, adapterId)

  if (!adapter) {
    return undefined
  }

  // Apply request transformation
  if (adapter.transformRequest) {
    adapter.transformRequest(body, context)
  }

  // Merge extra headers (adapter headers take precedence)
  const extraHeaders = adapter.getExtraHeaders?.()
  if (extraHeaders) {
    Object.assign(headers, extraHeaders)
  }

  return adapter
}

// ============================================================================
// Exports
// ============================================================================

export { groqAdapter, openRouterAdapter, deepSeekAdapter, moonshotAdapter, zhipuAdapter, tencentAdapter }
