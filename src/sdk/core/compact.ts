/**
 * @module core/compact
 * Three-tier context compaction: micro, api, and full.
 * @license MIT
 */

import type { Message, ContentBlock, ToolResultBlock, LlmProvider } from '../types/provider.js';
import { estimateMessageTokens, ApiTokenAnchor } from '../utils/tokens.js';
import {
  AUTO_COMPACT_THRESHOLD,
  MAX_INPUT_TOKENS,
  TARGET_INPUT_TOKENS,
  KEEP_RECENT_MESSAGES,
  MAX_CONSECUTIVE_COMPACT_FAILURES,
  contextWindowForModel,
} from '../prompt/constants.js';

// ---------------------------------------------------------------------------
// AutoCompactState — tracks compaction across turns
// ---------------------------------------------------------------------------

/** Tracks auto-compact state across turns. */
export class AutoCompactState {
  /** Total compactions performed this session. */
  compactionCount = 0;
  /** Consecutive failures (reset on success). */
  consecutiveFailures = 0;
  /** Whether the circuit breaker is open (too many failures). */
  disabled = false;

  /** Record a successful compaction. */
  onSuccess(): void {
    this.compactionCount++;
    this.consecutiveFailures = 0;
  }

  /** Record a failed compaction; open circuit breaker if too many. */
  onFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_COMPACT_FAILURES) {
      this.disabled = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Token warning state
// ---------------------------------------------------------------------------

/** Token-usage state relative to the context window. */
export type TokenWarningState = 'ok' | 'warning' | 'critical';

const WARNING_PCT = 0.80;
const CRITICAL_PCT = 0.95;

/** Calculate token warning state given current input tokens and model. */
export function calculateTokenWarningState(
  inputTokens: number,
  model: string,
): TokenWarningState {
  const window = contextWindowForModel(model);
  const pct = inputTokens / window;
  if (pct >= CRITICAL_PCT) return 'critical';
  if (pct >= WARNING_PCT) return 'warning';
  return 'ok';
}

// ---------------------------------------------------------------------------
// shouldAutoCompact
// ---------------------------------------------------------------------------

/** Return true when auto-compaction should fire. */
export function shouldAutoCompact(
  inputTokens: number,
  model: string,
  state: AutoCompactState,
): boolean {
  if (state.disabled) return false;
  const window = contextWindowForModel(model);
  const threshold = Math.floor(window * AUTO_COMPACT_THRESHOLD);
  return inputTokens >= threshold;
}

// ---------------------------------------------------------------------------
// Micro compact — replace old tool results with placeholders
// ---------------------------------------------------------------------------

/** Placeholder text for truncated tool results. */
const TOOL_RESULT_TRUNCATED = '[tool result truncated to save context]';

/**
 * Estimate the character size of a ToolResultBlock's content.
 * Handles both string content and array-typed content (ContentBlock[]).
 */
function toolResultContentSize(content: ToolResultBlock['content']): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let size = 0;
  for (const block of content) {
    if (block.type === 'text') {
      size += block.text.length;
    } else if (block.type === 'tool_result') {
      // Nested tool_result — recurse
      size += toolResultContentSize((block as ToolResultBlock).content);
    } else if (block.type === 'image' || block.type === 'document') {
      // base64 data blocks — count the data field
      const src = (block as { source: { data: string } }).source;
      size += src?.data?.length ?? 0;
    }
  }
  return size;
}

/**
 * Micro-compact: when cumulative tool-result content exceeds `budget`
 * characters, walk from oldest to newest and replace individual
 * tool_result content with a placeholder until under budget.
 *
 * Handles both string and array-typed tool_result content.
 */
export function microCompact(
  messages: Message[],
  budget: number,
): { messages: Message[]; truncatedCount: number } {
  const total = totalToolResultChars(messages);
  if (total <= budget) {
    return { messages, truncatedCount: 0 };
  }

  let toShed = total - budget;
  let truncatedCount = 0;

  const result = messages.map((msg) => {
    if (msg.role !== 'user' || typeof msg.content === 'string' || toShed <= 0) {
      return msg;
    }
    const newContent = (msg.content as ContentBlock[]).map((block) => {
      if (toShed <= 0) return block;
      if (block.type !== 'tool_result') return block;
      const trBlock = block as ToolResultBlock;
      const size = toolResultContentSize(trBlock.content);
      if (size === 0) return block;

      truncatedCount++;
      toShed = Math.max(0, toShed - size);
      return {
        ...trBlock,
        content: TOOL_RESULT_TRUNCATED,
      } as ToolResultBlock;
    });
    return { ...msg, content: newContent };
  });

  return { messages: result, truncatedCount };
}

