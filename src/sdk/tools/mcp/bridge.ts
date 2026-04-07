/**
 * @module tools/mcp/bridge
 * Bridges MCP server tools into the query loop's Tool interface.
 *
 * Supports two modes:
 *
 * 1. **SDK (in-process)** — servers created by `createSdkMcpServer()`.
 *    Tools are resolved synchronously via `extractSdkMcpTools()`.
 *
 * 2. **External (stdio/sse/http)** — servers spawned or connected over the
 *    network. Tools are resolved asynchronously via `connectExternalMcpServers()`.
 *    Each server is connected, initialized (MCP handshake), and its tools
 *    are discovered and bridged into `Tool` instances.
 *
 * Tool names follow the MCP convention: `mcp__{serverName}__{toolName}`
 * (matching CC SDK behavior for MCP tool naming).
 *
 * @license MIT
 */

import type { Tool, ToolResult, ToolContext } from '../../types/tool.js';
import type { McpSdkServerConfigWithInstance, SdkMcpServerInstance } from './sdk-server.js';
import { McpClient, type McpToolDefinition } from './client.js';
import { StdioTransport, SSETransport, HttpTransport } from './transports.js';
import type { McpTransport } from './jsonrpc.js';

// ---------------------------------------------------------------------------
// MCP tool name conventions
// ---------------------------------------------------------------------------

/**
 * Build the namespaced tool name for an MCP tool.
 * Convention: `mcp__{server-name}__{tool-name}`
 *
 * Server names may contain hyphens (e.g. "halo-report"), which are
 * preserved as-is to match CC SDK behavior.
 */
function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

// =========================================================================
// Part 1: SDK (in-process) MCP servers
// =========================================================================

/**
 * Extract all tools from an SDK MCP server and wrap them as SDK `Tool`
 * objects that can be added to the query loop.
 *
 * @param serverConfig - The SDK server config with live instance
 * @returns Array of Tool objects
 */
export function bridgeSdkMcpTools(serverConfig: McpSdkServerConfigWithInstance): Tool[] {
  const { name: serverName, instance } = serverConfig;
  const mcpTools = instance.listTools();
  return mcpTools.map((mcpTool) =>
    createSdkBridgedTool(
      serverName,
      mcpTool as {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations?: Record<string, unknown>;
      },
      instance,
    ),
  );
}

/**
 * Create a single bridged Tool from an SDK MCP tool definition.
 */
function createSdkBridgedTool(
  serverName: string,
  mcpTool: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: Record<string, unknown>;
  },
  instance: SdkMcpServerInstance,
): Tool {
  const fullName = mcpToolName(serverName, mcpTool.name);

  return {
    name: fullName,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,
    // MCP tools are assumed to require execution-level permissions since
    // their capabilities are unknown to the SDK.
    permissionLevel: 'execute' as const,

    async execute(
      input: Record<string, unknown>,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const result = await instance.callTool(mcpTool.name, input);

      if (!result) {
        return {
          content: `MCP tool "${mcpTool.name}" not found on server "${serverName}".`,
          isError: true,
        };
      }

      return formatCallToolResult(result.content, result.isError);
    },
  };
}

// =========================================================================
// Part 2: External MCP servers (stdio/sse/http)
// =========================================================================

/** A connected external MCP server with its bridged tools. */
interface ConnectedExternalServer {
  name: string;
  client: McpClient;
  tools: Tool[];
}

/**
 * Result of connecting external MCP servers.
 * Holds the bridged tools and a disconnect function for cleanup.
 */
export interface ExternalMcpConnection {
  /** All bridged tools from connected external MCP servers. */
  tools: Tool[];
  /** Disconnect all external MCP servers. Must be called during cleanup. */
  disconnect: () => void;
}

/**
 * Connect to all external MCP servers (stdio/sse/http) in the config,
 * perform MCP handshake, discover tools, and bridge them.
 *
 * Servers that fail to connect are logged and skipped — they do not
 * prevent other servers from connecting.
 *
 * @param mcpServers - The mcpServers record from Options
 * @returns Bridged tools and a disconnect function
 */
