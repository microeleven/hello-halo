/**
 * email_delete — Delete an email (move to Trash or permanently delete).
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import { textResult } from '../helpers'

export function createEmailDeleteTool(imap: ImapClient) {
  return tool(
    'email_delete',
    'Delete an email. By default moves to Trash (recoverable). Set permanent=true to permanently delete (cannot be recovered).\n\n' +
    'Supports batch deletion with comma-separated IDs.\n\n' +
    'Example: { "email_id": "10841", "permanent": false }',
    {
      email_id: z.string().describe(
        'ID of the email(s) to delete. Supports comma-separated IDs for batch delete. Example: "10841" or "10841,10840"'
      ),
      folder: z.string().default('INBOX').describe(
        'Folder containing the email(s). Defaults to INBOX.'
      ),
      permanent: z.boolean().default(false).describe(
        'If true, permanently delete (EXPUNGE — cannot be recovered). If false (default), move to Trash.'
      ),
    },
    async (input) => {
      try {
        const ids = input.email_id.split(',').map(s => s.trim()).filter(Boolean)
        const count = await imap.deleteEmail(ids, input.folder, input.permanent)
        return textResult(JSON.stringify({
          success: true,
          deleted_count: count,
          permanent: input.permanent,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to delete email: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
