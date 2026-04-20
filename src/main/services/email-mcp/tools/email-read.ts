/**
 * email_read — Read the full content of a specific email.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import { textResult } from '../helpers'

export function createEmailReadTool(imap: ImapClient) {
  return tool(
    'email_read',
    'Read the full content of a specific email by its ID. Returns the complete email body, headers, and attachment list.\n\n' +
    'Use this after email_list or email_search to read a specific message.\n' +
    'The email_id comes from the "id" field in email_list/email_search results.\n\n' +
    'Tip: Use format="text" for plain text (default), "html" for rich content, "full" for both.',
    {
      email_id: z.string().describe(
        'The email ID from email_list or email_search results. Example: "10841"'
      ),
      folder: z.string().default('INBOX').describe(
        'The folder containing the email. Defaults to INBOX.'
      ),
      format: z.enum(['text', 'html', 'full']).default('text').describe(
        'Response format: "text" = plain text body, "html" = HTML body, "full" = both.'
      ),
      max_body_length: z.number().int().min(0).default(5000).describe(
        'Maximum characters of body text to return. Set to 0 for unlimited. Default: 5000.'
      ),
    },
    async (input) => {
      try {
        const detail = await imap.readEmail(
          input.email_id,
          input.folder,
          input.format,
          input.max_body_length
        )
        return textResult(JSON.stringify(detail, null, 2))
      } catch (err) {
        return textResult(`Failed to read email: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
