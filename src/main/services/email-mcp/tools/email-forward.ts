/**
 * email_forward — Forward an existing email to new recipients.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { ImapClient } from '../imap-client'
import type { SmtpClient } from '../smtp-client'
import { textResult } from '../helpers'

export function createEmailForwardTool(imap: ImapClient, smtp: SmtpClient) {
  return tool(
    'email_forward',
    'Forward an existing email to new recipients. The original email content and attachments are included.\n\n' +
    'IMPORTANT: This is a destructive action — the forwarded email will be sent immediately.\n' +
    'Optionally prepend your own message before the forwarded content.\n\n' +
    'Example: { "email_id": "10841", "to": "colleague@example.com", "body": "FYI — see below." }',
    {
      email_id: z.string().describe(
        'ID of the email to forward (from email_list or email_search results).'
      ),
      to: z.string().describe(
        'Recipient(s) to forward to. Multiple addresses separated by commas.'
      ),
      folder: z.string().default('INBOX').describe(
        'Folder containing the original email.'
      ),
      body: z.string().default('').describe(
        'Optional message to prepend before the forwarded content.'
      ),
      cc: z.string().optional().describe(
        'CC recipients.'
      ),
    },
    async (input) => {
      try {
        const raw = await imap.getRawMessage(input.email_id, input.folder)
        const { simpleParser } = await import('mailparser')
        const parsed = await simpleParser(raw.source)

        const originalSubject = raw.envelope?.subject || ''
        const subject = originalSubject.startsWith('Fwd:')
          ? originalSubject
          : `Fwd: ${originalSubject}`

        // Build forwarded body with original headers
        const originalFrom = raw.envelope?.from?.[0]
        const fromStr = originalFrom
          ? (originalFrom.name ? `${originalFrom.name} <${originalFrom.address}>` : originalFrom.address)
          : 'Unknown'
        const originalTo = raw.envelope?.to?.map((a: any) =>
          a.name ? `${a.name} <${a.address}>` : a.address
        ).join(', ') || ''
        const originalDate = raw.envelope?.date ? new Date(raw.envelope.date).toLocaleString() : ''

        let forwardHtml = ''
        if (parsed.html) {
          forwardHtml =
            `<p><strong>---------- Forwarded message ----------</strong></p>` +
            `<p><strong>From:</strong> ${escapeHtml(fromStr)}<br>` +
            `<strong>Date:</strong> ${escapeHtml(originalDate)}<br>` +
            `<strong>Subject:</strong> ${escapeHtml(originalSubject)}<br>` +
            `<strong>To:</strong> ${escapeHtml(originalTo)}</p>` +
            parsed.html
        }

        // Include original attachments
        const originalAttachments = (parsed.attachments || []).map((att: any) => ({
          filename: att.filename || 'unnamed',
          content: att.content,
          contentType: att.contentType || 'application/octet-stream',
        }))

        const result = await smtp.forward({
          to: input.to,
          subject,
          body: input.body || '',
          cc: input.cc,
          originalHtml: forwardHtml || undefined,
          originalAttachments: originalAttachments.length > 0 ? originalAttachments : undefined,
        })

        return textResult(JSON.stringify({
          success: true,
          forwarded_to: result.sentTo,
          original_subject: subject,
          message_id: result.messageId,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to forward email: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
