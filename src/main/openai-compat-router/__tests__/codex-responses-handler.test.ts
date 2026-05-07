/**
 * Unit tests for Codex Responses compatibility helpers.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/halo-test',
    getName: () => 'Halo',
    getVersion: () => '1.0.0-test'
  },
  session: {
    defaultSession: {
      resolveProxy: vi.fn(async () => 'DIRECT')
    },
    fromPartition: vi.fn(() => ({ setProxy: vi.fn(async () => undefined) }))
  }
}))
import {
  anthropicToCodexResponse,
  codexResponsesToAnthropicRequest,
  createCodexStreamBridgeForTest
} from '../server/codex-responses-handler'

describe('Codex Responses compatibility', () => {
  it('converts Codex Responses text input and developer instructions to Anthropic format', () => {
    const request = codexResponsesToAnthropicRequest({
      model: 'gpt-5.1-codex-max',
      instructions: 'Runtime instructions',
      input: [
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'Developer policy' }]
        },
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }]
        }
      ],
      stream: true
    })

    expect(request.model).toBe('gpt-5.1-codex-max')
    expect(request.system).toBe('Runtime instructions\n\nDeveloper policy')
    expect(request.stream).toBe(true)
    expect(request.messages).toEqual([{ role: 'user', content: 'Hello' }])
  })

  it('converts Codex function calls and outputs into Anthropic tool turns', () => {
    const request = codexResponsesToAnthropicRequest({
      model: 'gpt-5.1-codex-max',
      input: [
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"/tmp/a.txt"}'
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'file body'
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: { path: { type: 'string' } } }
          }
        }
      ],
      tool_choice: 'auto',
      reasoning: { effort: 'medium' }
    })

    expect(request.tools).toEqual([
      {
        name: 'read_file',
        description: 'Read a file',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
        strict: undefined
      }
    ])
    expect(request.tool_choice).toEqual({ type: 'auto' })
    expect(request.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 })
    expect(request.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: '/tmp/a.txt' } }]
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'file body' }]
      }
    ])
  })
  it('converts Anthropic content blocks back to Codex Responses output items', () => {
    const response = anthropicToCodexResponse({
      id: 'msg_1',
      model: 'provider-model',
      content: [
        { type: 'thinking', thinking: 'reasoning' },
        { type: 'text', text: 'answer' },
        { type: 'tool_use', id: 'toolu_1', name: 'write_file', input: { path: 'a.txt' } }
      ],
      usage: { input_tokens: 7, output_tokens: 11 }
    }, 'fallback-model') as any

    expect(response.object).toBe('response')
    expect(response.model).toBe('provider-model')
    expect(response.usage).toEqual({ input_tokens: 7, output_tokens: 11, total_tokens: 18 })
    expect(response.output).toEqual([
      {
        id: expect.stringMatching(/^rs_/),
        type: 'reasoning',
        status: 'completed',
        summary: [{ type: 'output_text', text: 'reasoning' }]
      },
      {
        id: expect.stringMatching(/^msg_/),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'answer' }]
      },
      {
        id: 'toolu_1',
        type: 'function_call',
        status: 'completed',
        name: 'write_file',
        call_id: 'toolu_1',
        arguments: '{"path":"a.txt"}'
      }
    ])
  })

  it('bridges Anthropic text stream into Codex message item events', () => {
    const chunks: string[] = []
    const res = {
      write: (chunk: unknown) => {
        chunks.push(String(chunk))
        return true
      },
      end: vi.fn(),
      setHeader: vi.fn(),
      status: vi.fn(),
    }
    const bridge = createCodexStreamBridgeForTest(res as any, 'test-model') as any

    bridge.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n')
    bridge.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n')
    bridge.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n')
    bridge.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n')
    bridge.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    bridge.end()

    const body = chunks.join('')
    expect(body).toContain('event: response.output_item.added')
    expect(body).toContain('event: response.output_text.delta')
    expect(body).toContain('event: response.output_item.done')
    expect(body).toContain('event: response.completed')
    expect(body).toContain('"type":"message"')
    expect(body).toContain('"text":"你好"')
  })
})
