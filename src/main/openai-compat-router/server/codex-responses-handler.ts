/**
 * Codex Responses compatibility handler.
 *
 * Codex 0.128 only speaks OpenAI Responses wire format. This module lets Codex
 * use Halo's existing OpenAI-compatible providers by accepting /v1/responses
 * locally and converting to either upstream Responses or Chat Completions.
 */

import type { Response as ExpressResponse } from 'express'
import type { AnthropicContentBlock, AnthropicMessage, AnthropicRequest, AnthropicToolUseBlock, BackendConfig } from '../types'
import {
  convertAnthropicToOpenAIChat,
  convertAnthropicToOpenAIResponses,
  convertOpenAIChatToAnthropic,
  convertOpenAIResponsesToAnthropic
} from '../converters'
import { streamOpenAIChatToAnthropic } from '../stream'
import { proxyFetch } from '../../services/proxy-fetch'
import { getEndpointUrlError, isValidEndpointUrl } from './api-type'
import { applyProviderAdapter, type AdapterContext } from './provider-adapters'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

const STATUS_ERROR_MAP: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
  500: 'api_error',
  529: 'overloaded_error'
}

export interface CodexResponsesRequest {
  model?: string
  instructions?: string
  input?: unknown
  tools?: unknown[]
  tool_choice?: unknown
  parallel_tool_calls?: boolean
  reasoning?: unknown
  store?: boolean
  stream?: boolean
}

async function fetchUpstream(
  targetUrl: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
  customHeaders?: Record<string, string>
): Promise<globalThis.Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    console.log('[CodexResponsesHandler] Request timeout, aborting...')
    controller.abort()
  }, timeoutMs)

  try {
    const headers: Record<string, string> = { ...(customHeaders || {}) }
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type') {
        delete headers[key]
      }
    }
    headers['Content-Type'] = 'application/json'
    if (!headers['Authorization']) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    return await proxyFetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: signal ?? controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

function getErrorTypeFromStatus(status: number): string {
  return STATUS_ERROR_MAP[status] || 'api_error'
}

function getUpstreamError(status: number, errorText: string): { type: string; message: string } {
  try {
    const json = JSON.parse(errorText)
    if (json?.error?.type) {
      return { type: json.error.type, message: json.error.message || '' }
    }
    if (json?.error?.message) {
      return { type: json.error.type || getErrorTypeFromStatus(status), message: json.error.message }
    }
  } catch {
    // Not JSON, ignore.
  }
  return {
    type: getErrorTypeFromStatus(status),
    message: errorText || `HTTP ${status}`
  }
}

export function codexResponsesToAnthropicRequest(request: CodexResponsesRequest): AnthropicRequest {
  const messages: AnthropicMessage[] = []
  const systemParts: string[] = []

  if (request.instructions) {
    systemParts.push(request.instructions)
  }

  for (const item of normalizeResponsesInput(request.input)) {
    if (item.type === 'message') {
      const role = item.role === 'assistant' ? 'assistant' : 'user'
      const content = responsesContentToAnthropicBlocks(item.content, role)
      if (item.role === 'system' || item.role === 'developer') {
        const text = content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n')
        if (text) systemParts.push(text)
        continue
      }
      messages.push({ role, content: content.length === 1 && content[0].type === 'text' ? content[0].text : content })
      continue
    }

    if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      messages.push({
        role: 'assistant',
        content: [responsesCallItemToAnthropicToolUse(item)]
      })
      continue
    }

    if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: String(item.call_id || item.id || ''),
          content: normalizeResponsesOutput(item.output),
        }]
      })
    }
  }

  return {
    model: request.model || 'unknown',
    max_tokens: 8192,
    messages,
    ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
    ...(request.stream !== undefined ? { stream: request.stream } : {}),
    tools: responsesToolsToAnthropicTools(request.tools),
    tool_choice: responsesToolChoiceToAnthropic(request.tool_choice),
    thinking: responsesReasoningToAnthropicThinking(request.reasoning),
  }
}

function normalizeResponsesInput(input: unknown): any[] {
  if (Array.isArray(input)) return input.filter(Boolean)
  if (typeof input === 'string' && input) return [{ type: 'message', role: 'user', content: input }]
  if (input && typeof input === 'object') return [input]
  return []
}

