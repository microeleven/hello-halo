/**
 * Shared types for the Codex engine adapter.
 */

export interface CodexSdkModule {
  tool: (...args: any[]) => any
  createSdkMcpServer: (options: any) => any
  createSession: (options: Record<string, any>) => Promise<any>
  query: (params: any) => AsyncIterable<any>
}

export interface CodexModuleRuntime {
  Codex: new (options?: any) => any
}

export interface CodexUsage {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
}

export interface CodexThreadEvent {
  type: string
  thread_id?: string
  usage?: CodexUsage
  error?: { message?: string } | string
  message?: string
  item?: CodexThreadItem
}

export interface CodexThreadItem {
  id?: string
  type: string
  text?: string
  command?: string
  aggregated_output?: string
  exit_code?: number
  status?: string
  changes?: Array<{ path: string; kind: string }>
  server?: string
  tool?: string
  arguments?: unknown
  result?: {
    content?: Array<Record<string, unknown>>
    structured_content?: unknown
  }
  error?: { message?: string } | string
  query?: string
  items?: Array<{ text: string; completed: boolean }>
  message?: string
}

export interface SdkMcpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
  handler: (args: any, extra: unknown) => Promise<any>
}

export interface SdkMcpServerInstance {
  readonly name: string
  readonly version: string
  readonly tools: ReadonlyArray<SdkMcpToolDefinition>
  callTool(name: string, args: Record<string, unknown>): Promise<any | undefined>
  listTools(): Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    annotations?: Record<string, unknown>
  }>
}

export interface SdkMcpServerConfigWithInstance {
  type: 'sdk'
  name: string
  instance: SdkMcpServerInstance
}
