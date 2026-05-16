/**
 * JSON-RPC client for Codex app-server.
 *
 * Wire format: line-delimited JSON over stdio (see ../types/jsonrpc.ts and
 * ../../../codex/CONTEXT for protocol notes). Bidirectional: both sides may
 * send requests; both sides must answer requests addressed to them.
 *
 * Responsibilities:
 *   - Frame outgoing messages as `JSON + \n` on stdin.
 *   - Parse incoming lines from stdout into JsonRpcMessage values.
 *   - Match incoming responses to pending client-issued requests.
 *   - Dispatch incoming server-issued requests to a registered handler and
 *     send back a response with the same id.
 *   - Dispatch incoming notifications to registered listeners.
 *
 * Failure model:
 *   - On transport close, every pending client request is rejected with a
 *     transport-closed error.
 *   - Lines that do not parse as JSON or do not match any of the four shapes
 *     are logged and dropped (the server occasionally interleaves debug
 *     diagnostics during early start-up).
 */

import { createInterface, type Interface as ReadlineInterface } from 'readline'
import type { Readable, Writable } from 'stream'
import {
  isJsonRpcError,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcSuccess,
  JsonRpcErrorCode,
  type JsonRpcErrorPayload,
  type JsonRpcMessage,
  type RequestId,
} from '../types/jsonrpc'

export type Disposable = () => void

export interface ServerRequestContext {
  id: RequestId
  method: string
  params: unknown
}

export type ServerRequestHandler = (ctx: ServerRequestContext) => Promise<unknown>

export interface JsonRpcClientOptions {
  stdin: Writable
  stdout: Readable
  /** Called for every line that fails to parse — caller may choose to log. */
  onParseError?: (raw: string, err: Error) => void
  /** Called when the underlying stdout closes. */
  onClose?: (reason: 'eof' | 'shutdown') => void
  /** Per-server-request timeout. Defaults to 5 minutes. */
  serverRequestTimeoutMs?: number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  method: string
}

export class JsonRpcClient {
  private nextId = 1
  private readonly pending = new Map<string, PendingRequest>()
  private readonly notificationListeners = new Map<string, Set<(params: unknown) => void>>()
  private readonly requestHandlers = new Map<string, ServerRequestHandler>()
  private readonly stdin: Writable
  private readonly rl: ReadlineInterface
  private readonly opts: JsonRpcClientOptions
  private closed = false

  constructor(opts: JsonRpcClientOptions) {
    this.opts = opts
    this.stdin = opts.stdin
    this.rl = createInterface({ input: opts.stdout })
    this.rl.on('line', (line) => this.onLine(line))
    this.rl.on('close', () => this.handleClose('eof'))
  }

  // --------------------------------------------------------------------------
  // Outbound: requests + notifications
  // --------------------------------------------------------------------------

  /**
   * Issue a request and resolve with the server's `result`. Rejects if the
   * server returns an error response or if the connection closes before a
   * response arrives.
   */
  request<R = unknown>(method: string, params?: unknown): Promise<R> {
    if (this.closed) {
      return Promise.reject(new Error(`[Codex][rpc] Cannot send "${method}": connection closed`))
    }
    const id = this.allocateId()
    return new Promise<R>((resolve, reject) => {
      this.pending.set(idKey(id), {
        resolve: (v: unknown) => resolve(v as R),
        reject,
        method,
      })
      this.send({ id, method, params })
    })
  }

  /** Fire-and-forget notification (no id, no response expected). */
  notify(method: string, params?: unknown): void {
    if (this.closed) {
      // Notifications are advisory; silently dropping at shutdown is correct.
      return
    }
    this.send({ method, params })
  }

  // --------------------------------------------------------------------------
  // Inbound subscription
  // --------------------------------------------------------------------------

  onNotification(method: string, cb: (params: unknown) => void): Disposable {
    let set = this.notificationListeners.get(method)
    if (!set) {
      set = new Set()
      this.notificationListeners.set(method, set)
    }
    set.add(cb)
    return () => set!.delete(cb)
  }

