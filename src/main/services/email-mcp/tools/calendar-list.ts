/**
 * calendar_list — List calendar events within a date range.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { CalDavClient } from '../caldav-client'
import { textResult } from '../helpers'

export function createCalendarListTool(caldav: CalDavClient) {
  return tool(
    'calendar_list',
    "List calendar events within a date range. Returns event details including title, time, location, and attendees.\n\n" +
    "Use this to check the user's schedule, find upcoming meetings, or review past events.\n" +
    'Defaults to the next 7 days if no dates specified.\n\n' +
    'Example: { "start_date": "2026-04-14", "end_date": "2026-04-21" }',
    {
      start_date: z.string().optional().describe(
        'Start of date range. Format: "YYYY-MM-DD". Defaults to today.'
      ),
      end_date: z.string().optional().describe(
        'End of date range. Format: "YYYY-MM-DD". Defaults to start_date + 7 days.'
      ),
      limit: z.number().optional().describe(
        'Maximum number of events to return. Range: 1-100. Default: 20. Events are sorted by start time.'
      ),
    },
    async (input) => {
      try {
        const startDate = input.start_date || new Date().toISOString().slice(0, 10)
        const endDate = input.end_date || (() => {
          const d = new Date(startDate)
          d.setDate(d.getDate() + 7)
          return d.toISOString().slice(0, 10)
        })()

        const limit = Math.max(1, Math.min(100, input.limit ?? 20))
        let events = await caldav.listEvents(startDate, endDate)

        // Sort by start time ascending
        events.sort((a, b) => a.start.localeCompare(b.start))

        const hasMore = events.length > limit
        if (hasMore) {
          events = events.slice(0, limit)
        }

        return textResult(JSON.stringify({
          events,
          count: events.length,
          ...(hasMore ? { has_more: true } : {}),
          range: { start: startDate, end: endDate },
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to list calendar events: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
