/**
 * Provider Adapters Unit Tests
 */

import { describe, it, expect } from 'vitest'
import {
  findAdapter,
  deepSeekAdapter,
  groqAdapter,
  openRouterAdapter,
  moonshotAdapter,
  zhipuAdapter
} from '../../../src/main/openai-compat-router/server/provider-adapters'
import type { AdapterContext } from '../../../src/main/openai-compat-router/server/provider-adapters'
import type { AnthropicRequest } from '../../../src/main/openai-compat-router/types'

// ============================================================================
// Helpers
// ============================================================================

function makeContext(messages: AnthropicRequest['messages']): AdapterContext {
  return {
    originalRequest: {
      model: 'test-model',
      messages,
      max_tokens: 1024
    } as AnthropicRequest
  }
}

// ============================================================================
// DeepSeek Adapter
// ============================================================================

describe('deepSeekAdapter', () => {
  describe('match', () => {
    it('matches api.deepseek.com URLs', () => {
      expect(deepSeekAdapter.match('https://api.deepseek.com/v1')).toBe(true)
      expect(deepSeekAdapter.match('https://api.deepseek.com/v1/chat/completions')).toBe(true)
    })

    it('does not match other URLs', () => {
      expect(deepSeekAdapter.match('https://api.openai.com/v1')).toBe(false)
      expect(deepSeekAdapter.match('https://openrouter.ai/api/v1')).toBe(false)
    })
  })

  it('has no transformRequest — converter produces spec-compliant output by default', () => {
    expect(deepSeekAdapter.transformRequest).toBeUndefined()
  })
})

// ============================================================================
// Moonshot Adapter
// ============================================================================

describe('moonshotAdapter', () => {
  describe('match', () => {
    it('matches api.moonshot.cn URLs', () => {
      expect(moonshotAdapter.match('https://api.moonshot.cn/v1')).toBe(true)
      expect(moonshotAdapter.match('https://api.moonshot.cn/v1/chat/completions')).toBe(true)
    })

    it('matches api.moonshot.ai URLs', () => {
      expect(moonshotAdapter.match('https://api.moonshot.ai/v1')).toBe(true)
    })

    it('does not match other URLs', () => {
      expect(moonshotAdapter.match('https://api.deepseek.com/v1')).toBe(false)
      expect(moonshotAdapter.match('https://api.openai.com/v1')).toBe(false)
    })
  })

  describe('transformRequest — injects reasoning_content from thinking blocks', () => {
    it('adds reasoning_content to assistant messages that have thinking blocks', () => {
      const body: Record<string, unknown> = {
        model: 'moonshot-v1-128k',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'user', content: 'How are you?' }
        ]
      }

      const context = makeContext([
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'The user greeted me, I should respond warmly.' },
            { type: 'text', text: 'Hi there' }
          ]
        },
        { role: 'user', content: 'How are you?' }
      ])

      moonshotAdapter.transformRequest!(body, context)

      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[1]).toHaveProperty('reasoning_content', 'The user greeted me, I should respond warmly.')
      expect(messages[1].content).toBe('Hi there')
    })

    it('does not add reasoning_content when assistant has no thinking blocks', () => {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' }
        ]
      }

      const context = makeContext([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] }
      ])

      moonshotAdapter.transformRequest!(body, context)

      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[1]).not.toHaveProperty('reasoning_content')
    })

    it('handles multiple thinking turns in sequence', () => {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'user', content: 'Q1' },
          { role: 'assistant', content: 'A1' },
          { role: 'user', content: 'Q2' },
          { role: 'assistant', content: 'A2' }
        ]
      }

      const context = makeContext([
        { role: 'user', content: 'Q1' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'thinking-1' },
            { type: 'text', text: 'A1' }
          ]
        },
        { role: 'user', content: 'Q2' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'thinking-2' },
            { type: 'text', text: 'A2' }
          ]
        }
      ])

      moonshotAdapter.transformRequest!(body, context)

      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[1]).toHaveProperty('reasoning_content', 'thinking-1')
      expect(messages[3]).toHaveProperty('reasoning_content', 'thinking-2')
    })

    it('joins multiple thinking blocks within one turn', () => {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'user', content: 'Q' },
          { role: 'assistant', content: 'A' }
        ]
      }

      const context = makeContext([
        { role: 'user', content: 'Q' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'part-1' },
            { type: 'thinking', thinking: 'part-2' },
            { type: 'text', text: 'A' }
          ]
        }
      ])

      moonshotAdapter.transformRequest!(body, context)

      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[1].reasoning_content).toBe('part-1\npart-2')
    })

    it('handles missing context gracefully', () => {
      const body: Record<string, unknown> = {
        messages: [{ role: 'assistant', content: 'Hi' }]
      }
      expect(() => moonshotAdapter.transformRequest!(body, undefined)).not.toThrow()
      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[0]).not.toHaveProperty('reasoning_content')
    })

    it('handles empty messages array', () => {
      const body: Record<string, unknown> = { messages: [] }
      const context = makeContext([])
      expect(() => moonshotAdapter.transformRequest!(body, context)).not.toThrow()
    })

    it('does not touch user messages', () => {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' }
        ]
      }

      const context = makeContext([
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'some thought' },
            { type: 'text', text: 'Hi' }
          ]
        }
      ])

      moonshotAdapter.transformRequest!(body, context)

      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[0]).not.toHaveProperty('reasoning_content')
    })
  })
})

