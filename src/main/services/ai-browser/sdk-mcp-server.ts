/**
 * AI Browser SDK MCP Server
 *
 * Creates an in-process MCP server using Claude Agent SDK's
 * tool() and createSdkMcpServer() functions.
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
 *   tools/helpers.ts     — shared utilities (withTimeout, textResult, etc.)
 *   tools/index.ts       — aggregation (buildAllTools)
 */

import { createSdkMcpServer } from '../agent/resolved-sdk'
import { browserContext, type BrowserContext } from './context'
import { buildAllTools } from './tools'

/**
 * Create AI Browser SDK MCP Server.
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

/**
 * Get all AI Browser tool names
 */
export function getAIBrowserSdkToolNames(): string[] {
  // Build tools with default context just to extract names
  return buildAllTools(browserContext).map(t => t.name)
}
