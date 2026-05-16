/**
 * JSON-RPC wire types for the Codex app-server transport.
 *
 * CRITICAL: Codex's app-server implements a JSON-RPC dialect that does NOT
 * include the `"jsonrpc": "2.0"` field. See
 *   /codex-rs/app-server-protocol/src/jsonrpc_lite.rs
 * which opens with the comment:
 *   "We do not do true JSON-RPC 2.0, as we neither send nor expect the
 *   \"jsonrpc\": \"2.0\" field."
 *
 * Framing is line-delimited JSON (one object per `\n`-terminated line,
 * stdin/stdout bidirectionally). No HTTP-style headers.
 *
 * The four message kinds are differentiated structurally, not by tag:
 *   - Request:      has `id` AND `method`
 *   - Response:     has `id` AND `result`
 *   - Error:        has `id` AND `error`
 *   - Notification: has `method` AND no `id`
 *
 * Backpressure error code (server-emitted): -32001 "Server overloaded".
 */

export type RequestId = string | number

export interface JsonRpcRequest {
  id: RequestId
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  method: string
  params?: unknown
}

export interface JsonRpcSuccessResponse {
  id: RequestId
  result: unknown
}

export interface JsonRpcErrorPayload {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcErrorResponse {
  id: RequestId
  error: JsonRpcErrorPayload
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse

export function isJsonRpcRequest(msg: any): msg is JsonRpcRequest {
  return msg && msg.id !== undefined && typeof msg.method === 'string'
}

export function isJsonRpcNotification(msg: any): msg is JsonRpcNotification {
  return msg && msg.id === undefined && typeof msg.method === 'string'
}

export function isJsonRpcResponse(msg: any): msg is JsonRpcResponse {
  return msg && msg.id !== undefined && typeof msg.method !== 'string'
}

export function isJsonRpcSuccess(msg: any): msg is JsonRpcSuccessResponse {
  return isJsonRpcResponse(msg) && 'result' in msg
}

export function isJsonRpcError(msg: any): msg is JsonRpcErrorResponse {
  return isJsonRpcResponse(msg) && 'error' in msg
}

/** Standard error codes used by the Codex transport. */
export const JsonRpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerOverloaded: -32001,
} as const
