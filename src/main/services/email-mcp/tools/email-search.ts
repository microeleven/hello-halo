/**
 * email_search — Search for emails matching specific criteria.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import { textResult } from '../helpers'

export function createEmailSearchTool(imap: ImapClient) {
  return tool(
    'email_search',
    'Search for emails matching specific criteria. Supports searching by subject, sender, recipient, and date range.\n\n' +
    'At least one search parameter must be provided. Supports Chinese keywords.\n' +
    'Results are sorted newest-first. Use email_read to get full content of found emails.\n\n' +
    'Examples:\n' +
    '- Find emails from someone: { "from": "john@example.com" }\n' +
    '- Find by subject: { "subject": "meeting notes" }\n' +
    '- Find recent emails: { "since": "2026-04-01" }',
    {
      folder: z.string().default('INBOX').describe(
        'Folder to search in. Defaults to INBOX.'
      ),
      subject: z.string().optional().describe(
        'Search emails where subject contains this keyword. Supports Chinese. Example: "meeting notes"'
      ),
      from: z.string().optional().describe(
        'Search emails from this sender. Can be name or email address. Example: "john" or "john@example.com"'
      ),
      to: z.string().optional().describe(
        'Search emails sent to this recipient.'
      ),
      since: z.string().optional().describe(
        'Search emails received on or after this date. Format: "YYYY-MM-DD". Example: "2026-04-01"'
      ),
      before: z.string().optional().describe(
        'Search emails received before this date. Format: "YYYY-MM-DD".'
      ),
      limit: z.number().int().min(1).max(50).default(20).describe(
        'Maximum results to return (1-50). Default: 20.'
      ),
    },
    async (input) => {
      // Validate at least one search parameter is provided
      if (!input.subject && !input.from && !input.to && !input.since && !input.before) {
        return textResult(
          'At least one search parameter (subject, from, to, since, or before) must be provided.',
          true
        )
      }

      try {
        const result = await imap.searchEmails(
          input.folder,
          {
            subject: input.subject,
            from: input.from,
            to: input.to,
            since: input.since,
            before: input.before,
          },
          input.limit
        )
        return textResult(JSON.stringify({
          found: result.emails.length,
          emails: result.emails,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to search emails: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
