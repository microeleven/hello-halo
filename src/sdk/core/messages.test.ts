/**
 * Unit tests for message construction and extraction utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  buildUserMessage,
  buildToolResultMessage,
  extractToolUseBlocks,
  messageTokenEstimate,
  messagesToTokenCount,
} from './messages.js';
import type { Message, ToolUseBlock } from '../types/provider.js';

// ---------------------------------------------------------------------------
// buildUserMessage
// ---------------------------------------------------------------------------

describe('buildUserMessage', () => {
  it('wraps string content in a user message', () => {
    const msg = buildUserMessage('Hello');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
  });

  it('wraps content block array in a user message', () => {
    const blocks = [{ type: 'text' as const, text: 'hi' }];
    const msg = buildUserMessage(blocks);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe(blocks);
  });
});

// ---------------------------------------------------------------------------
// buildToolResultMessage
// ---------------------------------------------------------------------------

describe('buildToolResultMessage', () => {
  it('builds a user message with tool_result blocks', () => {
    const msg = buildToolResultMessage([
      { toolUseId: 'tu1', content: 'result text', isError: false },
    ]);
    expect(msg.role).toBe('user');
    expect(Array.isArray(msg.content)).toBe(true);
    const blocks = msg.content as Array<Record<string, unknown>>;
    expect(blocks[0].type).toBe('tool_result');
    expect(blocks[0].tool_use_id).toBe('tu1');
    expect(blocks[0].content).toBe('result text');
    expect(blocks[0].is_error).toBeUndefined(); // false → omitted
  });

  it('sets is_error to true for error results', () => {
    const msg = buildToolResultMessage([
      { toolUseId: 'tu2', content: 'error text', isError: true },
    ]);
    const blocks = msg.content as Array<Record<string, unknown>>;
    expect(blocks[0].is_error).toBe(true);
  });

  it('builds multiple tool result blocks', () => {
    const msg = buildToolResultMessage([
      { toolUseId: 'tu1', content: 'r1', isError: false },
      { toolUseId: 'tu2', content: 'r2', isError: false },
    ]);
    const blocks = msg.content as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tool_use_id).toBe('tu1');
    expect(blocks[1].tool_use_id).toBe('tu2');
  });
});

// ---------------------------------------------------------------------------
// extractToolUseBlocks
// ---------------------------------------------------------------------------

describe('extractToolUseBlocks', () => {
  it('returns empty array for string content', () => {
    const msg: Message = { role: 'assistant', content: 'just text' };
    expect(extractToolUseBlocks(msg)).toEqual([]);
  });

  it('returns empty array when no tool_use blocks', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'response' }],
    };
    expect(extractToolUseBlocks(msg)).toEqual([]);
  });

  it('extracts tool_use blocks from mixed content', () => {
    const toolBlock: ToolUseBlock = {
      type: 'tool_use',
      id: 'tu1',
      name: 'Bash',
      input: { command: 'ls' },
    };
    const msg: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will run a command' },
        toolBlock,
      ],
    };
    const result = extractToolUseBlocks(msg);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Bash');
    expect(result[0].id).toBe('tu1');
  });

  it('extracts multiple tool_use blocks', () => {
    const msg: Message = {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu1', name: 'Read', input: {} } as ToolUseBlock,
        { type: 'tool_use', id: 'tu2', name: 'Write', input: {} } as ToolUseBlock,
      ],
    };
    expect(extractToolUseBlocks(msg)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// messageTokenEstimate / messagesToTokenCount
// ---------------------------------------------------------------------------

describe('messageTokenEstimate', () => {
  it('returns a positive number for a text message', () => {
    const msg: Message = { role: 'user', content: 'Hello world, this is a test.' };
    expect(messageTokenEstimate(msg)).toBeGreaterThan(0);
  });

  it('returns a positive number for a block array message', () => {
    const msg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'A longer response with more tokens here.' }],
    };
    expect(messageTokenEstimate(msg)).toBeGreaterThan(0);
  });

  it('longer messages have higher token estimates', () => {
    const short: Message = { role: 'user', content: 'Hi' };
    const long: Message = { role: 'user', content: 'A'.repeat(10_000) };
    expect(messageTokenEstimate(long)).toBeGreaterThan(messageTokenEstimate(short));
  });
});

describe('messagesToTokenCount', () => {
  it('returns 0 for empty array', () => {
    expect(messagesToTokenCount([])).toBe(0);
  });

  it('returns sum of all message estimates', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'World' },
    ];
    const sum = msgs.reduce((acc, m) => acc + messageTokenEstimate(m), 0);
    expect(messagesToTokenCount(msgs)).toBe(sum);
  });
});
