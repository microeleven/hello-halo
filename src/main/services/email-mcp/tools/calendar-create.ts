/**
 * calendar_create — Create a new calendar event or meeting.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { CalDavClient } from '../caldav-client'
import { textResult } from '../helpers'

export function createCalendarCreateTool(caldav: CalDavClient) {
  return tool(
    'calendar_create',
    'Create a new calendar event or meeting. Can include attendees for meetings.\n\n' +
    'IMPORTANT: This is a destructive action — the event will be created immediately on the calendar.\n' +
    'Example: { "summary": "Team standup", "start": "2026-04-15 10:00", "end": "2026-04-15 10:30", "location": "Room 508" }',
    {
      summary: z.string().describe(
        'Event title. Example: "Team standup"'
      ),
      start: z.string().describe(
        'Start datetime. Format: "YYYY-MM-DD HH:MM". Example: "2026-04-15 10:00"'
      ),
      end: z.string().describe(
        'End datetime. Format: "YYYY-MM-DD HH:MM". Example: "2026-04-15 11:00"'
      ),
      description: z.string().default('').describe(
        'Event description or agenda.'
      ),
      location: z.string().default('').describe(
        'Event location (room name, address, or "Online").'
      ),
      attendees: z.array(z.string()).optional().describe(
        'List of attendee email addresses. Example: ["alice@example.com", "bob@example.com"]'
      ),
      reminder_minutes: z.number().int().min(0).default(15).describe(
        'Reminder before event in minutes. Set to 0 for no reminder. Default: 15.'
      ),
    },
    async (input) => {
      try {
        const uid = await caldav.createEvent({
          summary: input.summary,
          start: input.start,
          end: input.end,
          description: input.description || undefined,
          location: input.location || undefined,
          attendees: input.attendees,
          reminderMinutes: input.reminder_minutes,
        })
        return textResult(JSON.stringify({
          success: true,
          uid,
          summary: input.summary,
          start: input.start,
          end: input.end,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to create calendar event: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
