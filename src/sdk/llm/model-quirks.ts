/**
 * @module llm/model-quirks
 * Domestic / non-standard model adaptations.
 * Fixes common issues with Qwen, DeepSeek, and other models that deviate
 * from the Anthropic/OpenAI wire format.
 *
 * See ARCHITECTURE.md section "八、国产模型 Quirks 适配清单" for the full list.
 * @license MIT
 */

import type {
  ContentBlock,
  ProviderResponse,
  StreamEvent,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
} from '../types/provider.js';

// ---------------------------------------------------------------------------
// Model detection
// ---------------------------------------------------------------------------

/** Known model prefixes that require quirks processing. */
const QUIRKY_PREFIXES = ['qwen', 'deepseek'];

/** Returns `true` if the model is known to need quirks processing. */
export function isQuirkyModel(model: string): boolean {
  const lower = model.toLowerCase();
  return QUIRKY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Response-level quirks
// ---------------------------------------------------------------------------

/**
 * Apply all applicable model-specific fixes to a complete `ProviderResponse`.
 *
 * Quirks applied:
 * 1. Qwen: extract `<think>...</think>` tags from text into ThinkingBlocks
 * 2. DeepSeek: repair malformed tool_call JSON arguments
 * 3. Generic: auto-generate missing tool_call_id
 * 4. Generic: inject empty TextBlock when content is empty but tool_calls exist
 * 5. Generic: fix stopReason 'end_turn' when pending tool_use blocks exist
 */
export function applyModelQuirks(
  model: string,
  response: ProviderResponse,
): ProviderResponse {
  const lower = model.toLowerCase();
  let content = [...response.content];
  let { stopReason } = response;

  // 1. Qwen: <think>...</think> extraction
  if (lower.startsWith('qwen')) {
    content = extractQwenThinking(content);
  }

  // 2. DeepSeek: repair tool_call arguments
  if (lower.startsWith('deepseek')) {
    content = repairToolCallArguments(content);
  }

  // 3. Generic: auto-generate missing tool_call_id
  content = fillMissingToolIds(content);

  // 4. Generic: empty content + tool_calls → inject empty TextBlock
  content = ensureNonEmptyContent(content);

  // 5. Generic: fix stopReason when tool_use blocks are present
  const hasToolUse = content.some((b) => b.type === 'tool_use');
  if (hasToolUse && stopReason === 'end_turn') {
    stopReason = 'tool_use';
  }

  return {
    ...response,
    content,
    stopReason,
  };
}

// ---------------------------------------------------------------------------
// Stream-level quirks — stateful ThinkTagParser
// ---------------------------------------------------------------------------

/**
 * Stateful parser that splits a stream of text_delta chunks into
 * `text_delta` and `reasoning_delta` events, correctly handling
 * `<think>...</think>` tags that span multiple SSE chunks.
 *
 * Create one instance per streaming request for models that use XML-style
 * thinking tags (e.g. Qwen). Feed each incoming text chunk via `process()`;
 * it returns 0..N StreamEvents to yield in place of the original text_delta.
 *
 * Algorithm (mirrors the reference implementation in openai-chat-stream.ts):
 *
 *   While there is remaining text:
 *     - If inside a <think> block:
 *         - Search for `</think>`.  If found, emit reasoning_delta up to it,
 *           clear the flag, advance past the closing tag.
 *         - If not found, emit all remaining text as reasoning_delta.
 *     - If not inside a <think> block:
 *         - Search for `<think>`.  If found, emit text before it as text_delta,
 *           set the flag, advance past the opening tag.
 *         - If not found, emit all remaining text as text_delta.
 */
export class ThinkTagParser {
  private inThinkTag = false;

  /**
   * Process one text chunk.
   * @param text   Raw text from a text_delta SSE event.
   * @param index  Content-block index (typically 0).
   * @returns      Array of StreamEvents to yield instead of the original delta.
   */
  process(text: string, index: number): StreamEvent[] {
    const events: StreamEvent[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (this.inThinkTag) {
        const closeIdx = remaining.indexOf('</think>');
        if (closeIdx !== -1) {
          const thinkContent = remaining.slice(0, closeIdx);
          if (thinkContent) {
            events.push({ type: 'reasoning_delta', index, reasoning: thinkContent });
          }
          this.inThinkTag = false;
          // Skip the closing tag and any immediately following newlines
          remaining = remaining.slice(closeIdx + 8).replace(/^[\n\r]+/, '');
        } else {
          // Closing tag not yet received — emit everything as reasoning
          events.push({ type: 'reasoning_delta', index, reasoning: remaining });
          remaining = '';
        }
      } else {
        const openIdx = remaining.indexOf('<think>');
        if (openIdx !== -1) {
          // Text before the opening tag is regular output
          const textBefore = remaining.slice(0, openIdx);
          if (textBefore) {
            events.push({ type: 'text_delta', index, text: textBefore });
          }
          this.inThinkTag = true;
          remaining = remaining.slice(openIdx + 7);
        } else {
          // No opening tag — all regular text
          events.push({ type: 'text_delta', index, text: remaining });
          remaining = '';
        }
      }
    }

    return events;
  }

  /** Whether the parser is currently inside a `<think>` block. */
  get isInsideThinkTag(): boolean {
    return this.inThinkTag;
  }
}

/**
 * Apply model-specific fixes to a single `StreamEvent`.
 *
 * Note: For `text_delta` events on Qwen models, use `ThinkTagParser.process()`
 * instead — it handles `<think>` tags that span multiple SSE chunks correctly.
 * This function only handles events other than `text_delta`.
 */
export function applyStreamQuirks(
  _model: string,
  event: StreamEvent,
): StreamEvent {
  // No stateless fixes needed currently — kept for API compatibility.
  return event;
}

/** Returns true if the model is a Qwen model that uses `<think>` XML tags. */
export function isQwenThinkModel(model: string): boolean {
  return model.toLowerCase().startsWith('qwen');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract `<think>...</think>` blocks from TextBlocks and convert them to
 * ThinkingBlocks. The thinking text is removed from the original TextBlock.
 */
function extractQwenThinking(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;

  for (const block of blocks) {
    if (block.type !== 'text') {
      result.push(block);
      continue;
    }

    const textBlock = block as TextBlock;
    let match: RegExpExecArray | null;
    const thinkingParts: string[] = [];

    // Collect all <think> content
    while ((match = thinkRegex.exec(textBlock.text)) !== null) {
      thinkingParts.push(match[1].trim());
    }

    if (thinkingParts.length > 0) {
      // Emit ThinkingBlock(s) before the cleaned text
      for (const thinking of thinkingParts) {
        if (thinking) {
          result.push({
            type: 'thinking',
            thinking,
          } as ThinkingBlock);
        }
      }

      // Remove <think> tags from the text
      const cleanedText = textBlock.text.replace(thinkRegex, '').trim();
      if (cleanedText) {
        result.push({ type: 'text', text: cleanedText } as TextBlock);
      }
    } else {
      result.push(block);
    }
  }

  return result;
}

/**
 * Attempt to repair malformed tool_call JSON arguments.
 * DeepSeek sometimes emits arguments that are not valid JSON.
 * Strategy: try JSON.parse first, then fall back to regex key-value extraction.
 */
function repairToolCallArguments(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type !== 'tool_use') {
      return block;
    }

    const toolBlock = block as ToolUseBlock;

    // If input is already a valid object, nothing to repair
    if (
      toolBlock.input &&
      typeof toolBlock.input === 'object' &&
      Object.keys(toolBlock.input).length > 0
    ) {
      return block;
    }

    // If input was serialized as a string somewhere in the pipeline, try to parse
    const inputStr =
      typeof toolBlock.input === 'string'
        ? (toolBlock.input as unknown as string)
        : JSON.stringify(toolBlock.input);

    try {
      const parsed = JSON.parse(inputStr);
      if (typeof parsed === 'object' && parsed !== null) {
        return { ...toolBlock, input: parsed };
      }
    } catch {
      // Fall back to regex extraction of key-value pairs
      const extracted = extractKeyValues(inputStr);
      if (Object.keys(extracted).length > 0) {
        return { ...toolBlock, input: extracted };
      }
    }

    return block;
  });
}