function responsesContentToAnthropicBlocks(content: unknown, role: 'user' | 'assistant'): AnthropicContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []

  const blocks: AnthropicContentBlock[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const type = String((part as any).type || '')
    if ((type === 'input_text' || type === 'output_text' || type === 'text') && typeof (part as any).text === 'string') {
      blocks.push({ type: 'text', text: (part as any).text })
      continue
    }
    if (type === 'input_image' && role === 'user' && typeof (part as any).image_url === 'string') {
      const imageUrl = (part as any).image_url as string
      if (imageUrl.startsWith('data:')) {
        const match = imageUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/)
        if (match) {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: match[1] as any, data: match[2] } })
        }
      } else {
        blocks.push({ type: 'image', source: { type: 'url', url: imageUrl } })
      }
    }
  }
  return blocks
}

function responsesCallItemToAnthropicToolUse(item: any): AnthropicToolUseBlock {
  let input: Record<string, unknown> = {}
  const raw = item.arguments ?? item.input ?? '{}'
  try {
    input = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw
  } catch {
    input = { text: String(raw || '') }
  }

  return {
    type: 'tool_use',
    id: String(item.call_id || item.id || `call_${Date.now()}`),
    name: String(item.name || 'tool'),
    input,
  }
}

function normalizeResponsesOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) return String((part as any).text)
      return JSON.stringify(part)
    }).join('\n')
  }
  return output === undefined ? '' : JSON.stringify(output)
}

function responsesToolsToAnthropicTools(tools: unknown[] | undefined): AnthropicRequest['tools'] {
  if (!Array.isArray(tools)) return undefined
  const converted = tools
    .filter((tool: any) => tool?.type === 'function' || tool?.type === 'custom')
    .map((tool: any) => {
      const fn = tool.function || tool
      return {
        name: String(fn.name || tool.name || 'tool'),
        description: fn.description || tool.description,
        input_schema: fn.parameters || tool.parameters || { type: 'object', properties: {} },
        strict: fn.strict || tool.strict,
      }
    })
  return converted.length ? converted : undefined
}

function responsesToolChoiceToAnthropic(toolChoice: unknown): AnthropicRequest['tool_choice'] {
  if (!toolChoice) return undefined
  if (toolChoice === 'auto') return { type: 'auto' }
  if (toolChoice === 'none') return { type: 'none' }
  if (toolChoice === 'required') return { type: 'any' }
  if (typeof toolChoice === 'object' && (toolChoice as any).name) {
    return { type: 'tool', name: String((toolChoice as any).name) }
  }
  return undefined
}

function responsesReasoningToAnthropicThinking(reasoning: unknown): AnthropicRequest['thinking'] {
  if (!reasoning || typeof reasoning !== 'object') return undefined
  const effort = (reasoning as any).effort
  if (!effort || effort === 'none') return undefined
  return { type: 'enabled', budget_tokens: 1024 }
}

