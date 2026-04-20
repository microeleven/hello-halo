/**
 * email_list — List emails in a mailbox folder.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import { textResult } from '../helpers'

export function createEmailListTool(imap: ImapClient) {
  return tool(
    'email_list',
    'List emails in a mailbox folder. Returns email summaries (subject, sender, date, read status) sorted newest-first.\n\n' +
    'Use this to check for new messages, review recent emails, or get a folder overview.\n' +
    'For full email content, use email_read with the returned email ID.\n\n' +
    'Common folders: "INBOX" (default), "Sent", "Drafts", "Trash", "Junk".\n' +
    'Use email_folders to discover all available folders.',
    {
      folder: z.string().default('INBOX').describe(
        'Mailbox folder name. Common values: "INBOX", "Sent", "Drafts", "Trash", "Junk". Use email_folders to discover all available folders.'
      ),
      limit: z.number().int().min(1).max(100).default(20).describe(
        'Maximum number of emails to return (1-100). Emails are returned newest-first.'
      ),
      unread_only: z.boolean().default(false).describe(
        'If true, only return unread (unseen) emails. Useful for checking what needs attention.'
      ),
    },
    async (input) => {
      try {
        const result = await imap.listEmails(input.folder, input.limit, input.unread_only)
        return textResult(JSON.stringify({
          total_in_folder: result.total,
          unread_count: result.unread,
          returned: result.emails.length,
          emails: result.emails,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to list emails: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
