/**
 * Email MCP — Shared helpers for tool handlers.
 */

/**
 * Build a standard MCP tool text result.
 * Same pattern as report-tool.ts and notify-tool.ts.
 */
export function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true } : {}),
  }
}
