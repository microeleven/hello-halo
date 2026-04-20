/**
 * Email MCP — SMTP Client
 *
 * Handles sending emails, replies, and forwards via SMTP.
 * Uses nodemailer — same dependency and pattern as notify-channels/email.ts.
 *
 * Design: stateless per-send (no persistent connection). Each send creates
 * a transporter, sends, and disposes. This mirrors the notification channel
 * pattern and avoids connection management complexity.
 */

import type { EmailChannelConfig } from '../../../shared/types/notification-channels'

// Dynamic import for nodemailer
let nodemailerModule: typeof import('nodemailer') | null = null
async function getNodemailer() {
  if (!nodemailerModule) {
    nodemailerModule = await import('nodemailer')
  }
  return nodemailerModule
}

// ============================================
// Types
// ============================================

export interface SendEmailOptions {
  to: string
  subject: string
  body: string
  cc?: string
  bcc?: string
  isHtml?: boolean
  attachments?: string[]
}

export interface ReplyEmailOptions {
  to: string
  subject: string
  body: string
  cc?: string
  inReplyTo?: string
  references?: string
  quotedHtml?: string
}

export interface ForwardEmailOptions {
  to: string
  subject: string
  body: string
  cc?: string
  originalHtml?: string
  originalAttachments?: Array<{
    filename: string
    content: Buffer
    contentType: string
  }>
}

export interface SendResult {
  messageId: string
  sentTo: string[]
  sentAt: string
}

// ============================================
// SMTP Client
// ============================================

export class SmtpClient {
  private config: EmailChannelConfig

  constructor(config: EmailChannelConfig) {
    this.config = config
  }

  /**
   * Create a nodemailer transporter with the configured TLS settings.
   */
  private async createTransporter() {
    const nodemailer = await getNodemailer()
    return nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: {
        user: this.config.smtp.user,
        pass: this.config.smtp.password,
      },
      tls: {
        rejectUnauthorized: false,
        ...(this.config.tlsCiphers ? { ciphers: this.config.tlsCiphers } : {}),
      },
    })
  }

  /**
   * Send a new email.
   */
  async send(options: SendEmailOptions): Promise<SendResult> {
    const transporter = await this.createTransporter()
    const { basename } = await import('path')
    const { readFile } = await import('fs/promises')

    // Build attachment list
    const attachments: any[] = []
    if (options.attachments?.length) {
      for (const filePath of options.attachments) {
        try {
          const content = await readFile(filePath)
          const filename = basename(filePath)
          attachments.push({ filename, content })
        } catch (err) {
          throw new Error(`Failed to read attachment "${filePath}": ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    const mailOptions: any = {
      from: `"${this.config.smtp.user}" <${this.config.smtp.user}>`,
      to: options.to,
      subject: options.subject,
    }

    if (options.isHtml) {
      mailOptions.html = options.body
    } else {
      mailOptions.text = options.body
    }

    if (options.cc) mailOptions.cc = options.cc
    if (options.bcc) mailOptions.bcc = options.bcc
    if (attachments.length > 0) mailOptions.attachments = attachments

    console.log(`[EmailMCP][SMTP] Sending email to=${options.to}, subject="${options.subject}"`)
    const info = await transporter.sendMail(mailOptions)

    const sentTo = parseRecipients(options.to)
    console.log(`[EmailMCP][SMTP] Sent: messageId=${info.messageId}`)

    return {
      messageId: info.messageId || '',
      sentTo,
      sentAt: formatNow(),
    }
  }

  /**
   * Send a reply to an existing email.
   */
  async reply(options: ReplyEmailOptions): Promise<SendResult> {
    const transporter = await this.createTransporter()

    // Build reply body with quoted original
    let htmlBody = ''
    if (options.quotedHtml) {
      htmlBody = `<div>${escapeHtml(options.body).replace(/\n/g, '<br>')}</div>` +
        `<br><div style="border-left: 2px solid #ccc; padding-left: 12px; margin-left: 0; color: #666;">` +
        `${options.quotedHtml}</div>`
    }

    const mailOptions: any = {
      from: `"${this.config.smtp.user}" <${this.config.smtp.user}>`,
      to: options.to,
      subject: options.subject,
      text: options.body,
    }

    if (htmlBody) {
      mailOptions.html = htmlBody
    }
    if (options.cc) mailOptions.cc = options.cc
    if (options.inReplyTo) mailOptions.inReplyTo = options.inReplyTo
    if (options.references) mailOptions.references = options.references

    console.log(`[EmailMCP][SMTP] Sending reply to=${options.to}, subject="${options.subject}"`)
    const info = await transporter.sendMail(mailOptions)
    console.log(`[EmailMCP][SMTP] Reply sent: messageId=${info.messageId}`)

    return {
      messageId: info.messageId || '',
      sentTo: parseRecipients(options.to),
      sentAt: formatNow(),
    }
  }

  /**
   * Forward an existing email.
   */
  async forward(options: ForwardEmailOptions): Promise<SendResult> {
    const transporter = await this.createTransporter()

    // Build forward body
    let htmlBody = ''
    if (options.body) {
      htmlBody += `<div>${escapeHtml(options.body).replace(/\n/g, '<br>')}</div><br>`
    }
    if (options.originalHtml) {
      htmlBody += `<div style="border-top: 1px solid #ccc; padding-top: 12px;">` +
        `${options.originalHtml}</div>`
    }

    const mailOptions: any = {
      from: `"${this.config.smtp.user}" <${this.config.smtp.user}>`,
      to: options.to,
      subject: options.subject,
    }

    if (htmlBody) {
      mailOptions.html = htmlBody
      mailOptions.text = options.body
    } else {
      mailOptions.text = options.body
    }

    if (options.cc) mailOptions.cc = options.cc

    // Include original attachments
    if (options.originalAttachments?.length) {
      mailOptions.attachments = options.originalAttachments.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      }))
    }

    console.log(`[EmailMCP][SMTP] Forwarding to=${options.to}, subject="${options.subject}"`)
    const info = await transporter.sendMail(mailOptions)
    console.log(`[EmailMCP][SMTP] Forward sent: messageId=${info.messageId}`)

    return {
      messageId: info.messageId || '',
      sentTo: parseRecipients(options.to),
      sentAt: formatNow(),
    }
  }
}

// ============================================
// Helpers
// ============================================

function parseRecipients(addressStr: string): string[] {
  return addressStr.split(',').map(s => s.trim()).filter(Boolean)
}

function formatNow(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const h = d.getHours().toString().padStart(2, '0')
  const min = d.getMinutes().toString().padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
