/**
 * Navigation Tools (8 tools)
 *
 * Page lifecycle and navigation: list, select, create, close, navigate,
 * wait, resize, dialog handling.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { BrowserContext } from '../context'
import { browserViewManager } from '../../browser-view.service'
import { type DeviceMode } from '../../browser-view.service'
import { textResult, NAV_TIMEOUT } from './helpers'

export function buildNavigationTools(ctx: BrowserContext) {

const browser_list_pages = tool(
  'browser_list_pages',
  'Get a list of pages open in the browser.',
  {},
  async () => {
    const states = browserViewManager.getAllStates()

    if (states.length === 0) {
      return textResult('No browser pages are currently open.')
    }

    const lines = ['Open browser pages:']
    states.forEach((state, index) => {
      lines.push(`[${index}] ${state.title || 'Untitled'} - ${state.url || 'about:blank'}`)
    })

    return textResult(lines.join('\n'))
  }
)

const browser_select_page = tool(
  'browser_select_page',
  'Select a page as a context for future tool calls.',
  {
    pageIdx: z.number().describe('The index of the page to select. Call browser_list_pages to get available pages.'),
    bringToFront: z.boolean().optional().describe('Whether to focus the page and bring it to the top.')
  },
  async (args) => {
    const states = browserViewManager.getAllStates()

    if (args.pageIdx < 0 || args.pageIdx >= states.length) {
      return textResult(`Invalid page index: ${args.pageIdx}. Valid range: 0-${states.length - 1}`, true)
    }

    const state = states[args.pageIdx]
    ctx.setActiveViewId(state.id)

    return textResult(`Selected page [${args.pageIdx}]: ${state.title || 'Untitled'} - ${state.url}`)
  }
)

const browser_new_page = tool(
  'browser_new_page',
  'Creates a new browser page and navigates to a URL. Use device="h5" only when the user explicitly requests mobile view, or when the target site is known to be mobile-only (e.g. food delivery apps like Meituan, WeChat-specific pages). Default is PC mode.',
  {
    url: z.string().describe('URL to load in a new page.'),
    device: z.enum(['pc', 'h5']).optional().describe('Device mode: "pc" (default) for desktop, "h5" for mobile (iPhone UA, 390×844 viewport). Use h5 only when mobile view is needed.'),
    timeout: z.number().int().optional().describe('Maximum wait time in milliseconds. If set to 0, the default timeout will be used.')
  },
  async (args) => {
    const timeout = (args.timeout && args.timeout > 0) ? args.timeout : NAV_TIMEOUT
    const deviceMode: DeviceMode = args.device ?? 'pc'

    try {
      const viewId = `ai-browser-${Date.now()}`
      // Scoped (automation) contexts use the offscreen host window to isolate
      // view lifecycle from the user's mainWindow.
      await browserViewManager.create(viewId, args.url, {
        offscreen: ctx.isScoped,
        deviceMode,
      })
      ctx.trackView(viewId)
      ctx.setActiveViewId(viewId)

      // Wait for navigation with timeout protection (no busy-wait)
      await ctx.waitForNavigation(timeout)

      const finalState = browserViewManager.getState(viewId)
      const modeLabel = deviceMode === 'h5' ? ' [H5 mobile mode]' : ''
      return textResult(`Created new page${modeLabel}: ${finalState?.title || 'Untitled'} - ${finalState?.url || args.url}`)
    } catch (error) {
      return textResult(`Failed to create new page: ${(error as Error).message}`, true)
    }
  }
)

const browser_close_page = tool(
  'browser_close_page',
  'Closes the page by its index. The last open page cannot be closed.',
  {
    pageIdx: z.number().describe('The index of the page to close. Call list_pages to list pages.')
  },
  async (args) => {
    const states = browserViewManager.getAllStates()

    if (args.pageIdx < 0 || args.pageIdx >= states.length) {
      return textResult(`Invalid page index: ${args.pageIdx}`, true)
    }

    if (states.length === 1) {
      return textResult('The last open page cannot be closed.', true)
    }

    const state = states[args.pageIdx]
    browserViewManager.destroy(state.id)

    return textResult(`Closed page [${args.pageIdx}]: ${state.title || 'Untitled'}`)
  }
)

const browser_navigate = tool(
  'browser_navigate',
  'Navigates the currently selected page to a URL.',
  {
    type: z.enum(['url', 'back', 'forward', 'reload']).optional().describe('Navigate the page by URL, back or forward in history, or reload.'),
    url: z.string().optional().describe('Target URL (only type=url)'),
    ignoreCache: z.boolean().optional().describe('Whether to ignore cache on reload.'),
    timeout: z.number().int().optional().describe('Maximum wait time in milliseconds. If set to 0, the default timeout will be used.')
  },
  async (args) => {
    const navType = args.type || (args.url ? 'url' : undefined)
    const timeout = (args.timeout && args.timeout > 0) ? args.timeout : NAV_TIMEOUT

    if (!navType && !args.url) {
      return textResult('Either URL or a type is required.', true)
    }

    const viewId = ctx.getActiveViewId()
    if (!viewId) {
      return textResult('No active browser page. Use browser_new_page first.', true)
    }

    try {
      switch (navType) {
        case 'back':
          browserViewManager.goBack(viewId)
          await ctx.waitForNavigation(timeout)
          return textResult(`Successfully navigated back.`)
        case 'forward':
          browserViewManager.goForward(viewId)
          await ctx.waitForNavigation(timeout)
          return textResult(`Successfully navigated forward.`)
        case 'reload':
          browserViewManager.reload(viewId)
          await ctx.waitForNavigation(timeout)
          return textResult(`Successfully reloaded the page.`)
        case 'url':
        default:
          if (!args.url) {
            return textResult('A URL is required for navigation of type=url.', true)
          }
          await browserViewManager.navigate(viewId, args.url)
          await ctx.waitForNavigation(timeout)
          break
      }

      const finalState = browserViewManager.getState(viewId)
      return textResult(`Successfully navigated to ${finalState?.url || args.url}.`)
    } catch (error) {
      return textResult(`Unable to navigate in the selected page: ${(error as Error).message}.`, true)
    }
  }
)

const browser_wait_for = tool(
  'browser_wait_for',
  'Wait for the specified text to appear on the selected page.',
  {
    text: z.string().describe('Text to appear on the page'),
    timeout: z.number().int().optional().describe('Maximum wait time in milliseconds. If set to 0, the default timeout will be used.')
  },
  async (args) => {
    const timeout = (args.timeout && args.timeout > 0) ? args.timeout : NAV_TIMEOUT

    try {
      await ctx.waitForText(args.text, timeout)
      return textResult(`Element with text "${args.text}" found.`)
    } catch {
      return textResult(`Timeout waiting for text: "${args.text}"`, true)
    }
  }
)

const browser_resize = tool(
  'browser_resize',
  "Resizes the selected page's window so that the page has specified dimension",
  {
    width: z.number().describe('Page width'),
    height: z.number().describe('Page height')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    try {
      await ctx.setViewportSize(args.width, args.height)
      return textResult(`Viewport resized to: ${args.width}x${args.height}`)
    } catch (error) {
      return textResult(`Resize failed: ${(error as Error).message}`, true)
    }
  }
)

const browser_handle_dialog = tool(
  'browser_handle_dialog',
  'If a browser dialog was opened, use this command to handle it',
  {
    action: z.enum(['accept', 'dismiss']).describe('Whether to dismiss or accept the dialog'),
    promptText: z.string().optional().describe('Optional prompt text to enter into the dialog.')
  },
  async (args) => {
    const dialog = ctx.getPendingDialog()
    if (!dialog) {
      return textResult('No open dialog found', true)
    }

    try {
      await ctx.handleDialog(args.action === 'accept', args.promptText)
      return textResult(`Successfully ${args.action === 'accept' ? 'accepted' : 'dismissed'} the dialog`)
    } catch (error) {
      return textResult(`Failed to handle dialog: ${(error as Error).message}`, true)
    }
  }
)

return [
  browser_list_pages,
  browser_select_page,
  browser_new_page,
  browser_close_page,
  browser_navigate,
  browser_wait_for,
  browser_resize,
  browser_handle_dialog
]

} // end buildNavigationTools
