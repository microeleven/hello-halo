import http, { type IncomingMessage, type ServerResponse } from 'http'
import { AddressInfo } from 'net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'

interface SdkMcpServerInstance {
  readonly name?: string
  readonly version?: string
  callTool(name: string, args: Record<string, unknown>): Promise<any | undefined>
  listTools(): Array<{
    name: string
    description?: string
    inputSchema?: Record<string, unknown>
    annotations?: Record<string, unknown>
  }>
}

export interface CodexMcpServerConfig {
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  bearer_token_env_var?: string
}

export interface PreparedCodexMcpServers {
  mcpServers: Record<string, CodexMcpServerConfig>
  bridge?: CodexSdkMcpBridge
  injectedServerNames: string[]
  skippedServerNames: string[]
}

export async function prepareCodexMcpServers(
  servers: Record<string, any> | undefined,
): Promise<PreparedCodexMcpServers> {
  const mcpServers: Record<string, CodexMcpServerConfig> = {}
  const sdkServers: Record<string, SdkMcpServerInstance> = {}
  const skippedServerNames: string[] = []

  for (const [name, server] of Object.entries(servers || {})) {
    if (isSdkMcpServer(server)) {
      sdkServers[name] = server.instance
      continue
    }

    const translated = translateExternalMcpServer(server)
    if (translated) {
      mcpServers[name] = translated
    } else {
      skippedServerNames.push(name)
    }
  }

  let bridge: CodexSdkMcpBridge | undefined
  if (Object.keys(sdkServers).length > 0) {
    bridge = new CodexSdkMcpBridge(sdkServers)
    const bridgeConfig = await bridge.start()
    for (const [name, config] of Object.entries(bridgeConfig)) {
      mcpServers[name] = config
    }
  }

  return {
    mcpServers,
    bridge,
    injectedServerNames: Object.keys(mcpServers),
    skippedServerNames,
  }
}

export function translateExternalMcpServer(server: any): CodexMcpServerConfig | null {
  if (!server || typeof server !== 'object') return null

  const type = typeof server.type === 'string' ? server.type : undefined
  if (typeof server.url === 'string' && server.url.trim()) {
    if (type === 'sse') {
      console.warn('[Codex][mcp] SSE MCP servers are not injected because Codex app-server accepts stdio or streamable HTTP MCP config.')
      return null
    }
    const config: CodexMcpServerConfig = { url: server.url }
    const headers = normalizeStringRecord(server.headers)
    const bearerTokenEnvVar = findBearerTokenEnvVar(headers)
    if (bearerTokenEnvVar) config.bearer_token_env_var = bearerTokenEnvVar
    return config
  }

  if (typeof server.command === 'string' && server.command.trim()) {
    if (/^https?:\/\//i.test(server.command)) {
      if (type === 'sse') {
        console.warn('[Codex][mcp] SSE MCP servers are not injected because Codex app-server accepts stdio or streamable HTTP MCP config.')
        return null
      }
      return { url: server.command }
    }

    const config: CodexMcpServerConfig = { command: server.command }
    if (Array.isArray(server.args)) config.args = server.args.map(String)
    if (typeof server.cwd === 'string' && server.cwd.trim()) config.cwd = server.cwd
    const env = normalizeStringRecord(server.env)
    if (Object.keys(env).length > 0) config.env = env
    return config
  }

  return null
}

export class CodexSdkMcpBridge {
  private server: http.Server | null = null
  private port: number | null = null

  constructor(private readonly sdkServers: Record<string, SdkMcpServerInstance>) {}

  async start(): Promise<Record<string, CodexMcpServerConfig>> {
    if (this.server && this.port) return this.configs()

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((err) => {
        console.error('[Codex][mcp] bridge request failed:', err)
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('MCP bridge request failed')
      })
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })

    this.port = (this.server.address() as AddressInfo).port
    console.log(`[Codex][mcp] SDK MCP bridge listening on 127.0.0.1:${this.port} for [${Object.keys(this.sdkServers).join(', ')}]`)
    return this.configs()
  }

  async close(): Promise<void> {
    const server = this.server
    this.server = null
    this.port = null
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private configs(): Record<string, CodexMcpServerConfig> {
    const configs: Record<string, CodexMcpServerConfig> = {}
    for (const name of Object.keys(this.sdkServers)) {
      configs[name] = { url: `http://127.0.0.1:${this.port}/mcp/${encodeURIComponent(name)}` }
    }
    return configs
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const name = decodeURIComponent((req.url || '').split('?')[0].replace(/^\/mcp\//, ''))
    const instance = this.sdkServers[name]
    if (!instance) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Unknown MCP server')
      return
    }

    const mcpServer = createMcpServerForInstance(name, instance)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await mcpServer.connect(transport)
    res.on('close', () => {
      void mcpServer.close().catch(() => {})
    })
    await transport.handleRequest(req, res)
  }
}

function createMcpServerForInstance(name: string, instance: SdkMcpServerInstance): Server {
  const server = new Server(
    { name, version: instance.version || '1.0.0' },
    { capabilities: { tools: { listChanged: false } } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: instance.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: normalizeJsonSchema(tool.inputSchema),
      annotations: tool.annotations as any,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const result = await instance.callTool(request.params.name, request.params.arguments || {})
    return normalizeToolResult(result)
  })

  return server
}

function normalizeToolResult(result: any): CallToolResult {
  if (result && typeof result === 'object' && Array.isArray(result.content)) return result
  if (result === undefined) {
    return { content: [{ type: 'text', text: 'Tool returned no result.' }], isError: true }
  }
  return {
    content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
  }
}

function normalizeJsonSchema(schema: any): Record<string, unknown> {
  if (schema && typeof schema === 'object') return schema
  return { type: 'object', properties: {}, additionalProperties: true }
}

function isSdkMcpServer(server: any): server is { type: 'sdk'; instance: SdkMcpServerInstance } {
  return server?.type === 'sdk'
    && server.instance
    && typeof server.instance.listTools === 'function'
    && typeof server.instance.callTool === 'function'
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, String(v)]),
  )
}

function findBearerTokenEnvVar(headers: Record<string, string>): string | undefined {
  const authorization = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')?.[1]
  const match = authorization?.match(/^Bearer\s+\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/)
  return match?.[1]
}
