/**
 * Provider Adapters Unit Tests
 */

import { describe, it, expect } from 'vitest'
import { findAdapter, deepSeekAdapter, groqAdapter, openRouterAdapter } from '../../../src/main/openai-compat-router/server/provider-adapters'

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

  describe('transformRequest — strips reasoning_content', () => {
    it('removes reasoning_content from assistant messages', () => {
      const body: Record<string, unknown> = {
        model: 'deepseek-reasoner',
        messages: [
          { role: 'user', content: 'Hello' },
          {
            role: 'assistant',
            content: 'Hi there',
            reasoning_content: 'The user said hello, I should respond politely.'
          },
          { role: 'user', content: 'How are you?' }
        ]
      }

      deepSeekAdapter.transformRequest!(body)

      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[1]).not.toHaveProperty('reasoning_content')
      expect(messages[1].content).toBe('Hi there')
      expect(messages[1].role).toBe('assistant')
    })

    it('does not remove reasoning_content from non-assistant messages', () => {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'user', content: 'Hello', reasoning_content: 'should be kept' }
        ]
      }

      deepSeekAdapter.transformRequest!(body)

      const messages = body.messages as Array<Record<string, unknown>>
      // user messages are left untouched
      expect(messages[0]).toHaveProperty('reasoning_content', 'should be kept')
    })

    it('handles messages with no reasoning_content gracefully', () => {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' }
        ]
      }

      expect(() => deepSeekAdapter.transformRequest!(body)).not.toThrow()
      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[1].content).toBe('Hi')
    })

    it('handles empty messages array', () => {
      const body: Record<string, unknown> = { messages: [] }
      expect(() => deepSeekAdapter.transformRequest!(body)).not.toThrow()
    })

    it('handles missing messages field', () => {
      const body: Record<string, unknown> = { model: 'deepseek-chat' }
      expect(() => deepSeekAdapter.transformRequest!(body)).not.toThrow()
    })

    it('strips reasoning_content from multiple assistant turns', () => {
      const body: Record<string, unknown> = {
        messages: [
          { role: 'user', content: 'Q1' },
          { role: 'assistant', content: 'A1', reasoning_content: 'r1' },
          { role: 'user', content: 'Q2' },
          { role: 'assistant', content: 'A2', reasoning_content: 'r2' }
        ]
      }

      deepSeekAdapter.transformRequest!(body)

      const messages = body.messages as Array<Record<string, unknown>>
      expect(messages[1]).not.toHaveProperty('reasoning_content')
      expect(messages[3]).not.toHaveProperty('reasoning_content')
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
    // adapterId takes precedence over URL
    const adapter = findAdapter('https://some-third-party.com/v1', 'deepseek')
    expect(adapter?.id).toBe('deepseek')
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
