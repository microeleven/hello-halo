/**
 * @module llm/openai-compat
 * OpenAI Chat Completions compatible provider implementation.
 * Supports any provider exposing an OpenAI-compatible API (OpenAI, DeepSeek,
 * Groq, Ollama, Qwen/DashScope, OpenRouter, etc.).
 * @license MIT
 */

import type {
  ContentBlock,
  LlmProvider,
  Message,
  ProviderCapabilities,
  ProviderModelInfo,
  ProviderRequest,
  ProviderResponse,
  ProviderStatus,
  StopReason,
  StreamEvent,
  SystemPrompt,
  SystemPromptBlock,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
  UsageInfo,
} from '../types/provider.js';
import { parseSSEStream } from './stream-parser.js';
import { applyModelQuirks, applyStreamQuirks, isQuirkyModel, isQwenThinkModel, ThinkTagParser } from './model-quirks.js';
import {
  DEFAULT_RETRY,
  delayForAttempt,
  isRetryableStatus,
  parseRetryAfterMs,
  sleep,
} from '../utils/retry.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface OpenAiCompatProviderConfig {
  /** Unique provider identifier (e.g. "openai", "deepseek", "groq") */
  id: string;
  /** Human-readable provider name */
  name: string;
  /** Base URL including path prefix (e.g. "https://api.groq.com/openai/v1") */
  baseUrl: string;
  /** API key (sent as Authorization: Bearer) */
  apiKey?: string;
  /** Additional headers to send on every request */
  headers?: Record<string, string>;
  /** Default model to use when none is specified */
  defaultModel?: string;
  /** Provider-specific behavioural quirks */
  quirks?: ProviderQuirks;
}

/** Provider-specific behavioural quirks. */
export interface ProviderQuirks {
  /** Truncate tool call IDs to at most this many characters. */
  toolIdMaxLen?: number;
  /** Strip all non-alphanumeric characters from tool IDs. */
  toolIdAlphanumericOnly?: boolean;
  /** Send `stream_options.include_usage` when streaming. */
  includeUsageInStream?: boolean;
  /** Override default temperature when request doesn't specify one. */
  defaultTemperature?: number;
  /** Insert assistant "Done." between tool→user message transitions. */
  fixToolUserSequence?: boolean;
  /** Name of the JSON field carrying extended reasoning text (e.g. "reasoning_content"). */
  reasoningField?: string;
}

// ---------------------------------------------------------------------------
// OpenAiCompatProvider
// ---------------------------------------------------------------------------

export class OpenAiCompatProvider implements LlmProvider {
  readonly id: string;
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly extraHeaders: Record<string, string>;
  private readonly defaultModel: string;
  private readonly quirks: ProviderQuirks;

