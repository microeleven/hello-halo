/**
 * @module tools/mcp/client
 * MCP client — manages the lifecycle of a single MCP server connection.
 *
 * Handles the initialize handshake, tool discovery, and tool invocation
 * following the MCP protocol (version 2024-11-05).
 *
 * @license MIT
 */

import type {
  McpTransport,
  JsonRpcRequest,
  JsonRpcNotification,
} from './jsonrpc.js';

// ---------------------------------------------------------------------------
// MCP protocol constants
// ---------------------------------------------------------------------------

const MCP_PROTOCOL_VERSION = '2024-11-05';
const CLIENT_NAME = 'agent-core-sdk';
const CLIENT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// MCP types
// ---------------------------------------------------------------------------

export interface McpServerCapabilities {
  tools?: Record<string, unknown>;
  resources?: Record<string, unknown>;
  prompts?: Record<string, unknown>;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpCallToolResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    [key: string]: unknown;
  }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

/**
 * A client for communicating with a single MCP server.
 *
 * Usage:
 * ```ts
 * const transport = new StdioTransport({ command: 'my-mcp-server' });
 * await transport.connect();
 * const client = new McpClient(transport, 'my-server');
 * await client.initialize();
 * const tools = client.getTools();
 * const result = await client.callTool('myTool', { arg: 'value' });
 * client.close();
 * ```
 */
export class McpClient {
  private nextId = 1;
  private capabilities: McpServerCapabilities | null = null;
  private serverInfo: McpServerInfo | null = null;
  private tools: McpToolDefinition[] = [];
  private _initialized = false;

  constructor(
    private readonly transport: McpTransport,
    private readonly serverName: string,
  ) {}

  get initialized(): boolean {
    return this._initialized;
  }

  getServerInfo(): McpServerInfo | null {
    return this.serverInfo;
  }

  getTools(): McpToolDefinition[] {
    return this.tools;
  }

  /**
   * Perform the MCP initialize handshake.
   * Must be called after the transport is connected.
   *
   * Sends `initialize` request, then `notifications/initialized`,
   * then optionally discovers tools if the server advertises tool support.
   */
  async initialize(): Promise<void> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          roots: { listChanged: false },
        },
        clientInfo: {
          name: CLIENT_NAME,
          version: CLIENT_VERSION,
        },
      },
    };

    const response = await this.transport.send(request);

    if (response.error) {
      throw new Error(
        `MCP initialize failed for "${this.serverName}": ${response.error.message}`,
      );
    }

    const result = response.result as {
      protocolVersion?: string;
      capabilities?: McpServerCapabilities;
      serverInfo?: McpServerInfo;
    } | undefined;

    this.capabilities = result?.capabilities ?? {};
    this.serverInfo = result?.serverInfo ?? {
      name: this.serverName,
      version: 'unknown',
    };

    // Send initialized notification (no response expected)
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };
    await this.transport.notify(notification);

    this._initialized = true;

    // Discover tools if server supports them
    if (this.capabilities?.tools) {
      await this.discoverTools();
    }
  }

  /**
   * Discover available tools via `tools/list`.
   */
  private async discoverTools(): Promise<void> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/list',
    };

    const response = await this.transport.send(request);

    if (response.error) {
      // Non-fatal: warn and continue without tools
      console.warn(
        `[MCP] tools/list failed for "${this.serverName}": ${response.error.message}`,
      );
      return;
    }

    const result = response.result as {
      tools?: McpToolDefinition[];
    } | undefined;

    this.tools = result?.tools ?? [];
  }

  /**
   * Call a tool on the MCP server.
   *
   * @param toolName - The tool name (without server prefix)
   * @param args - Tool arguments
   * @returns The tool result with content blocks
   */
  async callTool(
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<McpCallToolResult> {
    if (!this._initialized) {
      return {
        content: [{ type: 'text', text: `MCP server "${this.serverName}" not initialized` }],
        isError: true,
      };
    }

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const response = await this.transport.send(request);

    if (response.error) {
      return {
        content: [{
          type: 'text',
          text: `MCP tool error (${this.serverName}/${toolName}): ${response.error.message}`,
        }],
        isError: true,
      };
    }

    return (response.result as McpCallToolResult) ?? {
      content: [{ type: 'text', text: '' }],
      isError: false,
    };
  }

  /**
   * Close the client and its underlying transport.
   */
  close(): void {
    this.transport.close();
    this._initialized = false;
    this.tools = [];
  }
}
