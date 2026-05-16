import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { prepareCodexMcpServers, translateExternalMcpServer } from '../../../src/main/services/agent/codex/mcp-bridge'

describe('codex MCP bridge config translation', () => {
  it('translates stdio MCP servers to Codex mcp_servers entries', () => {
    expect(translateExternalMcpServer({
      command: 'node',
      args: ['server.js'],
      cwd: '/tmp/project',
      env: { TOKEN: 'secret', COUNT: 1 },
    })).toEqual({
      command: 'node',
      args: ['server.js'],
      cwd: '/tmp/project',
      env: { TOKEN: 'secret', COUNT: '1' },
    })
  })

  it('translates streamable HTTP MCP servers to Codex url entries', () => {
    expect(translateExternalMcpServer({
      type: 'http',
      url: 'https://example.com/mcp',
    })).toEqual({ url: 'https://example.com/mcp' })
  })

  it('converts authorization bearer env placeholders for Codex HTTP MCP config', () => {
    expect(translateExternalMcpServer({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer ${EXAMPLE_TOKEN}' },
    })).toEqual({
      url: 'https://example.com/mcp',
      bearer_token_env_var: 'EXAMPLE_TOKEN',
    })
  })

  it('skips SSE MCP servers because Codex app-server does not accept SSE config', () => {
    expect(translateExternalMcpServer({
      type: 'sse',
      url: 'https://example.com/sse',
    })).toBeNull()
  })

  it('bridges SDK-backed MCP servers without exposing them to non-Codex SDK paths', async () => {
    const prepared = await prepareCodexMcpServers({
      local: {
        type: 'sdk',
        instance: {
          version: '1.0.0',
          listTools: () => [{ name: 'hello', description: 'Say hello', inputSchema: { type: 'object' } }],
          callTool: async () => ({ content: [{ type: 'text', text: 'hello' }] }),
        },
      },
    })

    try {
      expect(prepared.injectedServerNames).toEqual(['local'])
      expect(prepared.mcpServers.local.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/local$/)
      expect(prepared.bridge).toBeTruthy()
    } finally {
      await prepared.bridge?.close()
    }
  })

  it('serves SDK-backed MCP tools over standard Streamable HTTP', async () => {
    const prepared = await prepareCodexMcpServers({
      local: {
        type: 'sdk',
        instance: {
          version: '1.0.0',
          listTools: () => [{ name: 'hello', description: 'Say hello', inputSchema: { type: 'object', properties: {} } }],
          callTool: async () => ({ content: [{ type: 'text', text: 'hello from bridge' }] }),
        },
      },
    })

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    try {
      const transport = new StreamableHTTPClientTransport(new URL(prepared.mcpServers.local.url!))
      await client.connect(transport)

      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(['hello'])

      const result = await client.callTool({ name: 'hello', arguments: {} })
      expect(result.content).toEqual([{ type: 'text', text: 'hello from bridge' }])
    } finally {
      await client.close().catch(() => {})
      await prepared.bridge?.close()
    }
  })
})