export function anthropicToCodexResponse(anthropicResponse: any, model: string): Record<string, unknown> {
  const output: unknown[] = []
  for (const block of anthropicResponse?.content || []) {
    if (block.type === 'text') {
      output.push({
        id: `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: block.text || '' }],
      })
    } else if (block.type === 'thinking') {
      output.push({
        id: `rs_${Date.now()}`,
        type: 'reasoning',
        status: 'completed',
        summary: [{ type: 'output_text', text: block.thinking || '' }],
      })
    } else if (block.type === 'tool_use') {
      output.push({
        id: block.id,
        type: 'function_call',
        status: 'completed',
        name: block.name,
        call_id: block.id,
        arguments: JSON.stringify(block.input || {}),
      })
    }
  }

  return {
    id: anthropicResponse?.id || `resp_${Date.now()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model: anthropicResponse?.model || model,
    status: 'completed',
    output,
    usage: {
      input_tokens: anthropicResponse?.usage?.input_tokens || 0,
      output_tokens: anthropicResponse?.usage?.output_tokens || 0,
      total_tokens: (anthropicResponse?.usage?.input_tokens || 0) + (anthropicResponse?.usage?.output_tokens || 0),
    },
  }
}

function writeCodexSse(res: ExpressResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export async function handleResponsesRequest(
  codexRequest: CodexResponsesRequest,
  config: BackendConfig,
  res: ExpressResponse,
  options: { debug?: boolean; timeoutMs?: number } = {}
): Promise<void> {
  const { debug = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const { url: backendUrl, key: apiKey, headers: customHeaders, apiType: configApiType, adapterId } = config

  if (!isValidEndpointUrl(backendUrl)) {
    return sendResponsesError(res, 400, 'invalid_request_error', getEndpointUrlError(backendUrl))
  }

  const apiType = configApiType === 'responses' ? 'responses' : 'chat_completions'
  const anthropicRequest = codexResponsesToAnthropicRequest(codexRequest)
  const requestToSend = { ...anthropicRequest, stream: codexRequest.stream === true }
  const openaiRequest = apiType === 'responses'
    ? convertAnthropicToOpenAIResponses(requestToSend).request
    : convertAnthropicToOpenAIChat(requestToSend).request

  const requestHeaders: Record<string, string> = { ...(customHeaders || {}) }
  const adapterContext: AdapterContext = { originalRequest: requestToSend }
  applyProviderAdapter(backendUrl, openaiRequest as Record<string, unknown>, requestHeaders, adapterId, adapterContext)

  console.log(`[CodexResponsesHandler] Proxy ${apiType} -> ${backendUrl} stream=${codexRequest.stream === true}`)

  try {
    const upstreamResp = await fetchUpstream(backendUrl, apiKey, openaiRequest, timeoutMs, undefined, requestHeaders)
    if (!upstreamResp.ok) {
      const errorText = await upstreamResp.text().catch(() => '')
      const { type, message } = getUpstreamError(upstreamResp.status, errorText)
      return sendResponsesError(res, upstreamResp.status, type, message)
    }

    if (codexRequest.stream === true) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      if (apiType === 'responses') {
        await pipeNativeResponsesStream(upstreamResp.body, res)
      } else {
        await streamOpenAIChatToAnthropic(upstreamResp.body, createCodexAnthropicStreamBridge(res, anthropicRequest.model), anthropicRequest.model, debug)
      }
      return
    }

    const openaiResponse = await upstreamResp.json()
    const anthropicResponse = apiType === 'responses'
      ? convertOpenAIResponsesToAnthropic(openaiResponse)
      : convertOpenAIChatToAnthropic(openaiResponse, anthropicRequest.model)
    res.json(anthropicToCodexResponse(anthropicResponse, anthropicRequest.model))
  } catch (error: any) {
    return sendResponsesError(res, 500, 'api_error', error?.message || String(error))
  }
}

async function pipeNativeResponsesStream(stream: ReadableStream<Uint8Array> | null, res: ExpressResponse): Promise<void> {
  if (!stream) {
    writeCodexSse(res, 'response.failed', { type: 'response.failed', response: { error: { message: 'Empty stream from provider' } } })
    res.end()
    return
  }

  try {
    await stream.pipeTo(new WritableStream({
      write(chunk) { res.write(Buffer.from(chunk)) },
      close() { res.end() },
      abort(error) {
        writeCodexSse(res, 'response.failed', { type: 'response.failed', response: { error: { message: error?.message || String(error) } } })
        res.end()
      }
    }))
  } catch (error: any) {
    writeCodexSse(res, 'response.failed', { type: 'response.failed', response: { error: { message: error?.message || String(error) } } })
    res.end()
  }
}

export function createCodexStreamBridgeForTest(res: ExpressResponse, model: string): ExpressResponse {
  return createCodexAnthropicStreamBridge(res, model)
}

function createCodexAnthropicStreamBridge(res: ExpressResponse, model: string): ExpressResponse {
  let buffer = ''
  let tool: { index: number; id: string; name: string; args: string } | null = null
  let textItem: { index: number; id: string; text: string } | null = null
  let completed = false

  const bridge = Object.create(res)
  bridge.write = (chunk: unknown) => {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const dataLine = part.split('\n').find((line) => line.startsWith('data:'))
      const data = dataLine?.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const event = JSON.parse(data)
        const state = streamAnthropicEventToCodex(event, res, model, { tool, textItem })
        tool = state.tool
        textItem = state.textItem
        if (event.type === 'message_stop') completed = true
      } catch {
        // Ignore malformed generated SSE chunks.
      }
    }
    return true
  }
  bridge.end = () => {
    if (!completed) {
      writeCodexSse(res, 'response.completed', {
        type: 'response.completed',
        response: { id: `resp_${Date.now()}`, model, status: 'completed' },
      })
    }
    res.end()
    return bridge
  }
  bridge.setHeader = () => bridge
  bridge.status = () => bridge
  return bridge as ExpressResponse
}

interface CodexStreamBridgeState {
  tool: { index: number; id: string; name: string; args: string } | null
  textItem: { index: number; id: string; text: string } | null
}

function streamAnthropicEventToCodex(
  event: any,
  res: ExpressResponse,
  model: string,
  state: CodexStreamBridgeState
): CodexStreamBridgeState {
  if (event.type === 'message_start') {
    writeCodexSse(res, 'response.created', { type: 'response.created', response: { id: event.message?.id || `resp_${Date.now()}`, model } })
    return state
  }

  if (event.type === 'content_block_start') {
    const block = event.content_block || {}
    if (block.type === 'tool_use') {
      const nextTool = { index: event.index || 0, id: block.id, name: block.name, args: '' }
      writeCodexSse(res, 'response.output_item.added', {
        type: 'response.output_item.added',
        output_index: nextTool.index,
        item: { type: 'function_call', id: block.id, call_id: block.id, name: block.name, arguments: '' },
      })
      return { ...state, tool: nextTool }
    }

    if (block.type === 'text') {
      const textItem = {
        index: event.index || 0,
        id: `msg_${Date.now()}_${event.index || 0}`,
        text: block.text || '',
      }
      writeCodexSse(res, 'response.output_item.added', {
        type: 'response.output_item.added',
        output_index: textItem.index,
        item: {
          type: 'message',
          role: 'assistant',
          content: textItem.text ? [{ type: 'output_text', text: textItem.text }] : [],
          phase: 'final_answer',
        },
      })
      return { ...state, textItem }
    }

    return state
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta || {}
    if (delta.type === 'text_delta') {
      const textItem = state.textItem || { index: 0, id: `msg_${Date.now()}_0`, text: '' }
      const nextTextItem = { ...textItem, text: textItem.text + (delta.text || '') }
      if (!state.textItem) {
        writeCodexSse(res, 'response.output_item.added', {
          type: 'response.output_item.added',
          output_index: nextTextItem.index,
          item: { type: 'message', role: 'assistant', content: [], phase: 'final_answer' },
        })
      }
      writeCodexSse(res, 'response.output_text.delta', { type: 'response.output_text.delta', item_id: nextTextItem.id, delta: delta.text || '' })
      return { ...state, textItem: nextTextItem }
    }

    if (delta.type === 'thinking_delta') {
      writeCodexSse(res, 'response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', delta: delta.thinking || '', summary_index: 0 })
      return state
    }

    if (delta.type === 'input_json_delta' && state.tool) {
      const nextTool = { ...state.tool, args: state.tool.args + (delta.partial_json || '') }
      writeCodexSse(res, 'response.custom_tool_call_input.delta', {
        type: 'response.custom_tool_call_input.delta',
        item_id: nextTool.id,
        call_id: nextTool.id,
        delta: delta.partial_json || '',
      })
      return { ...state, tool: nextTool }
    }
    return state
  }

  if (event.type === 'content_block_stop') {
    if (state.tool) {
      writeCodexSse(res, 'response.output_item.done', {
        type: 'response.output_item.done',
        output_index: state.tool.index,
        item: {
          type: 'function_call',
          id: state.tool.id,
          call_id: state.tool.id,
          name: state.tool.name,
          arguments: state.tool.args || '{}',
        },
      })
      return { ...state, tool: null }
    }

    if (state.textItem) {
      writeCodexSse(res, 'response.output_item.done', {
        type: 'response.output_item.done',
        output_index: state.textItem.index,
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: state.textItem.text }],
          phase: 'final_answer',
        },
      })
      return { ...state, textItem: null }
    }
  }

  if (event.type === 'message_stop') {
    writeCodexSse(res, 'response.completed', {
      type: 'response.completed',
      response: { id: `resp_${Date.now()}`, model, status: 'completed' },
    })
  }

  return state
}

function sendResponsesError(res: ExpressResponse, status: number, type: string, message: string): void {
  res.status(status).json({ error: { type, message } })
}
