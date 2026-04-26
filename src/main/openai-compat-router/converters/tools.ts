/**
 * Tool Definition Converters
 *
 * Handles conversion of tool definitions between:
 * - Anthropic: { name, description, input_schema }
 * - OpenAI Chat: { type: "function", function: { name, description, parameters } }
 * - OpenAI Responses: { type: "function", name, description, parameters }
 */

import type {
  AnthropicTool,
  AnthropicToolChoice,
  OpenAIChatTool,
  OpenAIChatToolChoice,
  OpenAIResponsesFunctionTool,
  OpenAIResponsesToolChoice
} from '../types'

// ============================================================================
// Tool Definition Conversion
// ============================================================================

/**
 * Convert Anthropic tool to OpenAI Chat tool
 */
export function anthropicToolToOpenAIChatTool(tool: AnthropicTool): OpenAIChatTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: {
        type: 'object',
        properties: tool.input_schema?.properties || {},
        required: tool.input_schema?.required
      },
      strict: tool.strict
    }
  }
}

/**
 * Convert Anthropic tool to OpenAI Responses tool
 * Uses the flat format (top-level name, description, parameters)
 */
export function anthropicToolToResponsesTool(tool: AnthropicTool): OpenAIResponsesFunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description || '',
    parameters: {
      type: 'object',
      properties: tool.input_schema?.properties || {},
      required: tool.input_schema?.required
    },
    strict: tool.strict
  }
}

/**
 * Convert array of Anthropic tools to OpenAI Chat tools
 * Filters out invalid tools, keeps valid ones
 */
export function convertAnthropicToolsToOpenAIChat(
  tools: AnthropicTool[] | undefined
): OpenAIChatTool[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined
  }

  // Filter and convert - skip invalid tools instead of rejecting all
  return tools
    .filter((tool) => tool && tool.name)
    .map(anthropicToolToOpenAIChatTool)
}

/**
 * Convert array of Anthropic tools to OpenAI Responses tools
 */
export function convertAnthropicToolsToResponses(
  tools: AnthropicTool[] | undefined
): OpenAIResponsesFunctionTool[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) {
    return undefined
  }

  return tools
    .filter((tool) => tool && typeof tool.name === 'string' && tool.name.trim() !== '')
    .map(anthropicToolToResponsesTool)
}

// ============================================================================
// Tool Choice Conversion
// ============================================================================

/**
 * Convert Anthropic tool_choice to OpenAI Chat tool_choice
 */
export function convertAnthropicToolChoiceToOpenAIChat(
  toolChoice: AnthropicToolChoice | undefined
): OpenAIChatToolChoice | undefined {
  if (!toolChoice) return undefined

  switch (toolChoice.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'none':
      return 'none'
    case 'tool':
      if ('name' in toolChoice && toolChoice.name) {
        return {
          type: 'function',
          function: { name: toolChoice.name }
        }
      }
      return 'auto'
    default:
      return 'auto'
  }
}

/**
 * Convert Anthropic tool_choice to OpenAI Responses tool_choice
 */
export function convertAnthropicToolChoiceToResponses(
  toolChoice: AnthropicToolChoice | undefined
): OpenAIResponsesToolChoice | undefined {
  if (!toolChoice) return undefined

  switch (toolChoice.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'none':
      return 'none'
    case 'tool':
      if ('name' in toolChoice && toolChoice.name) {
        return {
          type: 'function',
          name: toolChoice.name
        }
      }
      return 'auto'
    default:
      return 'auto'
  }
}

// ============================================================================
// Reasoning/Thinking Conversion
// ============================================================================

/**
 * Map Anthropic thinking budget_tokens to OpenAI reasoning effort
 */
export function budgetTokensToReasoningEffort(budgetTokens: number | undefined): 'low' | 'medium' | 'high' {
  if (!budgetTokens) return 'medium'
  if (budgetTokens > 10000) return 'high'
  if (budgetTokens > 5000) return 'medium'
  return 'low'
}

/**
 * Convert Anthropic thinking config to OpenAI Chat Completions reasoning_effort
 *
 * Chat Completions API uses a top-level `reasoning_effort` string field,
 * NOT a nested `reasoning` object. Returns undefined when thinking is
 * disabled or absent so the field is omitted from the request entirely.
 *
 * @see https://platform.openai.com/docs/api-reference/chat/create#reasoning_effort
 */
export function convertAnthropicThinkingToChatReasoningEffort(
  thinking: { type: string; budget_tokens?: number } | undefined
): 'low' | 'medium' | 'high' | undefined {
  if (!thinking || thinking.type === 'disabled') return undefined
  // 'adaptive' — Anthropic's unbounded thinking (Claude 4+); map to 'medium'
  if (thinking.type === 'adaptive') return 'medium'
  // 'enabled' — fixed budget thinking
  if (thinking.type === 'enabled') return budgetTokensToReasoningEffort(thinking.budget_tokens)
  return undefined
}

/**
 * Convert Anthropic thinking config to OpenAI Responses API reasoning config
 *
 * Responses API uses a nested `reasoning: { effort }` object.
 * The `enabled` field is NOT part of the OpenAI spec and must not be sent.
 * Returns undefined when thinking is disabled or absent.
 *
 * @see https://platform.openai.com/docs/api-reference/responses/create#reasoning
 */
export function convertAnthropicThinkingToResponsesReasoning(
  thinking: { type: string; budget_tokens?: number } | undefined
): { effort: 'low' | 'medium' | 'high' } | undefined {
  if (!thinking || thinking.type === 'disabled') return undefined
  if (thinking.type === 'adaptive') return { effort: 'medium' }
  if (thinking.type === 'enabled') return { effort: budgetTokensToReasoningEffort(thinking.budget_tokens) }
  return undefined
}
