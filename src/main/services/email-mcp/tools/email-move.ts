/**
 * email_move — Move an email from one folder to another.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import { textResult } from '../helpers'

export function createEmailMoveTool(imap: ImapClient) {
  return tool(
    'email_move',
    'Move an email from one folder to another. Use this to organize emails — for example, moving to a project folder or to trash.\n\n' +
    'Use friendly folder names: "Trash", "Junk", "Drafts", "Sent", or any custom folder name.\n' +
    'Use email_folders to discover available folders.\n\n' +
    'Example: { "email_id": "10841", "to_folder": "Trash" }',
    {
      email_id: z.string().describe(
        'ID of the email to move.'
      ),
      from_folder: z.string().default('INBOX').describe(
        'Source folder. Defaults to INBOX.'
      ),
      to_folder: z.string().describe(
        'Destination folder. Use friendly names: "Trash", "Junk", "Drafts", "Sent", or any custom folder name.'
      ),
    },
    async (input) => {
      try {
        await imap.moveEmail(input.email_id, input.from_folder, input.to_folder)
        return textResult(JSON.stringify({
          success: true,
          moved_from: input.from_folder,
          moved_to: input.to_folder,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to move email: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