  /**
   * Register a handler for an inbound (server-issued) request. Only one
   * handler per method is allowed — replacing a handler is intentional and
   * safe because all known server requests are stateless RPCs.
   */
  onServerRequest(method: string, handler: ServerRequestHandler): Disposable {
    this.requestHandlers.set(method, handler)
    return () => {
      if (this.requestHandlers.get(method) === handler) {
        this.requestHandlers.delete(method)
      }
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  close(reason: 'shutdown' | 'eof' = 'shutdown'): void {
    this.handleClose(reason)
  }

  isOpen(): boolean {
    return !this.closed
  }

  // --------------------------------------------------------------------------
  // Internal: framing + dispatch
  // --------------------------------------------------------------------------

  private send(message: unknown): void {
    let payload: string
    try {
      payload = JSON.stringify(message)
    } catch (err) {
      console.error(`[Codex][rpc] serialize failed:`, err, message)
      return
    }
    this.stdin.write(payload + '\n', (err) => {
      if (err) {
        console.error(`[Codex][rpc] stdin.write error:`, err)
      }
    })
  }

  private onLine(line: string): void {
    if (!line) return
    const trimmed = line.trim()
    if (!trimmed) return

    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage
    } catch (err) {
      this.opts.onParseError?.(trimmed, err as Error)
      console.warn(`[Codex][rpc] dropping non-JSON line: ${truncate(trimmed, 200)}`)
      return
    }

    if (isJsonRpcRequest(msg)) {
      void this.dispatchServerRequest(msg.id, msg.method, msg.params)
      return
    }

    if (isJsonRpcSuccess(msg)) {
      const pending = this.pending.get(idKey(msg.id))
      if (!pending) {
        console.warn(`[Codex][rpc] response for unknown id ${String(msg.id)}; dropping`)
        return
      }
      this.pending.delete(idKey(msg.id))
      pending.resolve(msg.result)
      return
    }

    if (isJsonRpcError(msg)) {
      const pending = this.pending.get(idKey(msg.id))
      if (!pending) {
        console.warn(`[Codex][rpc] error response for unknown id ${String(msg.id)}; dropping`)
        return
      }
      this.pending.delete(idKey(msg.id))
      pending.reject(formatRpcError(pending.method, msg.error))
      return
    }

    if (isJsonRpcNotification(msg)) {
      this.dispatchNotification(msg.method, msg.params)
      return
    }

    console.warn(`[Codex][rpc] unrecognized message shape: ${truncate(trimmed, 200)}`)
  }

  private dispatchNotification(method: string, params: unknown): void {
    const set = this.notificationListeners.get(method)
    if (!set || set.size === 0) return
    // Snapshot listeners so disposal during dispatch is safe.
    for (const cb of Array.from(set)) {
      try {
        cb(params)
      } catch (err) {
        console.error(`[Codex][rpc] notification "${method}" listener threw:`, err)
      }
    }
  }

  private async dispatchServerRequest(id: RequestId, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method)
    if (!handler) {
      this.send({
        id,
        error: {
          code: JsonRpcErrorCode.MethodNotFound,
          message: `Unhandled server request "${method}"`,
        },
      })
      return
    }

    const timeoutMs = this.opts.serverRequestTimeoutMs ?? 5 * 60 * 1000
    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`server request "${method}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      const result = await Promise.race([handler({ id, method, params }), timeoutPromise])
      if (timer) clearTimeout(timer)
      if (this.closed) return
      this.send({ id, result })
    } catch (err) {
      if (timer) clearTimeout(timer)
      if (this.closed) return
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Codex][rpc] server-request handler "${method}" rejected:`, err)
      this.send({
        id,
        error: {
          code: JsonRpcErrorCode.InternalError,
          message,
        },
      })
    }
  }

  private handleClose(reason: 'eof' | 'shutdown'): void {
    if (this.closed) return
    this.closed = true
    try { this.rl.close() } catch { /* ignore */ }

    const err = new Error(`[Codex][rpc] connection closed (${reason})`)
    for (const [, pending] of Array.from(this.pending.entries())) {
      pending.reject(err)
    }
    this.pending.clear()
    this.notificationListeners.clear()
    this.requestHandlers.clear()

    try { this.opts.onClose?.(reason) } catch (cbErr) {
      console.error(`[Codex][rpc] onClose threw:`, cbErr)
    }
  }

  private allocateId(): RequestId {
    return this.nextId++
  }
}

function idKey(id: RequestId): string {
  return typeof id === 'number' ? `n:${id}` : `s:${id}`
}

function formatRpcError(method: string, error: JsonRpcErrorPayload): Error {
  const err = new Error(`[Codex][rpc] "${method}" failed: ${error.message} (code ${error.code})`)
  ;(err as any).code = error.code
  ;(err as any).data = error.data
  return err
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…(+${text.length - max})` : text
}