// ============================================================================
// Zhipu AI (GLM) Adapter
// ============================================================================

describe('zhipuAdapter', () => {
  describe('match', () => {
    it('matches open.bigmodel.cn URLs', () => {
      expect(zhipuAdapter.match('https://open.bigmodel.cn/api/paas/v4')).toBe(true)
      expect(zhipuAdapter.match('https://open.bigmodel.cn/api/paas/v4/chat/completions')).toBe(true)
    })

    it('does not match other URLs', () => {
      expect(zhipuAdapter.match('https://api.deepseek.com/v1')).toBe(false)
      expect(zhipuAdapter.match('https://api.moonshot.cn/v1')).toBe(false)
    })
  })

  describe('transformRequest — injects reasoning_content from thinking blocks', () => {
    it('adds reasoning_content to assistant messages that have thinking blocks', () => {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' }
        ]
      }

      const context = makeContext([
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'GLM reasoning trace.' },
            { type: 'text', text: 'Hi' }
          ]
        }
      ])

      zhipuAdapter.transformRequest!(body, context)

      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[1]).toHaveProperty('reasoning_content', 'GLM reasoning trace.')
    })

    it('handles multiple turns correctly', () => {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'user', content: 'Q1' },
          { role: 'assistant', content: 'A1' },
          { role: 'user', content: 'Q2' },
          { role: 'assistant', content: 'A2' }
        ]
      }

      const context = makeContext([
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 't1' }, { type: 'text', text: 'A1' }] },
        { role: 'user', content: 'Q2' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 't2' }, { type: 'text', text: 'A2' }] }
      ])

      zhipuAdapter.transformRequest!(body, context)

      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[1]).toHaveProperty('reasoning_content', 't1')
      expect(messages[3]).toHaveProperty('reasoning_content', 't2')
    })

    it('handles missing context gracefully', () => {
      const body: Record<string, unknown> = {
        messages: [{ role: 'assistant', content: 'Hi' }]
      }
      expect(() => zhipuAdapter.transformRequest!(body, undefined)).not.toThrow()
      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[0]).not.toHaveProperty('reasoning_content')
    })
  })
})

// ============================================================================
// Groq Adapter
// ============================================================================

describe('groqAdapter', () => {
  it('converts temperature 0 to 0.01', () => {
    const body: Record<string, unknown> = { temperature: 0 }
    groqAdapter.transformRequest!(body)
    expect(body.temperature).toBe(0.01)
  })

  it('leaves non-zero temperature unchanged', () => {
    const body: Record<string, unknown> = { temperature: 0.7 }
    groqAdapter.transformRequest!(body)
    expect(body.temperature).toBe(0.7)
  })
})

// ============================================================================
// findAdapter
// ============================================================================

describe('findAdapter', () => {
  it('finds deepseek adapter by URL', () => {
    const adapter = findAdapter('https://api.deepseek.com/v1')
    expect(adapter?.id).toBe('deepseek')
  })

  it('finds deepseek adapter by explicit adapterId', () => {
    const adapter = findAdapter('https://some-third-party.com/v1', 'deepseek')
    expect(adapter?.id).toBe('deepseek')
  })

  it('finds moonshot adapter by URL (cn)', () => {
    const adapter = findAdapter('https://api.moonshot.cn/v1')
    expect(adapter?.id).toBe('moonshot')
  })

  it('finds moonshot adapter by URL (ai)', () => {
    const adapter = findAdapter('https://api.moonshot.ai/v1')
    expect(adapter?.id).toBe('moonshot')
  })

  it('finds moonshot adapter by explicit adapterId', () => {
    const adapter = findAdapter('https://some-third-party.com/v1', 'moonshot')
    expect(adapter?.id).toBe('moonshot')
  })

  it('finds zhipu adapter by URL', () => {
    const adapter = findAdapter('https://open.bigmodel.cn/api/paas/v4')
    expect(adapter?.id).toBe('zhipu')
  })

  it('finds zhipu adapter by explicit adapterId', () => {
    const adapter = findAdapter('https://some-proxy.com/v1', 'zhipu')
    expect(adapter?.id).toBe('zhipu')
  })

  it('finds groq adapter by URL', () => {
    const adapter = findAdapter('https://api.groq.com/openai/v1')
    expect(adapter?.id).toBe('groq')
  })

  it('finds openrouter adapter by URL', () => {
    const adapter = findAdapter('https://openrouter.ai/api/v1')
    expect(adapter?.id).toBe('openrouter')
  })

  it('returns undefined for unknown URL without adapterId', () => {
    const adapter = findAdapter('https://unknown.example.com/v1')
    expect(adapter).toBeUndefined()
  })
})
