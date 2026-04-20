/**
 * Network Tools (2 tools)
 *
 * Network request monitoring and inspection.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { BrowserContext } from '../context'
import { textResult } from './helpers'

export function buildNetworkTools(ctx: BrowserContext) {

const browser_network_requests = tool(
  'browser_network_requests',
  'List all requests for the currently selected page since the last navigation.',
  {
    pageSize: z.number().int().positive().optional().describe('Maximum number of requests to return. When omitted, returns all requests.'),
    pageIdx: z.number().int().min(0).optional().describe('Page number to return (0-based). When omitted, returns the first page.'),
    resourceTypes: z.array(z.string()).optional().describe('Filter requests to only return requests of the specified resource types. When omitted or empty, returns all requests.'),
    includePreservedRequests: z.boolean().optional().describe('Set to true to return the preserved requests over the last 3 navigations.')
  },
  async (args) => {
    try {
      let requests = ctx.getNetworkRequests(args.includePreservedRequests || false)

      // Filter by resource type
      if (args.resourceTypes && args.resourceTypes.length > 0) {
        const types = new Set(args.resourceTypes.map(t => t.toLowerCase()))
        requests = requests.filter(r => types.has(r.resourceType.toLowerCase()))
      }

      const total = requests.length

      // Pagination
      const pageIdx = args.pageIdx || 0
      let pageRequests: typeof requests
      if (args.pageSize !== undefined) {
        const startIdx = pageIdx * args.pageSize
        const endIdx = Math.min(startIdx + args.pageSize, total)
        pageRequests = requests.slice(startIdx, endIdx)
      } else {
        pageRequests = requests
      }

      if (pageRequests.length === 0) {
        return textResult('No network requests captured.')
      }

      const lines: string[] = []
      if (args.pageSize !== undefined) {
        const startIdx = pageIdx * args.pageSize
        const endIdx = Math.min(startIdx + args.pageSize, total)
        lines.push(`Network Requests (${startIdx + 1}-${endIdx} of ${total}):`)
      } else {
        lines.push(`Network Requests (${total} total):`)
      }
      lines.push('')

      for (const req of pageRequests) {
        const status = req.status ? `${req.status}` : 'pending'
        const duration = req.timing?.duration ? `${req.timing.duration}ms` : '-'
        lines.push(`[reqid=${req.id}] ${req.method} ${status} ${req.resourceType}`)
        lines.push(`    URL: ${req.url.substring(0, 100)}${req.url.length > 100 ? '...' : ''}`)
        lines.push(`    Duration: ${duration}`)
        if (req.error) {
          lines.push(`    Error: ${req.error}`)
        }
        lines.push('')
      }

      if (args.pageSize !== undefined && pageIdx * args.pageSize + pageRequests.length < total) {
        lines.push(`Use pageIdx=${pageIdx + 1} to see more requests.`)
      }

      return textResult(lines.join('\n'))
    } catch (error) {
      return textResult(`Failed to get network requests: ${(error as Error).message}`, true)
    }
  }
)

const browser_network_request = tool(
  'browser_network_request',
  'Gets a network request by an optional reqid, if omitted returns the currently selected request in the DevTools Network panel.',
  {
    reqid: z.number().optional().describe('The reqid of the network request.')
  },
  async (args) => {
    try {
      let request

      if (args.reqid !== undefined) {
        request = ctx.getNetworkRequest(`req_${args.reqid}`)
      } else {
        const selectedReq = (ctx as any).getSelectedNetworkRequest?.()
        if (!selectedReq) {
          return textResult('Nothing is currently selected in the DevTools Network panel.')
        }
        request = selectedReq
      }

      if (!request) {
        return textResult(`Request not found: ${args.reqid}`, true)
      }

      const lines = [
        `# Network Request: reqid=${request.id}`,
        '',
        `## Basic Info`,
        `URL: ${request.url}`,
        `Method: ${request.method}`,
        `Resource Type: ${request.resourceType}`,
        `Status: ${request.status || 'pending'} ${request.statusText || ''}`,
        `MIME Type: ${request.mimeType || 'unknown'}`,
        ''
      ]

      if (request.timing) {
        lines.push(`## Timing`)
        lines.push(`Duration: ${request.timing.duration}ms`)
        lines.push('')
      }

      if (request.requestHeaders && Object.keys(request.requestHeaders).length > 0) {
        lines.push(`## Request Headers`)
        for (const [key, value] of Object.entries(request.requestHeaders)) {
          lines.push(`${key}: ${value}`)
        }
        lines.push('')
      }

      if (request.responseHeaders && Object.keys(request.responseHeaders).length > 0) {
        lines.push(`## Response Headers`)
        for (const [key, value] of Object.entries(request.responseHeaders)) {
          lines.push(`${key}: ${value}`)
        }
        lines.push('')
      }

      if (request.requestBody) {
        lines.push(`## Request Body`)
        lines.push('```')
        lines.push(request.requestBody.substring(0, 2000))
        if (request.requestBody.length > 2000) {
          lines.push('... (truncated)')
        }
        lines.push('```')
        lines.push('')
      }

      // Fetch response body via CDP Network.getResponseBody
      const responseBody = await ctx.getNetworkResponseBody(request.id)
      if (responseBody) {
        lines.push(`## Response Body`)
        lines.push('```')
        lines.push(responseBody.substring(0, 4000))
        if (responseBody.length > 4000) {
          lines.push(`... (truncated, total ${responseBody.length} chars)`)
        }
        lines.push('```')
        lines.push('')
      }

      if (request.error) {
        lines.push(`## Error`)
        lines.push(request.error)
      }

      return textResult(lines.join('\n'))
    } catch (error) {
      return textResult(`Failed to get request details: ${(error as Error).message}`, true)
    }
  }
)

return [
  browser_network_requests,
  browser_network_request
]

} // end buildNetworkTools
