/**
 * email_mark — Mark emails as read, unread, flagged, or unflagged.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import { textResult } from '../helpers'

export function createEmailMarkTool(imap: ImapClient) {
  return tool(
    'email_mark',
    'Mark emails as read, unread, flagged (starred), or unflagged. Supports batch operations on multiple emails.\n\n' +
    'Use this to manage email status — for example, marking processed emails as read, or flagging important ones.\n\n' +
    'Example (single): { "email_id": "10841", "action": "read" }\n' +
    'Example (batch):  { "email_id": "10841,10840,10839", "action": "read" }',
    {
      email_id: z.string().describe(
        'ID of the email(s) to update. Supports comma-separated IDs for batch operations. Example: "10841" or "10841,10840,10839"'
      ),
      action: z.enum(['read', 'unread', 'flag', 'unflag']).describe(
        'Action to perform: "read" marks as read, "unread" marks as unread, "flag" stars the email, "unflag" removes the star.'
      ),
      folder: z.string().default('INBOX').describe(
        'Folder containing the email(s). Defaults to INBOX.'
      ),
    },
    async (input) => {
      try {
        const ids = input.email_id.split(',').map(s => s.trim()).filter(Boolean)
        const count = await imap.markEmail(ids, input.action, input.folder)
        return textResult(JSON.stringify({
          success: true,
          updated_count: count,
          action: input.action,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to mark email: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
