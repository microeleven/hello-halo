/**
 * Input Tools (7 tools)
 *
 * User interaction simulation: click, hover, fill, form fill, drag,
 * key press, file upload.
 */

import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { BrowserContext } from '../context'
import { textResult, withTimeout, fillFormElement, TOOL_TIMEOUT } from './helpers'

export function buildInputTools(ctx: BrowserContext) {

const browser_click = tool(
  'browser_click',
  'Clicks on the provided element',
  {
    uid: z.string().describe('The uid of an element on the page from the page content snapshot'),
    dblClick: z.boolean().optional().describe('Set to true for double clicks. Default is false.')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page. Use browser_new_page first.', true)
    }

    try {
      await withTimeout(
        ctx.clickElement(args.uid, { dblClick: args.dblClick || false }),
        TOOL_TIMEOUT,
        'browser_click'
      )
      return textResult(
        args.dblClick
          ? 'Successfully double clicked on the element'
          : 'Successfully clicked on the element'
      )
    } catch (error) {
      return textResult(`Failed to click element ${args.uid}: ${(error as Error).message}`, true)
    }
  }
)

const browser_hover = tool(
  'browser_hover',
  'Hover over the provided element',
  {
    uid: z.string().describe('The uid of an element on the page from the page content snapshot')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    try {
      await withTimeout(
        ctx.hoverElement(args.uid),
        TOOL_TIMEOUT,
        'browser_hover'
      )
      return textResult('Successfully hovered over the element')
    } catch (error) {
      return textResult(`Failed to hover element ${args.uid}: ${(error as Error).message}`, true)
    }
  }
)

const browser_fill = tool(
  'browser_fill',
  'Type text into a input, text area or select an option from a <select> element.',
  {
    uid: z.string().describe('The uid of an element on the page from the page content snapshot'),
    value: z.string().describe('The value to fill in')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    try {
      await withTimeout(
        fillFormElement(ctx, args.uid, args.value),
        TOOL_TIMEOUT,
        'browser_fill'
      )
      return textResult('Successfully filled out the element')
    } catch (error) {
      return textResult(`Failed to fill element ${args.uid}: ${(error as Error).message}`, true)
    }
  }
)

const browser_fill_form = tool(
  'browser_fill_form',
  'Fill out multiple form elements at once',
  {
    elements: z.array(z.object({
      uid: z.string().describe('The uid of the element to fill out'),
      value: z.string().describe('Value for the element')
    })).describe('Elements from snapshot to fill out.')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    const errors: string[] = []

    for (const elem of args.elements) {
      try {
        await withTimeout(
          fillFormElement(ctx, elem.uid, elem.value),
          TOOL_TIMEOUT,
          'browser_fill_form'
        )
      } catch (error) {
        errors.push(`${elem.uid}: ${(error as Error).message}`)
      }
    }

    if (errors.length > 0) {
      return textResult(
        `Partially filled out the form.\n\nErrors:\n${errors.join('\n')}`,
        errors.length === args.elements.length
      )
    }

    return textResult('Successfully filled out the form')
  }
)

const browser_drag = tool(
  'browser_drag',
  'Drag an element onto another element',
  {
    from_uid: z.string().describe('The uid of the element to drag'),
    to_uid: z.string().describe('The uid of the element to drop into')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    try {
      await withTimeout(
        ctx.dragElement(args.from_uid, args.to_uid),
        TOOL_TIMEOUT,
        'browser_drag'
      )
      return textResult('Successfully dragged an element')
    } catch (error) {
      return textResult(`Failed to drag: ${(error as Error).message}`, true)
    }
  }
)

const browser_press_key = tool(
  'browser_press_key',
  'Press a key or key combination. Use this when other input methods like fill() cannot be used (e.g., keyboard shortcuts, navigation keys, or special key combinations).',
  {
    key: z.string().describe('A key or a combination (e.g., "Enter", "Control+A", "Control++", "Control+Shift+R"). Modifiers: Control, Shift, Alt, Meta')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    try {
      await withTimeout(
        ctx.pressKey(args.key),
        TOOL_TIMEOUT,
        'browser_press_key'
      )
      return textResult(`Successfully pressed key: ${args.key}`)
    } catch (error) {
      return textResult(`Failed to press key: ${(error as Error).message}`, true)
    }
  }
)

const browser_upload_file = tool(
  'browser_upload_file',
  'Upload a file through a provided element.',
  {
    uid: z.string().describe('The uid of the file input element or an element that will open file chooser on the page from the page content snapshot'),
    filePath: z.string().describe('The local path of the file to upload')
  },
  async (args) => {
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page.', true)
    }

    try {
      const element = ctx.getElementByUid(args.uid)
      if (!element) {
        throw new Error(`Element not found: ${args.uid}`)
      }

      await withTimeout(
        ctx.sendCDPCommand('DOM.setFileInputFiles', {
          backendNodeId: element.backendNodeId,
          files: [args.filePath]
        }),
        TOOL_TIMEOUT,
        'browser_upload_file'
      )

      return textResult(`File uploaded from ${args.filePath}.`)
    } catch (error) {
      return textResult(`Failed to upload file: ${(error as Error).message}`, true)
    }
  }
)

return [
  browser_click,
  browser_hover,
  browser_fill,
  browser_fill_form,
  browser_drag,
  browser_press_key,
  browser_upload_file
]

} // end buildInputTools