/**
 * Best-effort key-value extraction from malformed JSON-like strings.
 * Handles patterns like: `key: "value"`, `"key": value`, `key = value`
 */
function extractKeyValues(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Match "key": "value" or "key": value patterns
  const kvRegex = /"?(\w+)"?\s*[:=]\s*"([^"]*?)"/g;
  let match: RegExpExecArray | null;

  while ((match = kvRegex.exec(text)) !== null) {
    result[match[1]] = match[2];
  }

  // Also try to extract numeric/boolean values: "key": 123 or "key": true
  const numBoolRegex = /"?(\w+)"?\s*[:=]\s*(true|false|\d+(?:\.\d+)?)\b/g;
  while ((match = numBoolRegex.exec(text)) !== null) {
    if (!(match[1] in result)) {
      const val = match[2];
      if (val === 'true') result[match[1]] = true;
      else if (val === 'false') result[match[1]] = false;
      else result[match[1]] = Number(val);
    }
  }

  return result;
}

/** Auto-generate `toolu_`-prefixed IDs for ToolUseBlocks that lack an id. */
function fillMissingToolIds(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type !== 'tool_use') return block;
    const toolBlock = block as ToolUseBlock;
    if (!toolBlock.id || toolBlock.id === '') {
      return {
        ...toolBlock,
        id: `toolu_${generateSimpleId()}`,
      };
    }
    return block;
  });
}

/**
 * Ensure the content array is not empty when tool_use blocks are present.
 * Some models return an empty content array alongside tool_calls in the
 * response. We inject an empty TextBlock to keep the message structure valid.
 */
function ensureNonEmptyContent(blocks: ContentBlock[]): ContentBlock[] {
  const hasToolUse = blocks.some((b) => b.type === 'tool_use');
  const hasText = blocks.some((b) => b.type === 'text');

  if (hasToolUse && !hasText) {
    return [{ type: 'text', text: '' } as TextBlock, ...blocks];
  }

  return blocks;
}

/** Generate a simple pseudo-random ID string (no crypto dependency). */
function generateSimpleId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const timestamp = Date.now().toString(36);
  let random = '';
  for (let i = 0; i < 12; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${timestamp}${random}`;
}
