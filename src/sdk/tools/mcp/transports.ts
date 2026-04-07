/**
 * @module tools/mcp/transports
 * MCP transport implementations: stdio, SSE, and streamable-http.
 *
 * Each transport manages the low-level I/O for JSON-RPC 2.0 communication
 * with an external MCP server. The transports follow the MCP specification
 * (protocol version 2024-11-05).
 *
 * @license MIT
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type {
  McpTransport,
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
} from './jsonrpc.js';

/** Default timeout for individual JSON-RPC requests (30 seconds). */
const REQUEST_TIMEOUT_MS = 30_000;

/** Timeout for initial connection/handshake (15 seconds). */
const CONNECT_TIMEOUT_MS = 15_000;

/** Grace period before SIGKILL after SIGTERM (5 seconds). */
const FORCE_KILL_MS = 5_000;

// ---------------------------------------------------------------------------
// Pending request tracking (shared across transports)
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (res: JsonRpcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function rejectAllPending(
  pending: Map<number, PendingRequest>,
  reason: string,
): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
    pending.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Stdio Transport
// ---------------------------------------------------------------------------

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Stdio MCP transport — communicates with an MCP server via a child process.
 * JSON-RPC messages are sent as newline-delimited JSON on stdin, and
 * responses are read line-by-line from stdout.
 */
export class StdioTransport implements McpTransport {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private pending = new Map<number, PendingRequest>();
  private _connected = false;

  constructor(private readonly options: StdioTransportOptions) {}

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const env = { ...process.env, ...this.options.env };

      const child = spawn(this.options.command, this.options.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        cwd: this.options.cwd,
      });

      const timeout = setTimeout(() => {
        cleanup();
        child.kill('SIGKILL');
        reject(new Error(
          `MCP server "${this.options.command}" did not start within ${CONNECT_TIMEOUT_MS}ms`,
        ));
      }, CONNECT_TIMEOUT_MS);

      const onError = (err: Error) => {
        cleanup();
        reject(new Error(
          `Failed to spawn MCP server "${this.options.command}": ${err.message}`,
        ));
      };

      const onSpawn = () => {
        cleanup();
        this.process = child;
        this.setupIO();
        this._connected = true;
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timeout);
        child.removeListener('error', onError);
        child.removeListener('spawn', onSpawn);
      };

      child.once('error', onError);
      child.once('spawn', onSpawn);
    });
  }

  private setupIO(): void {
    if (!this.process?.stdout) return;

    this.readline = createInterface({ input: this.process.stdout });
    this.readline.on('line', (line) => this.handleLine(line));

    this.process.on('exit', (_code, _signal) => {
      this._connected = false;
      rejectAllPending(this.pending, 'MCP server process exited');
    });

    this.process.on('error', (err) => {
      this._connected = false;
      rejectAllPending(this.pending, `MCP server process error: ${err.message}`);
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const msg = JSON.parse(trimmed) as Record<string, unknown>;
      // Only handle JSON-RPC responses (have numeric id + result or error)
      if (
        typeof msg.id === 'number' &&
        (msg.result !== undefined || msg.error !== undefined)
      ) {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          entry.resolve(msg as unknown as JsonRpcResponse);
        }
      }
      // Server-initiated notifications are silently ignored
    } catch {
      // Non-JSON output (e.g. stderr leaking to stdout) — ignore
    }
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.process?.stdin || !this._connected) {
      throw new Error('Stdio transport not connected');
    }

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(
          `MCP request timeout: ${request.method} (id=${request.id})`,
        ));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(request.id, { resolve, reject, timer });

      const json = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(json, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(request.id);
          reject(new Error(`Failed to write to MCP server stdin: ${err.message}`));
        }
      });
    });
  }

  async notify(notification: JsonRpcNotification): Promise<void> {
    if (!this.process?.stdin || !this._connected) {
      throw new Error('Stdio transport not connected');
    }

    return new Promise<void>((resolve, reject) => {
      const json = JSON.stringify(notification) + '\n';
      this.process!.stdin!.write(json, (err) => {
        if (err) reject(new Error(`Failed to write notification: ${err.message}`));
        else resolve();
      });
    });
  }

  close(): void {
    this._connected = false;

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    if (this.process) {
      const child = this.process;
      this.process = null;

      child.stdin?.end();
      child.kill('SIGTERM');

      // Force kill after grace period
      const forceKillTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, FORCE_KILL_MS);
      child.once('exit', () => clearTimeout(forceKillTimer));
    }

    rejectAllPending(this.pending, 'Transport closed');
  }
}

// ---------------------------------------------------------------------------
// SSE Transport
// ---------------------------------------------------------------------------

export interface SSETransportOptions {
  url: string;
  headers?: Record<string, string>;
}

/**
 * SSE MCP transport — connects to an MCP server via Server-Sent Events.
 *
 * Protocol flow:
 * 1. Client opens GET connection to the SSE URL
 * 2. Server sends an "endpoint" event with the POST URL
 * 3. Client POSTs JSON-RPC messages to the endpoint
 * 4. Server sends responses back via SSE "message" events
 */
