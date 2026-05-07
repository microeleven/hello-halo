import { describe, expect, it } from 'vitest'
import { CodexEventNormalizer } from '../event-normalizer'

function createNormalizer(): CodexEventNormalizer {
  return new CodexEventNormalizer({
    sessionId: 'session-1',
    model: 'test-model',
    mcpServers: {},
  })
}

function streamEvents(messages: any[]): any[] {
  return messages.filter((m) => m?.type === 'stream_event').map((m) => m.event)
}

describe('CodexEventNormalizer', () => {
  it('wraps text deltas in a Claude Code message envelope', () => {
    const normalizer = createNormalizer()

    const turnStart = streamEvents(normalizer.normalize({ type: 'turn.started' }))
    const started = streamEvents(normalizer.normalize({
      type: 'item.started',
      item: { id: 'msg-1', type: 'agent_message', text: '' },
    }))
    const updated = streamEvents(normalizer.normalize({
      type: 'item.updated',
      item: { id: 'msg-1', type: 'agent_message', text: '你好' },
    }))
    const completed = streamEvents(normalizer.normalize({
      type: 'item.completed',
      item: { id: 'msg-1', type: 'agent_message', text: '你好，Halo' },
    }))

    expect(turnStart[0]).toMatchObject({
      type: 'message_start',
      message: { role: 'assistant', model: 'test-model' },
    })
    expect(started).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ])
    expect(updated).toEqual([
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
    ])
    expect(completed).toEqual([
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '，Halo' } },
      { type: 'content_block_stop', index: 0 },
    ])
  })

  it('emits message_delta + message_stop + result on turn.completed and marks the normalizer terminal', () => {
    const normalizer = createNormalizer()
    normalizer.normalize({ type: 'turn.started' })
    normalizer.normalize({
      type: 'item.completed',
      item: { id: 'msg-1', type: 'agent_message', text: '完整回复' },
    })
    const completed = normalizer.normalize({
      type: 'turn.completed',
      usage: { input_tokens: 11, cached_input_tokens: 3, output_tokens: 22, reasoning_output_tokens: 0 },
    })

    const events = streamEvents(completed)
    expect(events).toEqual([
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 },
      },
      { type: 'message_stop' },
    ])
    expect(completed[completed.length - 1]).toMatchObject({
      type: 'result',
      subtype: 'success',
      result: '完整回复',
      is_error: false,
      usage: { input_tokens: 11, output_tokens: 22 },
    })
    expect(normalizer.isTerminal()).toBe(true)
  })

  it('uses stop_reason=tool_use when the turn contained a tool call', () => {
    const normalizer = createNormalizer()
    normalizer.normalize({ type: 'turn.started' })
    normalizer.normalize({
      type: 'item.started',
      item: { id: 'item_1', type: 'command_execution', command: 'pwd', aggregated_output: '', status: 'in_progress' },
    })
    normalizer.normalize({
      type: 'item.completed',
      item: { id: 'item_1', type: 'command_execution', command: 'pwd', aggregated_output: '/tmp\n', status: 'completed' },
    })
    const completed = streamEvents(normalizer.normalize({
      type: 'turn.completed',
      usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2, reasoning_output_tokens: 0 },
    }))

    expect(completed[0]).toMatchObject({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
    })
  })

  it('emits a synthetic message envelope when SDK skips turn.started', () => {
    const normalizer = createNormalizer()

    const messages = normalizer.normalize({
      type: 'item.completed',
      item: { id: 'msg-1', type: 'agent_message', text: '完整回复' },
    })

    expect(messages[0]).toMatchObject({ type: 'system', subtype: 'init' })
    expect(messages[1]).toMatchObject({ type: 'stream_event', event: { type: 'message_start' } })
    expect(streamEvents(messages).slice(1)).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '完整回复' } },
      { type: 'content_block_stop', index: 0 },
    ])
  })

  it('maps Codex command execution to tool_use stream + tool_result', () => {
    const normalizer = createNormalizer()
    normalizer.normalize({ type: 'turn.started' })

    const started = normalizer.normalize({
      type: 'item.started',
      item: { id: 'item_1', type: 'command_execution', command: 'pwd', aggregated_output: '', status: 'in_progress' },
    })
    const completed = normalizer.normalize({
      type: 'item.completed',
      item: { id: 'item_1', type: 'command_execution', command: 'pwd', aggregated_output: '/tmp\n', status: 'completed' },
    })

    expect(streamEvents(started)).toEqual([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'item_1', name: 'Bash', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"pwd"}' } },
      { type: 'content_block_stop', index: 0 },
    ])
    expect(completed).toEqual([{
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'item_1', content: '/tmp\n', is_error: false }],
      },
    }])
  })

  it('emits result + marks terminal on turn.failed', () => {
    const normalizer = createNormalizer()
    normalizer.normalize({ type: 'turn.started' })

    const failed = normalizer.normalize({
      type: 'turn.failed',
      error: { message: 'boom' },
    })

    expect(failed[failed.length - 1]).toMatchObject({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: 'boom',
    })
    expect(normalizer.isTerminal()).toBe(true)
  })

  it('resetTurn clears terminal so a reused normalizer can drive the next turn', () => {
    const normalizer = createNormalizer()
    normalizer.normalize({ type: 'turn.started' })
    normalizer.normalize({
      type: 'item.completed',
      item: { id: 'msg-1', type: 'agent_message', text: 'first' },
    })
    normalizer.normalize({
      type: 'turn.completed',
      usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
    })
    expect(normalizer.isTerminal()).toBe(true)

    // Codex CLI on a resumed thread sometimes does not emit turn.started; the
    // adapter calls resetTurn() before each runStreamed to clear stale state.
    normalizer.resetTurn()
    expect(normalizer.isTerminal()).toBe(false)

    const second = normalizer.normalize({
      type: 'item.completed',
      item: { id: 'msg-2', type: 'agent_message', text: 'second' },
    })
    // Lazy envelope opens on first item, terminal stays false until next turn.completed
    expect(second.find((m: any) => m?.event?.type === 'message_start')).toBeTruthy()
    expect(normalizer.isTerminal()).toBe(false)
  })
})
