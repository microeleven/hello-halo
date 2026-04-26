/**
 * AI Browser SDK MCP Server
 *
 * Creates an in-process MCP server using Claude Agent SDK's
 * tool() and createSdkMcpServer() functions.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ ENTRY POINT MANIFEST                                           │
 * │                                                                 │
 * │ createAIBrowserMcpServer() is the PRIMARY entry point for the  │
 * │ AI Browser module. All session-level side effects (download     │
 * │ handler, etc.) MUST be initialized here — not in a separate    │
 * │ init function — because this is the only path guaranteed to    │
 * │ run before any tool is called.                                  │
 * │                                                                 │
 * │ Callers:                                                        │
 * │   1. services/agent/send-message.ts  — Main chat (global ctx)  │
 * │   2. apps/runtime/app-chat.ts        — App chat (scoped ctx)   │
 * │   3. apps/runtime/execute.ts         — Automation (scoped ctx) │
 * │                                                                 │
 * │ When adding new session-level side effects, add them HERE.     │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Tool implementations live in tools/ by category:
 *   tools/navigation.ts  — 8 tools (list, select, new, close, navigate, wait, resize, dialog)
 *   tools/input.ts       — 7 tools (click, hover, fill, fill_form, drag, press_key, upload)
 *   tools/snapshot.ts    — 3 tools (snapshot, screenshot, evaluate)
 *   tools/script.ts      — 1 tool  (run)
 *   tools/network.ts     — 2 tools (network_requests, network_request)
 *   tools/console.ts     — 2 tools (console, console_message)
 *   tools/emulation.ts   — 1 tool  (emulate)
 *   tools/performance.ts — 3 tools (perf_start, perf_stop, perf_insight)
 *   tools/download.ts    — 1 tool  (download)
 *   tools/helpers.ts     — shared utilities (withTimeout, textResult, etc.)
 *   tools/index.ts       — aggregation (buildAllTools)
 */

import { createSdkMcpServer } from '../agent/resolved-sdk'
import { browserContext, type BrowserContext } from './context'
import { buildAllTools } from './tools'
import { installDownloadHandler } from './download-handler'

/**
 * Create AI Browser SDK MCP Server.
 *
 * This is the primary entry point for the AI Browser module. All
 * session-level side effects are initialized here (idempotently).
 *
 * @param scopedContext - Optional scoped BrowserContext for isolation.
 *   When provided, all tools operate on this context's activeViewId
 *   instead of the global singleton. Use for automation runs.
 *   When omitted, uses the global singleton (interactive user use).
 * @param workDir - Optional working directory for resolving relative paths in
 *   browser_run. Should match the cwd passed to the Claude SDK session so that
 *   relative skill paths (e.g. ".claude/skills/xhs-search/index.js") resolve
 *   correctly. Stored on ctx.workDir; defaults to process.cwd() at use-time
 *   when omitted.
 */
export function createAIBrowserMcpServer(scopedContext?: BrowserContext, workDir?: string) {
  // ── Session-level side effects (idempotent) ──────────────────────
  // Register the will-download handler on persist:browser session so
  // AI-initiated downloads are saved silently (no Save-As dialog).
  installDownloadHandler()

  // ── Build context and tools ──────────────────────────────────────
  const ctx = scopedContext ?? browserContext
  if (workDir !== undefined) {
    ctx.workDir = workDir
  }
  const tools = buildAllTools(ctx)
  return createSdkMcpServer({
    name: 'ai-browser',
    version: '1.0.0',
    tools
  })
}
