/**
 * apps/runtime/im-channels -- File Send MCP Server
 *
 * Channel-agnostic MCP server that provides the `send_file_to_chat` tool.
 * Allows AI agents to send local files back to the originating IM conversation.
 *
 * Design:
 * - The actual upload + dispatch logic is injected as a closure (`sendFn`) from
 *   the calling site (dispatch-inbound.ts), which binds chatId and chatType.
 * - This module has zero knowledge of WeCom or any other platform protocol.
 * - Instantiate once per inbound message; the closure captures the conversation.
 *
 * Usage pattern:
 *   // In dispatch-inbound.ts (per message):
 *   const sendFn = (filePath, filename) =>
 *     instance.fileCapability!.sendFile(chatId, filePath, chatType, filename)
 *   const mcpServer = createFileSendMcpServer(sendFn)
 *   // Then pass mcpServer to sendAppChatMessage() via imFileSend
 */

import { z } from 'zod'
import { tool, createSdkMcpServer } from '../../../services/agent/resolved-sdk'

// ============================================
// Types
// ============================================

type SdkMcpServer = ReturnType<typeof createSdkMcpServer>

/** Bound file-send function (pre-captures chatId and chatType from the inbound message). */
export type FileSendFn = (filePath: string, filename?: string) => Promise<boolean>

// ============================================
// Helpers
// ============================================

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true } : {}),
  }
}

// ============================================
// Factory
// ============================================

/**
 * Create an MCP server providing the `send_file_to_chat` tool.
 *
 * The server is cheap to create and should be instantiated once per inbound
 * message. The `sendFn` closure is bound to the specific conversation so the
 * AI doesn't need to specify chatId/chatType as tool parameters.
 *
 * @param sendFn - Pre-bound function that uploads + sends a file to the current chat.
 *                 Returns true on success, false on recoverable failure.
 */
export function createFileSendMcpServer(sendFn: FileSendFn): SdkMcpServer {
  const sendFileTool = tool(
    'send_file_to_chat',
    'Send a local file to the current IM chat conversation. ' +
    'Use this to deliver generated reports, exported spreadsheets, images, PDFs, ' +
    'or any other file directly to the user in the chat window. ' +
    'The file must already exist on the local filesystem. ' +
    'Returns a success or error message.',
    {
      filePath: z.string().describe(
        'Absolute path to the local file to send (e.g. "/tmp/report.pdf"). ' +
        'The file must exist and be readable.'
      ),
      filename: z.string().optional().describe(
        'Optional display name shown to the user (e.g. "Monthly Report.pdf"). ' +
        'Defaults to the file\'s basename if not specified.'
      ),
    },
    async (input: { filePath: string; filename?: string }) => {
      const { filePath, filename } = input
      console.log(`[FileSendMcp] send_file_to_chat: path="${filePath}", name="${filename ?? ''}"`)

      try {
        const ok = await sendFn(filePath, filename)
        if (ok) {
          return textResult(`File sent successfully: ${filename || filePath}`)
        }
        return textResult(
          `Failed to send file — the channel returned an error. ` +
          `Check that the file exists and the IM channel is connected.`,
          true
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[FileSendMcp] send_file_to_chat error:`, err)
        return textResult(`Error sending file: ${message}`, true)
      }
    }
  )

  return createSdkMcpServer({
    name: 'im-file-send',
    version: '1.0.0',
    tools: [sendFileTool],
  })
}
