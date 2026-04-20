/**
 * calendar_delete — Delete a calendar event by its UID.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { CalDavClient } from '../caldav-client'
import { textResult } from '../helpers'

export function createCalendarDeleteTool(caldav: CalDavClient) {
  return tool(
    'calendar_delete',
    'Delete a calendar event by its UID. Use this when the user wants to cancel or remove an event.\n\n' +
    'IMPORTANT: This is a destructive action — the event will be removed immediately from the calendar.\n' +
    'Get the event UID from calendar_list results. Confirm with the user before deleting.\n\n' +
    'Example: { "uid": "9aed7014-53e5-4681-9e46-7287871f32c4" }',
    {
      uid: z.string().describe(
        'The event UID from calendar_list results. Example: "9aed7014-53e5-4681-9e46-7287871f32c4"'
      ),
    },
    async (input) => {
      try {
        await caldav.deleteEvent(input.uid)
        return textResult(JSON.stringify({
          success: true,
          deleted_uid: input.uid,
        }, null, 2))
      } catch (err) {
        return textResult(`Failed to delete calendar event: ${err instanceof Error ? err.message : String(err)}`, true)
      }
    }
  )
}