export async function connectExternalMcpServers(
  mcpServers: Record<string, unknown> | undefined,
): Promise<ExternalMcpConnection> {
  if (!mcpServers) return { tools: [], disconnect: () => {} };

  const connected: ConnectedExternalServer[] = [];

  for (const [name, config] of Object.entries(mcpServers)) {
    if (!config || typeof config !== 'object') continue;
    const cfg = config as Record<string, unknown>;

    // Skip SDK-type configs — handled by extractSdkMcpTools()
    if (cfg.type === 'sdk') continue;

    try {
      const server = await connectSingleExternalServer(name, cfg);
      if (server) {
        connected.push(server);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MCP] Failed to connect server "${name}": ${msg}`);
    }
  }

  const allTools = connected.flatMap((s) => s.tools);

  const disconnect = () => {
    for (const server of connected) {
      try {
        server.client.close();
      } catch {
        // Ignore close errors during cleanup
      }
    }
    connected.length = 0;
  };

  return { tools: allTools, disconnect };
}

/**
 * Connect to a single external MCP server, initialize it, and bridge its tools.
 */
async function connectSingleExternalServer(
  name: string,
  config: Record<string, unknown>,
): Promise<ConnectedExternalServer | null> {
  const type = (config.type as string | undefined) ?? 'stdio';

  let transport: McpTransport;

  switch (type) {
    case 'stdio': {
      const command = config.command as string | undefined;
      if (!command) {
        console.warn(`[MCP] Server "${name}" has type=stdio but no command`);
        return null;
      }
      transport = new StdioTransport({
        command,
        args: config.args as string[] | undefined,
        env: config.env as Record<string, string> | undefined,
        cwd: config.cwd as string | undefined,
      });
      break;
    }

    case 'sse': {
      const url = config.url as string | undefined;
      if (!url) {
        console.warn(`[MCP] Server "${name}" has type=sse but no url`);
        return null;
      }
      transport = new SSETransport({
        url,
        headers: config.headers as Record<string, string> | undefined,
      });
      break;
    }

    case 'http': {
      const url = config.url as string | undefined;
      if (!url) {
        console.warn(`[MCP] Server "${name}" has type=http but no url`);
        return null;
      }
      transport = new HttpTransport({
        url,
        headers: config.headers as Record<string, string> | undefined,
      });
      break;
    }

    default:
      console.warn(`[MCP] Unsupported transport type "${type}" for server "${name}"`);
      return null;
  }

  // Connect transport
  await transport.connect();

  // MCP handshake + tool discovery
  const client = new McpClient(transport, name);
  try {
    await client.initialize();
  } catch (err: unknown) {
    // If initialize fails, close the transport and skip
    transport.close();
    throw err;
  }

  // Bridge discovered tools
  const mcpToolDefs = client.getTools();
  const tools = mcpToolDefs.map((mcpTool) =>
    createExternalBridgedTool(name, mcpTool, client),
  );

  return { name, client, tools };
}

/**
 * Create a bridged Tool from an external MCP tool definition.
 */
function createExternalBridgedTool(
  serverName: string,
  mcpTool: McpToolDefinition,
  client: McpClient,
): Tool {
  const fullName = mcpToolName(serverName, mcpTool.name);

  return {
    name: fullName,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema,
    permissionLevel: 'execute' as const,

    async execute(
      input: Record<string, unknown>,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const result = await client.callTool(mcpTool.name, input);
      return formatCallToolResult(result.content, result.isError);
    },
  };
}

// =========================================================================
// Shared helpers
// =========================================================================

/**
 * Convert MCP CallToolResult content blocks to a flat text string.
 * CC SDK always serializes MCP tool results to a single text string
 * for the LLM's tool_result content block.
 */
function formatCallToolResult(
  content: Array<{ type: string; [key: string]: unknown }>,
  isError?: boolean,
): ToolResult {
  const textParts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    } else if (block.type === 'image') {
      textParts.push(`[Image: ${(block.mimeType as string) ?? 'unknown'}]`);
    } else {
      // Other block types — serialize as JSON
      textParts.push(JSON.stringify(block));
    }
  }

  return {
    content: textParts.join('\n'),
    isError: isError ?? false,
  };
}

// =========================================================================
// SDK MCP detection and extraction (synchronous)
// =========================================================================

/**
 * Check if a server config is an SDK-type config with a live instance.
 */
export function isSdkMcpServerConfig(config: unknown): config is McpSdkServerConfigWithInstance {
  if (!config || typeof config !== 'object') return false;
  const obj = config as Record<string, unknown>;
  return obj.type === 'sdk' && 'instance' in obj && obj.instance != null;
}

/**
 * Extract all bridged tools from SDK-type MCP server configs.
 *
 * This is synchronous — SDK servers are in-process and don't require
 * network connections. For external servers (stdio/sse/http), use
 * `connectExternalMcpServers()` instead.
 *
 * @param mcpServers - The mcpServers record from Options
 * @returns Array of bridged Tool objects
 */
export function extractSdkMcpTools(
  mcpServers: Record<string, unknown> | undefined,
): Tool[] {
  if (!mcpServers) return [];

  const tools: Tool[] = [];
  for (const [_name, config] of Object.entries(mcpServers)) {
    if (isSdkMcpServerConfig(config)) {
      tools.push(...bridgeSdkMcpTools(config));
    }
  }
  return tools;
}
