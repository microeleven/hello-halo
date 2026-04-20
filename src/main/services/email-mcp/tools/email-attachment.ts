/**
 * email_attachment_download — Download an attachment from an email.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import { textResult } from '../helpers'

export function createEmailAttachmentTool(imap: ImapClient) {
  return tool(
    'email_attachment_download',
    'Download an attachment from a specific email to a local file. Use this when the user needs to save or process an email attachment.\n\n' +
    'First use email_read to see the list of attachments and their filenames, then call this tool with the exact filename.\n\n' +
    'Example: { "email_id": "10841", "filename": "report.xlsx" }',
    {
      email_id: z.string().describe(
        'ID of the email containing the attachment.'
      ),
      filename: z.string().describe(
        'Exact filename of the attachment to download (from the attachments list in email_read results).'
      ),
      folder: z.string().default('INBOX').describe(
        'Folder containing the email. Defaults to INBOX.'
      ),
      save_path: z.string().optional().describe(
        'Local path to save the file. If omitted, saves to a temp directory and returns the path.'
      ),
    },
    async (input) => {
      try {
        const result = await imap.downloadAttachment(
          input.email_id,
          input.filename,
          input.folder,
          input.save_path
        )
        return textResult(JSON.stringify({
          success: true,
          filename: input.filename,
          save_path: result.path,
          size: result.size,
          content_type: result.content_type,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to download attachment: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
