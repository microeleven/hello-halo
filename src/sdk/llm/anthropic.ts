/**
 * @module llm/anthropic
 * Anthropic Messages API provider implementation.
 * POST to https://api.anthropic.com/v1/messages with native SSE streaming.
 * @license MIT
 */

import type {
  ContentBlock,
  LlmProvider,
  ProviderCapabilities,
  ProviderModelInfo,
  ProviderRequest,
  ProviderResponse,
  ProviderStatus,
  StopReason,
  StreamEvent,
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  UsageInfo,
} from '../types/provider.js';
import { parseSSEStream } from './stream-parser.js';
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

export interface AnthropicProviderConfig {
  /** Anthropic API key */
  apiKey: string;
  /** Base URL override (defaults to https://api.anthropic.com) */
  baseUrl?: string;
  /** Anthropic API version header (defaults to 2023-06-01) */
  apiVersion?: string;
  /** Beta feature headers to include */
  betas?: string[];
  /** Additional headers to send on every request */
  headers?: Record<string, string>;
  /** Default model to use when none is specified */
  defaultModel?: string;
}

// ---------------------------------------------------------------------------
// AnthropicProvider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly betas: string[];
  private readonly extraHeaders: Record<string, string>;
  private readonly defaultModel: string;

  constructor(config: AnthropicProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    this.apiVersion = config.apiVersion ?? '2023-06-01';
    this.betas = config.betas ?? [];
    this.extraHeaders = config.headers ?? {};
    this.defaultModel = config.defaultModel ?? 'claude-sonnet-4-6';
  }

  // -----------------------------------------------------------------------
  // LlmProvider interface
  // -----------------------------------------------------------------------

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      toolCalling: true,
      thinking: true,
      imageInput: true,
      pdfInput: true,
      audioInput: false,
      videoInput: false,
      caching: true,
      structuredOutput: true,
      systemPromptStyle: 'top_level',
    };
  }

  async createMessage(request: ProviderRequest): Promise<ProviderResponse> {
    // Collect streaming events into a complete response
    const gen = this.createMessageStream({ ...request, stream: true });

    let id = 'unknown';
    let model = request.model || this.defaultModel;
    const contentBlocks: ContentBlock[] = [];
    const textParts: Map<number, string> = new Map();
    const thinkingParts: Map<number, { thinking: string; signature: string }> = new Map();
    const toolBuffers: Map<number, { id: string; name: string; jsonBuf: string }> = new Map();
    let stopReason: StopReason = 'end_turn';
    let usage: UsageInfo = { input_tokens: 0, output_tokens: 0 };

    for await (const event of gen) {
      switch (event.type) {
        case 'message_start':
          id = event.id;
          model = event.model;
          usage = event.usage;
          break;

        case 'content_block_start': {
          const cb = event.content_block;
          if (cb.type === 'text') {
            textParts.set(event.index, (cb as TextBlock).text);
          } else if (cb.type === 'thinking') {
            thinkingParts.set(event.index, {
              thinking: (cb as ThinkingBlock).thinking,
              signature: (cb as ThinkingBlock).signature ?? '',
            });
          } else if (cb.type === 'tool_use') {
            const tu = cb as ToolUseBlock;
            toolBuffers.set(event.index, { id: tu.id, name: tu.name, jsonBuf: '' });
          } else {
            contentBlocks.push(cb);
          }
          break;
        }

        case 'text_delta':
          textParts.set(event.index, (textParts.get(event.index) ?? '') + event.text);
          break;

        case 'thinking_delta': {
          const existing = thinkingParts.get(event.index) ?? { thinking: '', signature: '' };
          thinkingParts.set(event.index, {
            thinking: existing.thinking + event.thinking,
            signature: existing.signature,
          });
          break;
        }

        case 'signature_delta': {
          const existing = thinkingParts.get(event.index) ?? { thinking: '', signature: '' };
          thinkingParts.set(event.index, {
            thinking: existing.thinking,
            signature: existing.signature + event.signature,
          });
          break;
        }

        case 'input_json_delta': {
          const buf = toolBuffers.get(event.index);
          if (buf) buf.jsonBuf += event.partialJson;
          break;
        }

        case 'content_block_stop': {
          // Finalize tool use blocks
          const toolBuf = toolBuffers.get(event.index);
          if (toolBuf) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(toolBuf.jsonBuf);
            } catch {
              // Keep empty input on parse failure
            }
            contentBlocks.push({
              type: 'tool_use',
              id: toolBuf.id,
              name: toolBuf.name,
              input,
            });
            toolBuffers.delete(event.index);
          }
          break;
        }

        case 'message_delta':
          if (event.stopReason) stopReason = event.stopReason;
          if (event.usage) {
            usage = {
              ...usage,
              output_tokens: usage.output_tokens + (event.usage.output_tokens ?? 0),
            };
          }
          break;

        case 'message_stop':
          break;

        case 'error':
          throw new Error(`[${event.errorType}] ${event.message}`);
      }
    }

    // Assemble final content: thinking blocks first, then text blocks, then tool blocks
    const allBlocks: ContentBlock[] = [];

    // Thinking blocks by index order (with signature preserved for subsequent turns)
    const thinkingEntries = Array.from(thinkingParts.entries()).sort((a, b) => a[0] - b[0]);
    for (const [, { thinking, signature }] of thinkingEntries) {
      if (thinking) {
        const thinkingBlock: ThinkingBlock = { type: 'thinking', thinking };
        if (signature) thinkingBlock.signature = signature;
        allBlocks.push(thinkingBlock);
      }
    }

    // Text blocks by index order
    const textEntries = Array.from(textParts.entries()).sort((a, b) => a[0] - b[0]);
    for (const [, text] of textEntries) {
      allBlocks.push({ type: 'text', text });
    }

    // Other content blocks (tool_use, images, etc.)
    allBlocks.push(...contentBlocks);

    return { id, content: allBlocks, stopReason, usage, model };
  }

  async *createMessageStream(
    request: ProviderRequest,
  ): AsyncGenerator<StreamEvent, void, undefined> {
    const body = this.buildRequestBody(request);
    body.stream = true;

    const url = `${this.baseUrl}/v1/messages`;
    const headers = this.buildHeaders();

    // Retry loop for transient errors
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
          // Honour Retry-After header when present (supports both delta-seconds and HTTP-date)
          const retryAfterMs = parseRetryAfterMs(response.headers);
          if (retryAfterMs !== undefined) {
            await sleep(retryAfterMs, abortSignal);
          }
          lastError = new Error(`HTTP ${status}: ${errorBody}`);
          continue;
        }

        throw this.createHttpError(status, errorBody);
      }

      // Parse SSE stream and map to StreamEvent
      const signal = request.providerOptions?.signal as AbortSignal | undefined;
      let _dbgAnthropicEventCount = 0;
      for await (const chunk of parseSSEStream(response, signal)) {
        const event = this.mapAnthropicEvent(chunk);
        if (event) {
          _dbgAnthropicEventCount++;
          console.log(`[ANTHROPIC-PROVIDER] event#${_dbgAnthropicEventCount} type=${event.type} t=${Date.now()}`);
          yield event;
          // Break immediately after message_stop — don't wait for [DONE] or
          // connection close. Many OpenAI-compat providers (Qwen, DeepSeek, …)
          // proxied through the compat router keep the HTTP connection open
          // after the last SSE chunk without sending the [DONE] sentinel,
          // causing parseSSEStream to hang indefinitely.
          if (event.type === 'message_stop') {
            console.log(`[ANTHROPIC-PROVIDER] message_stop received, returning. total events=${_dbgAnthropicEventCount}`);
            return;
          }
        }
      }
      console.log(`[ANTHROPIC-PROVIDER] parseSSEStream ended naturally. total events=${_dbgAnthropicEventCount}`);
      return;
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    // Fallback list used when the API call fails (no key, network error, etc.)
    const FALLBACK: ProviderModelInfo[] = [
      {
        id: 'claude-opus-4-5',
        providerId: 'anthropic',
        name: 'Claude Opus 4.5',
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
      },
      {
        id: 'claude-sonnet-4-5',
        providerId: 'anthropic',
        name: 'Claude Sonnet 4.5',
        contextWindow: 200_000,
        maxOutputTokens: 16_000,
      },
      {
        id: 'claude-haiku-3-5',
        providerId: 'anthropic',
        name: 'Claude Haiku 3.5',
        contextWindow: 200_000,
        maxOutputTokens: 8_096,
      },
    ];

    if (!this.apiKey) return FALLBACK;

    try {
      const url = `${this.baseUrl}/v1/models?limit=100`;
      const headers = this.buildHeaders();
      // GET request — remove content-type (not needed for GET)
      delete (headers as Record<string, string | undefined>)['content-type'];

      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) return FALLBACK;

      const json = (await response.json()) as Record<string, unknown>;
      const data = json?.data as Array<Record<string, unknown>> | undefined;
      if (!data || !Array.isArray(data)) return FALLBACK;

      const models: ProviderModelInfo[] = data
        .filter((m) => typeof m.id === 'string')
        .map((m) => ({
          id: m.id as string,
          providerId: 'anthropic',
          name: (m.display_name as string | undefined) ?? (m.id as string),
          // Context window and output limits are not returned by the models API;
          // use sensible defaults for all Claude models.
          contextWindow: 200_000,
          maxOutputTokens: 8_096,
        }));

      return models.length > 0 ? models : FALLBACK;
    } catch {
      return FALLBACK;
    }
  }

  async healthCheck(): Promise<ProviderStatus> {
    if (!this.apiKey) {
      return { status: 'unavailable', reason: 'No API key configured' };
    }
    return { status: 'healthy' };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Build the Anthropic Messages API request body. */
  private buildRequestBody(request: ProviderRequest): Record<string, unknown> {
    const model = request.model || this.defaultModel;
    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens,
      messages: this.normalizeMessages(request.messages),
    };

    // System prompt as top-level field
    if (request.systemPrompt) {
      if (typeof request.systemPrompt === 'string') {
        body.system = request.systemPrompt;
      } else {
        // Array of SystemPromptBlock — pass as-is
        body.system = request.systemPrompt;
      }
    }

    // Tools
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }

    // Optional parameters
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.topK !== undefined) body.top_k = request.topK;
    if (request.stopSequences && request.stopSequences.length > 0) {
      body.stop_sequences = request.stopSequences;
    }

    // Extended thinking
    if (request.thinking) {
      if (request.thinking.type === 'enabled') {
        body.thinking = {
          type: 'enabled',
          budget_tokens: request.thinking.budgetTokens,
        };
      } else if (request.thinking.type === 'adaptive') {
        body.thinking = { type: 'adaptive' };
      }
      // 'disabled' → omit thinking param entirely (API default)
    }

    return body;
  }

  /** Normalize messages to the Anthropic wire format. */
  private normalizeMessages(
    messages: Array<{ role: string; content: unknown }>,
  ): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }

      // Array of content blocks — map to Anthropic format
      const blocks = msg.content as ContentBlock[];
      const apiBlocks = blocks.map((block) => {
        switch (block.type) {
          case 'text':
            return { type: 'text', text: (block as TextBlock).text };
          case 'thinking': {
            const tb = block as ThinkingBlock;
            return {
              type: 'thinking',
              thinking: tb.thinking,
              ...(tb.signature ? { signature: tb.signature } : {}),
            };
          }
          case 'tool_use': {
            const tu = block as ToolUseBlock;
            return { type: 'tool_use', id: tu.id, name: tu.name, input: tu.input };
          }
          case 'tool_result': {
            const tr = block as { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean };
            return {
              type: 'tool_result',
              tool_use_id: tr.tool_use_id,
              content: tr.content,
              ...(tr.is_error ? { is_error: true } : {}),
            };
          }
          case 'image': {
            const img = block as { type: 'image'; source: { type: string; media_type: string; data: string } };
            return {
              type: 'image',
              source: img.source,
            };
          }
          case 'document': {
            const doc = block as { type: 'document'; source: { type: string; media_type: string; data: string } };
            return {
              type: 'document',
              source: doc.source,
            };
          }
          default:
            return block;
        }
      });

      return { role: msg.role, content: apiBlocks };
    });
  }

  /** Build HTTP headers for Anthropic API requests. */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.apiVersion,
    };

    if (this.betas.length > 0) {
      headers['anthropic-beta'] = this.betas.join(',');
    }

    // Merge extra headers
    for (const [key, value] of Object.entries(this.extraHeaders)) {
      headers[key] = value;
    }

    return headers;
  }

  /**
   * Map a raw Anthropic SSE event (parsed JSON object) to a StreamEvent.
   * Returns null for events that should be skipped (e.g. ping).
   */
  private mapAnthropicEvent(raw: Record<string, unknown>): StreamEvent | null {
    const eventType = (raw.__event as string) ?? (raw.type as string);

    switch (eventType) {
      case 'message_start': {
        const message = raw.message as Record<string, unknown> | undefined;
        const id = (message?.id as string) ?? 'unknown';
        const model = (message?.model as string) ?? '';
        const rawUsage = message?.usage as Record<string, unknown> | undefined;
        const usage: UsageInfo = {
          input_tokens: (rawUsage?.input_tokens as number) ?? 0,
          output_tokens: (rawUsage?.output_tokens as number) ?? 0,
          cache_creation_input_tokens: rawUsage?.cache_creation_input_tokens as number | undefined,
          cache_read_input_tokens: rawUsage?.cache_read_input_tokens as number | undefined,
        };
        return { type: 'message_start', id, model, usage };
      }

      case 'content_block_start': {
        const index = (raw.index as number) ?? 0;
        const cb = raw.content_block as Record<string, unknown>;
        const content_block = this.mapContentBlock(cb);
        return { type: 'content_block_start', index, content_block };
      }

      case 'content_block_delta': {
        const index = (raw.index as number) ?? 0;
        const delta = raw.delta as Record<string, unknown>;
        const deltaType = delta?.type as string;

        switch (deltaType) {
          case 'text_delta':
            return { type: 'text_delta', index, text: (delta.text as string) ?? '' };
          case 'thinking_delta':
            return { type: 'thinking_delta', index, thinking: (delta.thinking as string) ?? '' };
          case 'input_json_delta':
            return { type: 'input_json_delta', index, partialJson: (delta.partial_json as string) ?? '' };
          case 'signature_delta':
            return { type: 'signature_delta', index, signature: (delta.signature as string) ?? '' };
          default:
            return null;
        }
      }

      case 'content_block_stop':
        return { type: 'content_block_stop', index: (raw.index as number) ?? 0 };

      case 'message_delta': {
        const delta = raw.delta as Record<string, unknown> | undefined;
        const rawUsage = raw.usage as Record<string, unknown> | undefined;
        const sr = delta?.stop_reason as string | undefined;
        return {
          type: 'message_delta',
          stopReason: sr ? this.mapStopReason(sr) : undefined,
          usage: rawUsage
            ? {
                input_tokens: (rawUsage.input_tokens as number) ?? 0,
                output_tokens: (rawUsage.output_tokens as number) ?? 0,
              }
            : undefined,
        };
      }

      case 'message_stop':
        return { type: 'message_stop' };

      case 'error': {
        const error = raw.error as Record<string, unknown> | undefined;
        return {
          type: 'error',
          errorType: (error?.type as string) ?? 'unknown_error',
          message: (error?.message as string) ?? 'Unknown error',
        };
      }

      case 'ping':
        return null;

      default:
        return null;
    }
  }

  /** Map a raw content block object to a ContentBlock type. */
  private mapContentBlock(raw: Record<string, unknown>): ContentBlock {
    switch (raw.type as string) {
      case 'text':
        return { type: 'text', text: (raw.text as string) ?? '' };
      case 'thinking': {
        const block: ThinkingBlock = {
          type: 'thinking',
          thinking: (raw.thinking as string) ?? '',
        };
        if (raw.signature) block.signature = raw.signature as string;
        return block;
      }
      case 'tool_use':
        return {
          type: 'tool_use',
          id: (raw.id as string) ?? '',
          name: (raw.name as string) ?? '',
          input: (raw.input as Record<string, unknown>) ?? {},
        };
      case 'signature':
        return { type: 'signature', signature: (raw.signature as string) ?? '' };
      default:
        return { type: 'text', text: '' };
    }
  }

  /** Map Anthropic stop reason string to StopReason. */
  private mapStopReason(reason: string): StopReason {
    switch (reason) {
      case 'end_turn':
        return 'end_turn';
      case 'stop_sequence':
        return 'stop_sequence';
      case 'max_tokens':
        return 'max_tokens';
      case 'tool_use':
        return 'tool_use';
      default:
        return reason;
    }
  }

  /** Create a descriptive error from an HTTP error response. */
  private createHttpError(status: number, body: string): Error {
    let message = `Anthropic API error (${status})`;

    try {
      const json = JSON.parse(body);
      const errorMsg =
        json?.error?.message ?? json?.error?.error?.message ?? json?.message;
      if (errorMsg) message = `${message}: ${errorMsg}`;
    } catch {
      if (body) message = `${message}: ${body.slice(0, 500)}`;
    }

    const error = new Error(message);
    (error as any).status = status;
    (error as any).provider = 'anthropic';

    // Categorize error
    if (status === 401 || status === 403) (error as any).code = 'auth_failed';
    else if (status === 429) (error as any).code = 'rate_limited';
    else if (status === 529) (error as any).code = 'overloaded';
    else if (status >= 500) (error as any).code = 'server_error';
    else (error as any).code = 'request_error';

    return error;
  }
}
