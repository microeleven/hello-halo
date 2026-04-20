/**
 * email_reply — Reply to an existing email.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import type { SmtpClient } from '../smtp-client'
import { textResult } from '../helpers'

export function createEmailReplyTool(imap: ImapClient, smtp: SmtpClient, userEmail: string) {
  return tool(
    'email_reply',
    'Reply to an existing email. The reply includes the original message quoted below your response.\n\n' +
    'IMPORTANT: This is a destructive action — the reply will be sent immediately.\n' +
    'Use reply_all=true to reply to all original recipients (Reply All).\n' +
    'Example: { "email_id": "10841", "body": "Thank you for the update. I will review this." }',
    {
      email_id: z.string().describe(
        'ID of the email to reply to (from email_list or email_search results).'
      ),
      body: z.string().describe(
        'Reply content in plain text.'
      ),
      folder: z.string().default('INBOX').describe(
        'Folder containing the original email.'
      ),
      reply_all: z.boolean().default(false).describe(
        'If true, reply to all recipients (Reply All). If false, reply only to sender.'
      ),
      cc: z.string().optional().describe(
        'Additional CC recipients beyond the original.'
      ),
    },
    async (input) => {
      try {
        // Fetch original email for reply context
        const raw = await imap.getRawMessage(input.email_id, input.folder)
        const { simpleParser } = await import('mailparser')
        const parsed = await simpleParser(raw.source)

        const originalFrom = raw.envelope?.from?.[0]
        const replyTo = originalFrom
          ? (originalFrom.address || '')
          : ''

        if (!replyTo) {
          return textResult('Cannot reply: original email has no sender address.', true)
        }

        // Build recipient list
        let to = replyTo
        let cc = input.cc || ''

        if (input.reply_all) {
          // Include all original To and CC, excluding self
          const allTo = (raw.envelope?.to || [])
            .map((a: any) => a.address)
            .filter((addr: string) => addr && addr.toLowerCase() !== userEmail.toLowerCase())

          const allCc = (raw.envelope?.cc || [])
            .map((a: any) => a.address)
            .filter((addr: string) => addr && addr.toLowerCase() !== userEmail.toLowerCase())

          if (allTo.length > 0) {
            to = [replyTo, ...allTo.filter((a: string) => a !== replyTo)].join(', ')
          }
          if (allCc.length > 0) {
            cc = cc ? `${cc}, ${allCc.join(', ')}` : allCc.join(', ')
          }
        }

        // Build subject
        const originalSubject = raw.envelope?.subject || ''
        const subject = originalSubject.startsWith('Re:')
          ? originalSubject
          : `Re: ${originalSubject}`

        // Build reply with threading headers
        const messageId = raw.envelope?.messageId || ''
        const references = raw.envelope?.inReplyTo
          ? `${raw.envelope.inReplyTo} ${messageId}`
          : messageId

        const result = await smtp.reply({
          to,
          subject,
          body: input.body,
          cc: cc || undefined,
          inReplyTo: messageId,
          references,
          quotedHtml: parsed.html || undefined,
        })

        return textResult(JSON.stringify({
          success: true,
          replied_to: replyTo,
          subject,
          message_id: result.messageId,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to reply: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
