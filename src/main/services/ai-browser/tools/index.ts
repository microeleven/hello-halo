/**
 * AI Browser Tools - Aggregation layer
 *
 * Imports all tool category builders and exports a single
 * buildAllTools() function that returns all 27 SDK tools.
 */

import type { BrowserContext } from '../context'
import { buildNavigationTools } from './navigation'
import { buildInputTools } from './input'
import { buildSnapshotTools } from './snapshot'
import { buildScriptTools } from './script'
import { buildNetworkTools } from './network'
import { buildConsoleTools } from './console'
import { buildEmulationTools } from './emulation'
import { buildPerformanceTools } from './performance'
import { buildDownloadTools } from './download'

/**
 * Build all 28 AI Browser tools, closing over the provided BrowserContext.
 * This allows each MCP server instance to operate on its own context
 * (scoped activeViewId) while sharing the same browserViewManager session.
 */
export function buildAllTools(ctx: BrowserContext) {
  return [
    ...buildNavigationTools(ctx),      // 8 tools
    ...buildInputTools(ctx),           // 7 tools
    ...buildSnapshotTools(ctx),        // 3 tools
    ...buildScriptTools(ctx),          // 1 tool
    ...buildNetworkTools(ctx),         // 2 tools
    ...buildConsoleTools(ctx),         // 2 tools
    ...buildEmulationTools(ctx),       // 1 tool
    ...buildPerformanceTools(ctx),     // 3 tools
    ...buildDownloadTools(ctx),        // 1 tool
  ]
}