export class SSETransport implements McpTransport {
  private _connected = false;
  private endpointUrl: string | null = null;
  private abortController: AbortController | null = null;
  private pending = new Map<number, PendingRequest>();

  constructor(private readonly options: SSETransportOptions) {}

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    this.abortController = new AbortController();

    const response = await fetch(this.options.url, {
      headers: {
        Accept: 'text/event-stream',
        ...this.options.headers,
      },
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      throw new Error(
        `SSE connection failed: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error('SSE response has no body');
    }

    this._connected = true;

    // Parse SSE events in background (do not await — it runs until close)
    this.readSSEStream(response.body).catch(() => {
      this._connected = false;
    });

    // Wait for the endpoint event
    await this.waitForEndpoint();
  }

  private async waitForEndpoint(): Promise<void> {
    const start = Date.now();
    while (!this.endpointUrl && Date.now() - start < CONNECT_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!this.endpointUrl) {
      this.close();
      throw new Error(
        'SSE server did not send endpoint event within timeout',
      );
    }
  }

  private async readSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let eventData = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            eventData += line.slice(6);
          } else if (line === '') {
            // End of SSE event — dispatch
            this.handleSSEEvent(eventType, eventData);
            eventType = '';
            eventData = '';
          }
        }
      }
    } catch {
      // Stream ended or aborted
    } finally {
      reader.releaseLock();
      this._connected = false;
    }
  }

  private handleSSEEvent(eventType: string, data: string): void {
    if (eventType === 'endpoint') {
      // Resolve the endpoint URL (may be relative to the SSE URL)
      try {
        this.endpointUrl = new URL(data.trim(), this.options.url).href;
      } catch {
        this.endpointUrl = data.trim();
      }
      return;
    }

    if (eventType === 'message' && data) {
      try {
        const msg = JSON.parse(data) as Record<string, unknown>;
        if (
          typeof msg.id === 'number' &&
          (msg.result !== undefined || msg.error !== undefined)
        ) {
          const entry = this.pending.get(msg.id);
          if (entry) {
            this.pending.delete(msg.id);
            clearTimeout(entry.timer);
            entry.resolve(msg as unknown as JsonRpcResponse);
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.endpointUrl || !this._connected) {
      throw new Error('SSE transport not connected');
    }

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(
          `MCP request timeout: ${request.method} (id=${request.id})`,
        ));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(request.id, { resolve, reject, timer });

      // POST the request to the endpoint; response arrives via SSE stream
      fetch(this.endpointUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.options.headers,
        },
        body: JSON.stringify(request),
      }).catch((err: Error) => {
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(new Error(`SSE POST failed: ${err.message}`));
      });
    });
  }

  async notify(notification: JsonRpcNotification): Promise<void> {
    if (!this.endpointUrl || !this._connected) {
      throw new Error('SSE transport not connected');
    }

    await fetch(this.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify(notification),
    });
  }

  close(): void {
    this._connected = false;
    this.endpointUrl = null;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    rejectAllPending(this.pending, 'Transport closed');
  }
}

// ---------------------------------------------------------------------------
// HTTP (Streamable HTTP) Transport
// ---------------------------------------------------------------------------

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
}

/**
 * Streamable HTTP MCP transport — communicates via HTTP POST requests.
 *
 * Each request is POSTed to the URL. The response is either:
 * - Plain JSON (Content-Type: application/json) — direct response
 * - SSE stream (Content-Type: text/event-stream) — parse for response
 */
export class HttpTransport implements McpTransport {
  private _connected = false;

  constructor(private readonly options: HttpTransportOptions) {}

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    // Stateless transport — no persistent connection needed.
    // We just mark ourselves as connected.
    this._connected = true;
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this._connected) {
      throw new Error('HTTP transport not connected');
    }

    const response = await fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...this.options.headers,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(
        `HTTP MCP request failed: ${response.status} ${response.statusText}`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';

    // Streamable HTTP may respond with an SSE stream
    if (contentType.includes('text/event-stream') && response.body) {
      return this.parseSSEResponse(response.body, request.id);
    }

    // Plain JSON response
    const json = await response.json();
    return json as JsonRpcResponse;
  }

  private async parseSSEResponse(
    body: ReadableStream<Uint8Array>,
    requestId: number,
  ): Promise<JsonRpcResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventData = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            eventData += line.slice(6);
          } else if (line === '' && eventData) {
            try {
              const msg = JSON.parse(eventData) as Record<string, unknown>;
              if (msg.id === requestId) {
                return msg as unknown as JsonRpcResponse;
              }
            } catch {
              // Ignore parse errors
            }
            eventData = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    throw new Error(`No response received for request id=${requestId}`);
  }

  async notify(notification: JsonRpcNotification): Promise<void> {
    if (!this._connected) {
      throw new Error('HTTP transport not connected');
    }

    await fetch(this.options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify(notification),
    });
  }

  close(): void {
    this._connected = false;
  }
}
