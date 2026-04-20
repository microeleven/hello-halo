/**
 * iLink API — Shared utilities for the WeChat iLink Bot integration.
 *
 * Used by:
 *   - weixin-ilink.provider.ts  (long-poll + send)
 *   - ipc/weixin-ilink.ts       (QR auth flow IPC handlers)
 *   - controllers/weixin-ilink.controller.ts (save-token / disconnect)
 *   - http/routes/index.ts      (QR auth HTTP routes)
 *
 * Centralises the iLink API constants and low-level HTTP helpers so that
 * protocol changes (headers, base URL, version) only need to be made here.
 */

import https from 'https'
import http from 'http'
import { URL } from 'url'

// ============================================
// Constants
// ============================================

export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
export const CHANNEL_VERSION = '1.0.2'

/** errcode / ret value that signals a session expiry requiring re-auth */
export const SESSION_EXPIRED_CODE = -14

// ============================================
// Helpers
// ============================================

/**
 * Generate a random uint32 value encoded as base64 string.
 * Required by iLink API for the X-WECHAT-UIN header.
 */
export function randomUint32Base64(): string {
  const n = Math.floor(Math.random() * 4294967296)
  return Buffer.from(String(n)).toString('base64')
}

/**
 * Build the standard iLink authentication headers.
 * The Authorization header is included only when a bot_token is supplied.
 */
export function buildAuthHeaders(botToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomUint32Base64(),
  }
  if (botToken) {
    headers['Authorization'] = `Bearer ${botToken}`
  }
  return headers
}

/**
 * Check whether a response signals session expiry.
 * iLink uses -14 in both `ret` and `errcode` fields.
 */
export function isSessionExpired(ret: number, errcode?: number): boolean {
  return ret === SESSION_EXPIRED_CODE || errcode === SESSION_EXPIRED_CODE
}

/**
 * Perform an HTTP(S) request and return the parsed JSON response.
 * Supports GET and POST methods. Throws on network or parse errors.
 *
 * @param signal - Optional AbortSignal for cancelling long-running requests
 *                 (e.g., the 35 s long-poll in the provider).
 */
export function fetchJson<T>(
  method: 'GET' | 'POST',
  urlStr: string,
  headers: Record<string, string>,
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }

    const parsedUrl = new URL(urlStr)
    const isHttps = parsedUrl.protocol === 'https:'
    const transport = isHttps ? https : http

    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined
    const reqHeaders: Record<string, string> = { ...headers }
    if (bodyStr) {
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString()
    }

    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: reqHeaders,
    }

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try {
          resolve(JSON.parse(raw) as T)
        } catch {
          reject(new Error(`Invalid JSON response: ${raw.slice(0, 200)}`))
        }
      })
      res.on('error', reject)
    })

    req.on('error', reject)

    if (signal) {
      const onAbort = () => req.destroy(new Error('Aborted'))
      signal.addEventListener('abort', onAbort, { once: true })
      req.on('close', () => signal.removeEventListener('abort', onAbort))
    }

    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}
