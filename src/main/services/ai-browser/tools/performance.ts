/**
 * Performance Tools (3 tools)
 *
 * Performance tracing, metrics collection, and insight analysis.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { BrowserContext } from '../context'
import { browserViewManager } from '../../browser-view.service'
import { textResult, NAV_TIMEOUT } from './helpers'

// ============================================
// Helpers
// ============================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatTraceResults(duration: number, metrics: Record<string, number>): string {
  const lines = [
    'The performance trace has been stopped.',
    '',
    '## Trace Summary',
    `Duration: ${duration}ms`,
    '',
    '## Core Metrics'
  ]

  if (metrics.JSHeapUsedSize) lines.push(`JS Heap Used: ${formatBytes(metrics.JSHeapUsedSize)}`)
  if (metrics.JSHeapTotalSize) lines.push(`JS Heap Total: ${formatBytes(metrics.JSHeapTotalSize)}`)
  if (metrics.Nodes) lines.push(`DOM Nodes: ${metrics.Nodes}`)
  if (metrics.Documents) lines.push(`Documents: ${metrics.Documents}`)
  if (metrics.LayoutCount) lines.push(`Layout Count: ${metrics.LayoutCount}`)
  if (metrics.LayoutDuration) lines.push(`Layout Duration: ${(metrics.LayoutDuration * 1000).toFixed(2)}ms`)
  if (metrics.RecalcStyleCount) lines.push(`Recalc Style Count: ${metrics.RecalcStyleCount}`)
  if (metrics.ScriptDuration) lines.push(`Script Duration: ${(metrics.ScriptDuration * 1000).toFixed(2)}ms`)
  if (metrics.TaskDuration) lines.push(`Task Duration: ${(metrics.TaskDuration * 1000).toFixed(2)}ms`)

  lines.push('')
  lines.push('## Available Insight Sets')
  lines.push('Use browser_perf_insight with these insight sets:')
  lines.push('- insightSetId: "main", available insights: DocumentLatency, LCPBreakdown, RenderBlocking')

  return lines.join('\n')
}

// ============================================
// Tools
// ============================================

export function buildPerformanceTools(ctx: BrowserContext) {

const browser_perf_start = tool(
  'browser_perf_start',
  'Starts a performance trace recording on the selected page. This can be used to look for performance problems and insights to improve the performance of the page. It will also report Core Web Vital (CWV) scores for the page.',
  {
    reload: z.boolean().describe('Determines if, once tracing has started, the page should be automatically reloaded.'),
    autoStop: z.boolean().describe('Determines if the trace recording should be automatically stopped.')
  },
  async (args) => {
    const viewId = ctx.getActiveViewId()
    if (!viewId) {
      return textResult('No active browser page.', true)
    }

    if (ctx.isPerformanceTracing()) {
      return textResult(
        'Error: a performance trace is already running. Use browser_perf_stop to stop it. Only one trace can be running at any given time.',
        true
      )
    }

    try {
      if (args.reload) {
        const currentUrl = ctx.getPageUrl()
        await browserViewManager.navigate(viewId, 'about:blank')
        await new Promise(resolve => setTimeout(resolve, 500))

        await ctx.startPerformanceTrace()

        await browserViewManager.navigate(viewId, currentUrl)
        await ctx.waitForNavigation(NAV_TIMEOUT)
      } else {
        await ctx.startPerformanceTrace()
      }

      if (args.autoStop) {
        await new Promise(resolve => setTimeout(resolve, 5000))

        const { duration, metrics } = await ctx.stopPerformanceTrace()
        return textResult(formatTraceResults(duration, metrics))
      }

      return textResult('The performance trace is being recorded. Use browser_perf_stop to stop it.')
    } catch (error) {
      return textResult(`Failed to start trace: ${(error as Error).message}`, true)
    }
  }
)

const browser_perf_stop = tool(
  'browser_perf_stop',
  'Stops the active performance trace recording on the selected page.',
  {},
  async () => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    if (!ctx.isPerformanceTracing()) {
      return textResult('No performance trace is running.')
    }

    try {
      const { duration, metrics } = await ctx.stopPerformanceTrace()
      return textResult(formatTraceResults(duration, metrics))
    } catch (error) {
      return textResult(`Failed to stop trace: ${(error as Error).message}`, true)
    }
  }
)

const browser_perf_insight = tool(
  'browser_perf_insight',
  'Provides more detailed information on a specific Performance Insight of an insight set that was highlighted in the results of a trace recording.',
  {
    insightSetId: z.string().describe('The id for the specific insight set. Only use the ids given in the "Available insight sets" list.'),
    insightName: z.string().describe('The name of the Insight you want more information on. For example: "DocumentLatency" or "LCPBreakdown"')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    try {
      const metrics = await ctx.getPerformanceMetrics()

      const lines: string[] = [
        `# Performance Insight: ${args.insightName}`,
        `Insight Set: ${args.insightSetId}`,
        ''
      ]

      switch (args.insightName.toLowerCase()) {
        case 'documentlatency':
          lines.push('## Document Latency Analysis')
          lines.push(`Task Duration: ${(metrics.TaskDuration * 1000).toFixed(2)}ms`)
          lines.push(`Script Duration: ${(metrics.ScriptDuration * 1000).toFixed(2)}ms`)
          if (metrics.TaskDuration > 0.05) {
            lines.push('')
            lines.push('Long tasks detected. Consider:')
            lines.push('- Breaking up long-running JavaScript')
            lines.push('- Using requestIdleCallback for non-urgent work')
            lines.push('- Web Workers for heavy computation')
          }
          break

        case 'lcpbreakdown':
          lines.push('## LCP (Largest Contentful Paint) Breakdown')
          lines.push(`Layout Count: ${metrics.LayoutCount}`)
          lines.push(`Layout Duration: ${(metrics.LayoutDuration * 1000).toFixed(2)}ms`)
          lines.push(`Recalc Style Count: ${metrics.RecalcStyleCount}`)
          lines.push('')
          lines.push('Recommendations:')
          lines.push('- Optimize critical rendering path')
          lines.push('- Preload LCP resources')
          lines.push('- Reduce render-blocking resources')
          break

        case 'renderblocking':
          lines.push('## Render Blocking Resources')
          lines.push(`Documents: ${metrics.Documents}`)
          lines.push(`Frames: ${metrics.Frames}`)
          lines.push('')
          lines.push('Recommendations:')
          lines.push('- Use async/defer for scripts')
          lines.push('- Inline critical CSS')
          lines.push('- Preconnect to required origins')
          break

        default:
          lines.push('## General Performance Metrics')
          lines.push(`JS Heap Used: ${formatBytes(metrics.JSHeapUsedSize)}`)
          lines.push(`JS Heap Total: ${formatBytes(metrics.JSHeapTotalSize)}`)
          lines.push(`DOM Nodes: ${metrics.Nodes}`)
          lines.push(`Layout Count: ${metrics.LayoutCount}`)
          lines.push(`Script Duration: ${(metrics.ScriptDuration * 1000).toFixed(2)}ms`)
      }

      return textResult(lines.join('\n'))
    } catch (error) {
      return textResult(`Failed to analyze insight: ${(error as Error).message}`, true)
    }
  }
)

return [
  browser_perf_start,
  browser_perf_stop,
  browser_perf_insight
]

} // end buildPerformanceTools