  constructor(config: OpenAiCompatProviderConfig) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.extraHeaders = config.headers ?? {};
    this.defaultModel = config.defaultModel ?? 'gpt-4o';
    this.quirks = config.quirks ?? {};
  }

  // -----------------------------------------------------------------------
  // LlmProvider interface
  // -----------------------------------------------------------------------

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolCalling: true,
      thinking: !!this.quirks.reasoningField,
      imageInput: true,
      pdfInput: false,
      audioInput: false,
      videoInput: false,
      caching: false,
      structuredOutput: true,
      systemPromptStyle: 'system_message',
    };
  }

  async createMessage(request: ProviderRequest): Promise<ProviderResponse> {
    const body = this.buildRequestBody(request, false);
    const url = `${this.baseUrl}/chat/completions`;
    const headers = this.buildHeaders();

    // Retry loop
    const abortSignal = request.providerOptions?.signal as AbortSignal | undefined;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= DEFAULT_RETRY.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = delayForAttempt(DEFAULT_RETRY, attempt - 1);
        await sleep(delay, abortSignal);
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: abortSignal,
        });
      } catch (err) {
        // Re-throw abort errors immediately — don't retry on abort
        if (err instanceof Error && err.name === 'AbortError') throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }

      if (!response.ok) {
        const status = response.status;
        const errorBody = await response.text().catch(() => '');
        if (isRetryableStatus(status) && attempt < DEFAULT_RETRY.maxRetries) {
          const retryAfterMs = parseRetryAfterMs(response.headers);
          if (retryAfterMs !== undefined) {
            await sleep(retryAfterMs, abortSignal);
          }
          lastError = new Error(`HTTP ${status}: ${errorBody}`);
          continue;
        }
        throw this.createHttpError(status, errorBody);
      }

      const json = await response.json();
      let result = this.parseNonStreamingResponse(json as Record<string, unknown>, request.model);

      // Apply model quirks
      if (isQuirkyModel(request.model)) {
        result = applyModelQuirks(request.model, result);
      }

      return result;
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  async *createMessageStream(
    request: ProviderRequest,
  ): AsyncGenerator<StreamEvent, void, undefined> {
    const body = this.buildRequestBody(request, true);
    const url = `${this.baseUrl}/chat/completions`;
    const headers = this.buildHeaders();

    // Retry loop for connection
    const abortSignal = request.providerOptions?.signal as AbortSignal | undefined;
    let response: Response | undefined;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= DEFAULT_RETRY.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = delayForAttempt(DEFAULT_RETRY, attempt - 1);
        await sleep(delay, abortSignal);
      }

      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { ...headers, Accept: 'text/event-stream' },
          body: JSON.stringify(body),
          signal: abortSignal,
        });
      } catch (err) {
        // Re-throw abort errors immediately — don't retry on abort
        if (err instanceof Error && err.name === 'AbortError') throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }

      if (!response.ok) {
        const status = response.status;
        const errorBody = await response.text().catch(() => '');
        if (isRetryableStatus(status) && attempt < DEFAULT_RETRY.maxRetries) {
          const retryAfterMs = parseRetryAfterMs(response.headers);
          if (retryAfterMs !== undefined) {
            await sleep(retryAfterMs, abortSignal);
          }
          lastError = new Error(`HTTP ${status}: ${errorBody}`);
          continue;
        }
        throw this.createHttpError(status, errorBody);
      }

      break;
    }

    if (!response) throw lastError ?? new Error('Max retries exceeded');

    // Parse SSE stream
    const signal = request.providerOptions?.signal as AbortSignal | undefined;
    const modelId = request.model || this.defaultModel;
    const reasoningField = this.quirks.reasoningField;

    let messageStarted = false;
    let messageId = 'unknown';
    let modelName = '';
    const toolCallBuffers: Map<number, { id: string; name: string; jsonBuf: string }> = new Map();

    // Track whether content_block_start for the reasoning/thinking block was emitted.
    // Required so that consumer stream-processor.ts can create the thinking block UI
    // before receiving reasoning_delta events.
    let reasoningBlockStarted = false;

    // Common reasoning field names to check
    const COMMON_REASONING_FIELDS = ['reasoning_content', 'reasoning_text', 'reasoning'];
    const fieldsToCheck: string[] = [];
    if (reasoningField) {
      fieldsToCheck.push(reasoningField);
      for (const f of COMMON_REASONING_FIELDS) {
        if (f !== reasoningField) fieldsToCheck.push(f);
      }
    } else {
      fieldsToCheck.push(...COMMON_REASONING_FIELDS);
    }

    // Stateful <think> tag parser — one instance per streaming request.
    // Required for Qwen models that embed thinking in XML tags across chunks.
    const thinkTagParser = isQwenThinkModel(modelId) ? new ThinkTagParser() : null;

    for await (const chunk of parseSSEStream(response, signal)) {
      // Emit message_start on first chunk
      if (!messageStarted) {
        if (chunk.id) messageId = chunk.id as string;
        if (chunk.model) modelName = chunk.model as string;
        yield {
          type: 'message_start',
          id: messageId,
          model: modelName,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        };
        messageStarted = true;
      }

      const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
      if (!choices || choices.length === 0) {
        // Check for usage-only chunk
        if (chunk.usage) {
          const usage = this.parseUsage(chunk.usage as Record<string, unknown>);
          let evt: StreamEvent = { type: 'message_delta', usage };
          if (isQuirkyModel(modelId)) evt = applyStreamQuirks(modelId, evt);
          yield evt;
        }
        continue;
      }

      const choice = choices[0];
      const delta = choice.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      // Reasoning / thinking extraction
      for (const field of fieldsToCheck) {
        const reasoning = delta[field] as string | undefined;
        if (reasoning) {
          // Emit content_block_start for thinking before the first reasoning chunk
          // so consumer stream-processor.ts can create the thinking block UI.
          if (!reasoningBlockStarted) {
            reasoningBlockStarted = true;
            yield {
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'thinking', thinking: '' },
            };
          }
          let evt: StreamEvent = { type: 'reasoning_delta', index: 0, reasoning };
          if (isQuirkyModel(modelId)) evt = applyStreamQuirks(modelId, evt);
          yield evt;
          break;
        }
      }

      // Text content delta
      const content = delta.content as string | undefined;
      if (content) {
        if (thinkTagParser) {
          // Qwen: stateful <think> tag parser splits the chunk into
          // reasoning_delta and text_delta events correctly across chunk boundaries.
          for (const evt of thinkTagParser.process(content, 0)) {
            yield evt;
          }
        } else {
          let evt: StreamEvent = { type: 'text_delta', index: 0, text: content };
          if (isQuirkyModel(modelId)) evt = applyStreamQuirks(modelId, evt);
          yield evt;
        }
      }

      // Tool call deltas
      const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (toolCalls) {
        for (const tc of toolCalls) {
          const tcIndex = (tc.index as number) ?? 0;
          const blockIndex = 1 + tcIndex;

          // New tool call — emit ContentBlockStart
          if (tc.id) {
            const func = tc.function as Record<string, unknown> | undefined;
            const name = (func?.name as string) ?? '';
            const tcId = tc.id as string;
            toolCallBuffers.set(blockIndex, { id: tcId, name, jsonBuf: '' });
            yield {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'tool_use', id: tcId, name, input: {} },
            };
          }

          // Argument fragment
          const func = tc.function as Record<string, unknown> | undefined;
          const argsFrag = func?.arguments as string | undefined;
          if (argsFrag) {
            const buf = toolCallBuffers.get(blockIndex);
            if (buf) buf.jsonBuf += argsFrag;
            yield {
              type: 'input_json_delta',
              index: blockIndex,
              partialJson: argsFrag,
            };
          }
        }
      }

      // finish_reason
      const finishReason = choice.finish_reason as string | undefined;
      if (finishReason && finishReason !== 'null') {
        // Close all content blocks
        yield { type: 'content_block_stop', index: 0 };
        const indices = Array.from(toolCallBuffers.keys()).sort((a, b) => a - b);
        for (const idx of indices) {
          yield { type: 'content_block_stop', index: idx };
        }

        const stopReason = this.mapFinishReason(finishReason);
        const usageVal = chunk.usage as Record<string, unknown> | undefined;
        const usage = usageVal ? this.parseUsage(usageVal) : undefined;

        yield { type: 'message_delta', stopReason, usage };

        // Break immediately after finish_reason — don't wait for [DONE] or
        // connection close.  Many OpenAI-compat providers (Qwen, DeepSeek, …)
        // keep the HTTP connection open after the last data chunk without
        // sending the [DONE] sentinel, which causes parseSSEStream's
        // reader.read() to hang indefinitely.  This matches the behaviour of
        // the OpenAI compat router (openai-chat-stream.ts markFinished+break).
        break;
      }
    }

    if (messageStarted) {
      yield { type: 'message_stop' };
    }
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const url = `${this.baseUrl}/models`;
    const headers = this.buildHeaders();

    try {
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) return [];

      const json = (await response.json()) as Record<string, unknown>;
      const data = json?.data as Array<Record<string, unknown>> | undefined;
      if (!data) return [];

      return data
        .filter((m) => m.id)
        .map((m) => ({
          id: m.id as string,
          providerId: this.id,
          name: (m.id as string) ?? '',
          contextWindow: 128_000,
          maxOutputTokens: 16_384,
        }));
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<ProviderStatus> {
    const isLocal =
      this.baseUrl.includes('localhost') ||
      this.baseUrl.includes('127.0.0.1') ||
      this.baseUrl.includes('::1');

    if (!this.apiKey && !isLocal) {
      return { status: 'unavailable', reason: 'No API key configured' };
    }

    try {
      const url = `${this.baseUrl}/models`;
      const response = await fetch(url, { method: 'GET', headers: this.buildHeaders() });
      if (response.ok) return { status: 'healthy' };
      return { status: 'unavailable', reason: `models endpoint returned ${response.status}` };
    } catch (err) {
      return { status: 'unavailable', reason: String(err) };
    }
  }

  // -----------------------------------------------------------------------
  // Request building
  // -----------------------------------------------------------------------

  private buildRequestBody(
    request: ProviderRequest,
    stream: boolean,
  ): Record<string, unknown> {
    const model = request.model || this.defaultModel;
    const messages = this.toOpenAiMessages(request.messages, request.systemPrompt);

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens,
      messages,
      stream,
    };

    if (stream && this.quirks.includeUsageInStream) {
      body.stream_options = { include_usage: true };
    }

    // Tools
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    // Temperature
    const temperature = request.temperature ?? this.quirks.defaultTemperature;
    if (temperature !== undefined) body.temperature = temperature;

    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.stopSequences && request.stopSequences.length > 0) {
      body.stop = request.stopSequences;
    }

    // Reasoning effort (OpenAI o-series / OpenRouter compatible models).
    // Passed via providerOptions from the effort-level resolver in query-loop.
    if (request.providerOptions?.reasoning_effort) {
      body.reasoning_effort = request.providerOptions.reasoning_effort;
    }

    return body;
  }

  /** Convert our unified Message format to OpenAI chat messages. */
  private toOpenAiMessages(
    messages: Message[],
    systemPrompt?: SystemPrompt,
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    // System prompt as first message
    if (systemPrompt) {
      if (typeof systemPrompt === 'string') {
        result.push({ role: 'system', content: systemPrompt });
      } else {
        // SystemPromptBlock[] — concatenate text
        const text = (systemPrompt as SystemPromptBlock[])
          .map((b) => b.text)
          .join('\n\n');
        result.push({ role: 'system', content: text });
      }
    }

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      // Content blocks — need to map to OpenAI format
      const blocks = msg.content as ContentBlock[];

      if (msg.role === 'assistant') {
        // Collect text content and tool calls from assistant message
        let textContent = '';
        const toolCalls: Array<Record<string, unknown>> = [];

        for (const block of blocks) {
          switch (block.type) {
            case 'text':
              textContent += (block as TextBlock).text;
              break;
            case 'tool_use': {
              const tu = block as ToolUseBlock;
              toolCalls.push({
                id: this.scrubToolId(tu.id),
                type: 'function',
                function: {
                  name: tu.name,
                  arguments: JSON.stringify(tu.input),
                },
              });
              break;
            }
            // Thinking/signature blocks are not sent to OpenAI
          }
        }

        const assistantMsg: Record<string, unknown> = { role: 'assistant' };
        if (textContent) assistantMsg.content = textContent;
        else if (toolCalls.length === 0) assistantMsg.content = '';
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        result.push(assistantMsg);
      } else if (msg.role === 'user') {
        // Check for tool_result blocks — these become separate tool messages in OpenAI
        const toolResults: ToolResultBlock[] = [];
        const otherBlocks: ContentBlock[] = [];

        for (const block of blocks) {
          if (block.type === 'tool_result') {
            toolResults.push(block as ToolResultBlock);
          } else {
            otherBlocks.push(block);
          }
        }

        // Emit tool result messages first
        for (const tr of toolResults) {
          const content =
            typeof tr.content === 'string'
              ? tr.content
              : (tr.content as ContentBlock[])
                  .map((b) => (b.type === 'text' ? (b as TextBlock).text : ''))
                  .join('\n');
          result.push({
            role: 'tool',
            tool_call_id: this.scrubToolId(tr.tool_use_id),
            content,
          });
        }

        // Emit remaining user content
        if (otherBlocks.length > 0) {
          const userContent = this.mapUserContent(otherBlocks);
          result.push({ role: 'user', content: userContent });
        } else if (toolResults.length === 0) {
          // Empty user message
          result.push({ role: 'user', content: '' });
        }
      }
    }

    // Apply fix_tool_user_sequence quirk
    if (this.quirks.fixToolUserSequence) {
      this.applyFixToolUserSequence(result);
    }

    return result;
  }

  /** Map user content blocks to OpenAI content format. */
  private mapUserContent(
    blocks: ContentBlock[],
  ): string | Array<Record<string, unknown>> {
    // If all blocks are text, return a simple string
    const allText = blocks.every((b) => b.type === 'text');
    if (allText) {
      return blocks.map((b) => (b as TextBlock).text).join('');
    }

    // Mixed content — use the array format
    return blocks.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: (block as TextBlock).text };
        case 'image': {
          const img = block as { type: 'image'; source: { type: string; media_type: string; data: string } };
          return {
            type: 'image_url',
            image_url: {
              url: `data:${img.source.media_type};base64,${img.source.data}`,
            },
          };
        }
        default:
          return { type: 'text', text: '' };
      }
    });
  }

  /** Scrub a tool-call ID according to configured quirks. */
  private scrubToolId(id: string): string {
    let s = id;
    if (this.quirks.toolIdAlphanumericOnly) {
      s = s.replace(/[^a-zA-Z0-9]/g, '');
    }
    if (this.quirks.toolIdMaxLen) {
      const truncated = s.slice(0, this.quirks.toolIdMaxLen);
      s = truncated.padEnd(this.quirks.toolIdMaxLen, '0');
    }
    return s;
  }

  /**
   * Insert `{"role":"assistant","content":"Done."}` between any
   * tool message immediately followed by a user message.
   */
  private applyFixToolUserSequence(messages: Array<Record<string, unknown>>): void {
    let i = 0;
    while (i + 1 < messages.length) {
      if (messages[i].role === 'tool' && messages[i + 1].role === 'user') {
        messages.splice(i + 1, 0, { role: 'assistant', content: 'Done.' });
        i += 2;
      } else {
        i++;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Response parsing
  // -----------------------------------------------------------------------

  /** Parse a non-streaming OpenAI Chat Completions response. */
  private parseNonStreamingResponse(
    json: Record<string, unknown>,
    model: string,
  ): ProviderResponse {
    const id = (json.id as string) ?? 'unknown';
    const modelReported = (json.model as string) ?? model;
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;

    const content: ContentBlock[] = [];

    // Text content
    const textContent = message?.content as string | undefined;
    if (textContent) {
      content.push({ type: 'text', text: textContent });
    }

    // Tool calls
    const toolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        const func = tc.function as Record<string, unknown>;
        const name = (func?.name as string) ?? '';
        const argsStr = (func?.arguments as string) ?? '{}';
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(argsStr);
        } catch {
          // Keep empty input on parse failure
        }
        content.push({
          type: 'tool_use',
          id: (tc.id as string) ?? '',
          name,
          input,
        });
      }
    }

    // Ensure non-empty content
    if (content.length === 0) {
      content.push({ type: 'text', text: '' });
    }

    const finishReason = (choice?.finish_reason as string) ?? 'stop';
    const stopReason = this.mapFinishReason(finishReason);

    const usage = this.parseUsage(json.usage as Record<string, unknown> | undefined);

    return { id, content, stopReason, usage, model: modelReported };
  }

  /** Map OpenAI finish_reason to our StopReason. */
  private mapFinishReason(reason: string): StopReason {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      case 'content_filter':
        return 'content_filtered';
      default:
        return reason;
    }
  }

  /** Parse usage info from OpenAI response. */
  private parseUsage(usage?: Record<string, unknown>): UsageInfo {
    if (!usage) {
      return { input_tokens: 0, output_tokens: 0 };
    }
    return {
      input_tokens: (usage.prompt_tokens as number) ?? 0,
      output_tokens: (usage.completion_tokens as number) ?? 0,
    };
  }

  /** Build HTTP headers for OpenAI-compatible API requests. */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    for (const [key, value] of Object.entries(this.extraHeaders)) {
      headers[key] = value;
    }

    return headers;
  }

  /** Create a descriptive error from an HTTP error response. */
  private createHttpError(status: number, body: string): Error {
    let message = `${this.name} API error (${status})`;

    try {
      const json = JSON.parse(body);
      const errorMsg =
        json?.error?.message ?? json?.message ?? json?.detail;
      if (errorMsg) message = `${message}: ${errorMsg}`;
    } catch {
      if (body) message = `${message}: ${body.slice(0, 500)}`;
    }

    const error = new Error(message);
    (error as any).status = status;
    (error as any).provider = this.id;

    if (status === 401 || status === 403) (error as any).code = 'auth_failed';
    else if (status === 429) (error as any).code = 'rate_limited';
    else if (status >= 500) (error as any).code = 'server_error';
    else (error as any).code = 'request_error';

    return error;
  }
}
