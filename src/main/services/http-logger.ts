/**
 * HTTP Request Logger
 *
 * Dedicated electron-log instance for raw outbound HTTP request logging.
 * Intended for developer use only — captures every request made through
 * proxyFetch(), including full headers (auth tokens) and request body.
 *
 * Controlled by: Settings > Advanced > Log HTTP Requests
 * Log file: same directory as main.log, filename = http-raw.log
 *   macOS:   ~/Library/Logs/Halo/http-raw.log
 *   Windows: %USERPROFILE%\AppData\Roaming\Halo\logs\http-raw.log
 *
 * Self-registers with onAgentConfigChange at module load — proxy-fetch.ts
 * simply imports this module and calls isHttpLoggingEnabled() / logHttpRequest().
 * No explicit wiring required in bootstrap.
 */

import log from 'electron-log/main.js'
import { getConfig, onAgentConfigChange } from './config.service'

// ============================================================================
// Dedicated log instance
// ============================================================================

const httpLog = log.create({ logId: 'http-raw' })

// File only — do NOT write to console (would pollute the main log stream)
httpLog.transports.console.level = false
httpLog.transports.file.level = 'info'
// 20 MB per file with auto-rotation — generous for verbose request payloads
httpLog.transports.file.maxSize = 20 * 1024 * 1024

// ============================================================================
// Runtime toggle (in-memory, zero disk reads after init)
// ============================================================================

let _enabled = false

/**
 * Enable or disable HTTP request logging.
 * Idempotent — no-op if state is unchanged.
 */
export function setHttpLogging(enabled: boolean): void {
  if (_enabled === enabled) return
  _enabled = enabled
  if (enabled) {
    const filePath = getLogFilePath()
    console.log(`[HttpLogger] Raw HTTP logging ENABLED → ${filePath}`)
  } else {
    console.log('[HttpLogger] Raw HTTP logging disabled')
  }
}

/**
 * Whether HTTP logging is currently active.
 * Called on every proxyFetch() — must be O(1).
 */
export function isHttpLoggingEnabled(): boolean {
  return _enabled
}

/**
 * Resolve the log file path for display purposes.
 * electron-log v5 creates the file under the same directory as main.log.
 */
function getLogFilePath(): string {
  try {
    const file = httpLog.transports.file.getFile()
    return file?.path ?? 'http-raw.log'
  } catch {
    return 'http-raw.log'
  }
}

// ============================================================================
// Logging helpers
// ============================================================================

/**
 * Format a headers object into a readable multi-line string.
 * No sanitization — caller opted in to full logging.
 */
function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')
}

/**
 * Pretty-print a JSON string, or return as-is if not parseable.
 */
function prettyBody(body: string | undefined): string {
  if (!body) return '(empty)'
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

// ============================================================================
// Public API
// ============================================================================

export interface HttpRequestLogEntry {
  method: string
  url: string
  headers: Record<string, string>
  /** Raw body string (typically JSON). undefined for bodyless requests. */
  body?: string
}

/**
 * Log a raw outbound HTTP request.
 * No-op when logging is disabled — designed to be called unconditionally.
 */
export function logHttpRequest(entry: HttpRequestLogEntry): void {
  if (!_enabled) return

  const separator = '─'.repeat(60)
  const lines = [
    `\n${separator}`,
    `▶ ${entry.method} ${entry.url}`,
    '--- Headers ---',
    formatHeaders(entry.headers),
    '--- Body ---',
    prettyBody(entry.body),
    separator,
  ].join('\n')

  httpLog.info(lines)
}

// ============================================================================
// Self-registration — runs at module load time (imported by proxy-fetch.ts)
// ============================================================================

// Read initial state from persisted config
_enabled = getConfig().agent?.logHttpRequests ?? false
if (_enabled) {
  const filePath = getLogFilePath()
  console.log(`[HttpLogger] Raw HTTP logging ENABLED at startup → ${filePath}`)
}

// Keep in sync with config changes (synchronous — set before next request)
onAgentConfigChange((agent) => {
  setHttpLogging(agent?.logHttpRequests ?? false)
})
