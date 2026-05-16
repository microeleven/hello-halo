/**
 * Shared types for the Codex engine adapter.
 *
 * The protocol-level types (thread events / items / notifications) live in
 * `./types/codex-protocol.ts` and `./types/jsonrpc.ts`. This file holds only
 * the small Halo-facing facade types (SdkModule shape, MCP server tool defs).
 */

import type { EngineCapabilities } from '../capabilities'

export interface CodexSdkModule {
  tool: (...args: any[]) => any
  createSdkMcpServer: (options: any) => any
  createSession: (options: Record<string, any>) => Promise<any>
  query: (params: any) => AsyncIterable<any>
  /** Engine capability descriptor consumed by the IPC capabilities channel. */
  capabilities: EngineCapabilities
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