/** Total character count of all tool-result content blocks. */
function totalToolResultChars(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.role !== 'user' || typeof msg.content === 'string') continue;
    for (const block of msg.content as ContentBlock[]) {
      if (block.type === 'tool_result') {
        total += toolResultContentSize((block as ToolResultBlock).content);
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// API compact — strip old messages when over MAX_INPUT_TOKENS
// ---------------------------------------------------------------------------

/**
 * API-level compact: when estimated input tokens exceed MAX_INPUT_TOKENS,
 * strip the oldest messages (keeping KEEP_RECENT_MESSAGES) to bring
 * the total under TARGET_INPUT_TOKENS.
 *
 * This is a local operation — no LLM call needed.
 *
 * IMPORTANT: This function ensures tool_use/tool_result pairs are not
 * split apart. If the split point would land between an assistant message
 * containing tool_use blocks and the following user message containing
 * the corresponding tool_result blocks, the split point is adjusted to
 * keep both messages.
 */
export function apiCompact(
  messages: Message[],
  anchor?: ApiTokenAnchor,
): Message[] | null {
  const totalTokens = anchor
    ? anchor.estimateWithAnchor(messages)
    : estimateMessageTokens(messages);
  if (totalTokens < MAX_INPUT_TOKENS) {
    return null;
  }

  if (messages.length <= KEEP_RECENT_MESSAGES + 1) {
    return null;
  }

  // Find the split point: walk from the end, keeping messages until
  // we exceed TARGET_INPUT_TOKENS remaining budget.
  let accumulated = 0;
  let keepFrom = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const est = estimateMessageTokens([messages[i]]);
    if (accumulated + est > TARGET_INPUT_TOKENS) {
      keepFrom = i + 1;
      break;
    }
    accumulated += est;
    keepFrom = i;
  }

  // Always keep at least KEEP_RECENT_MESSAGES
  keepFrom = Math.min(keepFrom, messages.length - KEEP_RECENT_MESSAGES);
  if (keepFrom <= 0) return null;

  // Ensure we don't split tool_use/tool_result pairs.
  // If the first kept message is a user message containing tool_result blocks,
  // its corresponding tool_use must be in the preceding assistant message.
  // Move keepFrom back to include that assistant message.
  keepFrom = adjustForToolPairing(messages, keepFrom);

  if (keepFrom <= 0) return null;

  return messages.slice(keepFrom);
}

/**
 * Adjust the split point to avoid breaking tool_use/tool_result pairs.
 *
 * A tool_result user message MUST be preceded by the assistant message
 * that contained the corresponding tool_use blocks. If our split would
 * start on such a user message, we step backwards to include the assistant.
 *
 * Similarly, if we would start right after an assistant message that has
 * tool_use blocks (i.e., the next message is a tool_result user message),
 * we step forward to also include the tool_result user message — but
 * that situation means keepFrom is already correct (the assistant message
 * with tool_use is included, and the following user message is also included).
 * The real danger is: keepFrom lands on a user message with tool_result blocks.
 */
function adjustForToolPairing(messages: Message[], keepFrom: number): number {
  if (keepFrom <= 0 || keepFrom >= messages.length) return keepFrom;

  const firstKept = messages[keepFrom];

  // If the first kept message is a user message, check for tool_result blocks
  if (firstKept.role === 'user' && hasToolResultBlocks(firstKept)) {
    // Need to also keep the preceding assistant message (which has tool_use)
    if (keepFrom > 0 && messages[keepFrom - 1].role === 'assistant') {
      return keepFrom - 1;
    }
  }

  return keepFrom;
}

/** Check if a message contains tool_result content blocks. */
function hasToolResultBlocks(msg: Message): boolean {
  if (typeof msg.content === 'string') return false;
  return (msg.content as ContentBlock[]).some((b) => b.type === 'tool_result');
}

// ---------------------------------------------------------------------------
// Full compact — LLM-based summarisation
// ---------------------------------------------------------------------------

/** The compaction prompt that prevents the summariser from making tool calls. */
const NO_TOOLS_PREAMBLE =
  'CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.\n\n' +
  '- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.\n' +
  '- You already have all the context you need in the conversation above.\n' +
  '- Tool calls will be REJECTED and will waste your only turn — you will fail the task.\n' +
  '- Your entire response must be plain text: an <analysis> block followed by a <summary> block.\n\n';

const BASE_COMPACT_PROMPT =
  'Your task is to create a detailed summary of the conversation so far, paying close attention to the user\'s explicit requests and your previous actions.\n' +
  'This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.\n\n' +
  'Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you\'ve covered all necessary points. In your analysis process:\n\n' +
  '1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:\n' +
  '   - The user\'s explicit requests and intents\n' +
  '   - Your approach to addressing the user\'s requests\n' +
  '   - Key decisions, technical concepts and code patterns\n' +
  '   - Specific details like: file names, full code snippets, function signatures, file edits\n' +
  '   - Errors that you ran into and how you fixed them\n' +
  '   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.\n' +
  '2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.\n\n' +
  'Your summary should include the following sections:\n\n' +
  '1. Primary Request and Intent: Capture all of the user\'s explicit requests and intents in detail\n' +
  '2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.\n' +
  '3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created.\n' +
  '4. Errors and fixes: List all errors that you ran into, and how you fixed them.\n' +
  '5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.\n' +
  '6. All user messages: List ALL user messages that are not tool results.\n' +
  '7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.\n' +
  '8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request.\n' +
  '9. Optional Next Step: List the next step that you will take that is related to the most recent work.\n\n' +
  'Format your output as:\n\n' +
  '<analysis>\n[Your thought process]\n</analysis>\n\n' +
  '<summary>\n[Structured summary following the 9 sections above]\n</summary>\n\n' +
  'Please provide your summary based on the conversation so far.';

const NO_TOOLS_TRAILER =
  '\n\nREMINDER: Do NOT call any tools. Respond with plain text only — ' +
  'an <analysis> block followed by a <summary> block. ' +
  'Tool calls will be rejected and you will fail the task.';

/** Build the compaction prompt. */
export function getCompactPrompt(customInstructions?: string): string {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT;
  if (customInstructions?.trim()) {
    prompt += `\n\nAdditional Instructions:\n${customInstructions.trim()}`;
  }
  prompt += NO_TOOLS_TRAILER;
  return prompt;
}

/**
 * Format the raw compact summary by stripping <analysis> and cleaning up
 * <summary> XML tags.
 */
export function formatCompactSummary(raw: string): string {
  // Strip <analysis>...</analysis> block
  let text = raw;
  const analysisStart = text.indexOf('<analysis>');
  const analysisEnd = text.indexOf('</analysis>');
  if (analysisStart !== -1 && analysisEnd !== -1) {
    text = text.slice(0, analysisStart) + text.slice(analysisEnd + '</analysis>'.length);
  }

  // Extract and reformat <summary>...</summary>
  const summaryStart = text.indexOf('<summary>');
  const summaryEnd = text.indexOf('</summary>');
  if (summaryStart !== -1 && summaryEnd !== -1) {
    const before = text.slice(0, summaryStart);
    const content = text.slice(summaryStart + '<summary>'.length, summaryEnd).trim();
    const after = text.slice(summaryEnd + '</summary>'.length);
    text = `${before}Summary:\n${content}${after}`;
  }

  // Collapse multiple blank lines
  return text
    .split('\n')
    .reduce<string[]>((lines, line) => {
      if (line.trim() === '') {
        if (lines.length === 0 || lines[lines.length - 1].trim() !== '') {
          lines.push(line);
        }
      } else {
        lines.push(line);
      }
      return lines;
    }, [])
    .join('\n')
    .trim();
}

/**
 * Build a transcript of messages for the compact summariser.
 */
function buildTranscript(messages: Message[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const roleLabel = msg.role === 'user' ? 'Human' : 'Assistant';
    if (typeof msg.content === 'string') {
      if (msg.content) {
        parts.push(`${roleLabel}: ${msg.content}`);
      }
    } else {
      for (const block of msg.content) {
        switch (block.type) {
          case 'text':
            parts.push(`${roleLabel}: ${block.text}`);
            break;
          case 'tool_use':
            parts.push(`[Tool Call: ${block.name} (id=${block.id})]\nInput: ${JSON.stringify(block.input)}`);
            break;
          case 'tool_result': {
            const trBlock = block as ToolResultBlock;
            let content: string;
            if (typeof trBlock.content === 'string') {
              content = trBlock.content;
            } else if (Array.isArray(trBlock.content)) {
              // Extract text from array-typed content blocks
              content = trBlock.content
                .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                .map((b) => b.text)
                .join('\n') || '[complex content]';
            } else {
              content = '[complex content]';
            }
            const errorFlag = trBlock.is_error ? ' [ERROR]' : '';
            parts.push(`[Tool Result (id=${trBlock.tool_use_id})${errorFlag}]\n${content}`);
            break;
          }
          case 'thinking':
            break;
          default:
            break;
        }
      }
    }
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Full compact result
// ---------------------------------------------------------------------------

export interface CompactResult {
  /** The new (reduced) message list. */
  messages: Message[];
  /** Formatted summary text. */
  summary: string;
  /** Rough estimate of how many tokens were freed. */
  tokensFreed: number;
}

/**
 * Full compact: summarise the head of the conversation using the LLM,
 * keep the most recent KEEP_RECENT_MESSAGES verbatim.
 *
 * This is the heaviest compaction tier — it makes an API call.
 */
export async function fullCompact(
  messages: Message[],
  provider: LlmProvider,
  model: string,
  _systemPrompt: string,
): Promise<CompactResult> {
  const total = messages.length;

  if (total <= KEEP_RECENT_MESSAGES + 1) {
    return { messages: [...messages], summary: '', tokensFreed: 0 };
  }

  const splitAt = total - KEEP_RECENT_MESSAGES;
  const head = messages.slice(0, splitAt);
  const tail = messages.slice(splitAt);

  const originalTokenEstimate = estimateMessageTokens(head);
  const transcript = buildTranscript(head);
  const compactPrompt = getCompactPrompt();

  const userContent =
    `${compactPrompt}\n\n` +
    `<conversation_to_summarize original_messages="${head.length}" estimated_tokens="${originalTokenEstimate}">\n` +
    `${transcript}\n` +
    `</conversation_to_summarize>`;

  // Make a non-streaming summary call
  const response = await provider.createMessage({
    model,
    messages: [{ role: 'user', content: userContent }],
    systemPrompt: 'You are a helpful assistant that creates concise yet thorough conversation summaries. ' +
      'Preserve all technical details, file names, code snippets, and decisions that would be important for ' +
      'continuing the work. Follow the structured format exactly.',
    tools: [],
    maxTokens: 20_000,
    stream: false,
  });

  // Extract text from response
  let rawSummary = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      rawSummary += block.text;
    }
  }

  if (!rawSummary) {
    throw new Error('Compact summary was empty');
  }

  const formattedSummary = formatCompactSummary(rawSummary);

  const compactNotice: Message = {
    role: 'user',
    content:
      `This session is being continued from a previous conversation that ran out of context. ` +
      `The summary below covers the earlier portion of the conversation (originally ${head.length} messages, ` +
      `~${originalTokenEstimate} tokens).\n\n${formattedSummary}`,
  };

  const newMessages = [compactNotice, ...tail];
  const newTokenEstimate = estimateMessageTokens(newMessages);
  const tokensFreed = Math.max(0, originalTokenEstimate - newTokenEstimate);

  return { messages: newMessages, summary: formattedSummary, tokensFreed };
}

/**
 * Auto-compact if needed: checks thresholds and runs full compact.
 * Returns null if no compaction was needed/possible.
 */
export async function autoCompactIfNeeded(
  messages: Message[],
  inputTokens: number,
  model: string,
  provider: LlmProvider,
  systemPrompt: string,
  state: AutoCompactState,
): Promise<CompactResult | null> {
  if (!shouldAutoCompact(inputTokens, model, state)) {
    return null;
  }

  try {
    const result = await fullCompact(messages, provider, model, systemPrompt);
    state.onSuccess();
    return result;
  } catch {
    state.onFailure();
    return null;
  }
}
