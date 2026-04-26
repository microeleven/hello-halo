/**
 * AI Browser Module - Public API
 *
 * This module provides AI-controlled browser capabilities for Halo.
 * It enables the AI to navigate web pages, interact with elements,
 * and extract information - all without requiring external tools.
 *
 * Entry Points (see DESIGN.md for full architecture):
 *   createAIBrowserMcpServer()   — Creates the MCP tool server (primary entry)
 *   createScopedBrowserContext()  — Creates an isolated context for automation
 *   cleanupAIBrowser()           — Destroys the global singleton on shutdown
 *   AI_BROWSER_SYSTEM_PROMPT     — System prompt fragment for AI instructions
 */

import { browserContext, createScopedBrowserContext } from './context'
import { createAIBrowserMcpServer } from './sdk-mcp-server'

// Re-export public API
export { createAIBrowserMcpServer }
export { createScopedBrowserContext }

// ============================================
// System Prompt
// ============================================

/**
 * AI Browser system prompt addition
 * Append this to the system prompt when AI Browser is enabled
 *
 * Note: Tools are exposed via MCP server with prefix "mcp__ai-browser__"
 * e.g., mcp__ai-browser__browser_new_page
 */
export const AI_BROWSER_SYSTEM_PROMPT = `
## AI Browser

You can now control Halo's embedded real browser. All browser tools are provided via MCP server "ai-browser".

### Core Workflow
1. Use \`mcp__ai-browser__browser_new_page\` to open a webpage
2. Use \`mcp__ai-browser__browser_snapshot\` to get page content (accessibility tree)
3. Find the target element's uid from the snapshot
4. Use \`mcp__ai-browser__browser_click\`, \`mcp__ai-browser__browser_fill\`, etc. to interact with elements
5. Re-fetch snapshot after each action to confirm results

### Available Tools (prefix: mcp__ai-browser__)

**Navigation:**
- \`browser_new_page\` - Create new page and navigate to URL. Supports optional \`device\` param ("pc" | "h5"). **Default is "pc". Only use "h5" when the user explicitly asks for mobile view, or when the site is known to be mobile-only (e.g. Meituan, WeChat mini-program pages, sites that redirect desktop to mobile).**
- \`browser_navigate\` - Navigate to URL or execute back/forward/reload
- \`browser_list_pages\` - List all open pages
- \`browser_select_page\` - Select active page
- \`browser_close_page\` - Close page
- \`browser_wait_for\` - Wait for text to appear

**Input:**
- \`browser_click\` - Click element
- \`browser_fill\` - Fill input field
- \`browser_fill_form\` - Batch fill form fields
- \`browser_hover\` - Hover over element
- \`browser_drag\` - Drag element
- \`browser_press_key\` - Press key (e.g., Enter, Tab)
- \`browser_upload_file\` - Upload file
- \`browser_handle_dialog\` - Handle dialog

**View:**
- \`browser_snapshot\` - Get page accessibility tree (most important!)
- \`browser_screenshot\` - Take screenshot
- \`browser_evaluate\` - Execute JavaScript

**Debug:**
- \`browser_console\` - View console messages
- \`browser_network_requests\` - View network requests

**Emulation:**
- \`browser_emulate\` - Emulate device/network
- \`browser_resize\` - Resize viewport

**Download:**
- \`browser_download\` - Download a file or wait for a download to complete. Provide \`url\` for direct downloads, or omit to wait for a download triggered by a previous click. Returns file path, size, and status.

### Important Notes
- **Always use the latest snapshot** - UIDs change after page updates
- Prefer \`browser_snapshot\` over \`browser_screenshot\` (more lightweight)
- Use \`browser_fill_form\` for batch form filling (more efficient)
- Ensure element is visible before interacting, scroll if necessary
`

// ============================================
// Lifecycle
// ============================================

/**
 * Clean up AI Browser resources (global singleton only).
 *
 * Called by bootstrap/extended.ts during app shutdown.
 * Scoped contexts are cleaned up by their owners (app-chat / execute).
 */
export function cleanupAIBrowser(): void {
  browserContext.destroy()
  console.log('[AI Browser] Global context cleaned up')
}
