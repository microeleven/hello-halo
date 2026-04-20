/**
 * email_folders — List all available mailbox folders.
 */

import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import { textResult } from '../helpers'

export function createEmailFoldersTool(imap: ImapClient) {
  return tool(
    'email_folders',
    'List all available mailbox folders. Returns both system folders (Inbox, Sent, Drafts, Trash) and user-created folders.\n\n' +
    'Use this to discover what folders exist before moving emails or searching in specific folders.\n' +
    'Each folder shows its display name, type (system/custom), and message/unread counts.',
    {},
    async () => {
      try {
        const folders = await imap.listFolders()
        return textResult(JSON.stringify({ folders }, null, 2))
      } catch (err) {
        return textResult(`Failed to list folders: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
