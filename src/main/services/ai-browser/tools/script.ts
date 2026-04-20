/**
 * Script Execution Tools (1 tool)
 *
 * Execute pre-built JavaScript files in the browser page context.
 */

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { z } from 'zod'
import { tool } from '../../agent/resolved-sdk'
import type { BrowserContext } from '../context'
import { textResult, withTimeout } from './helpers'

/** Max timeout for browser_run scripts (ms). */
const BROWSER_RUN_MAX_TIMEOUT = 120_000
/** Default timeout for browser_run scripts (ms). */
const BROWSER_RUN_DEFAULT_TIMEOUT = 60_000

/**
 * Check whether `filePath` is inside a `.claude/skills/` directory that is
 * rooted at an ancestor of `workDir` (or at $HOME).
 *
 * This prevents arbitrary paths like `/tmp/.claude/skills/evil.js` from
 * passing the whitelist while still allowing the standard Claude convention
 * where `.claude/skills/` can live at any ancestor of the project root.
 */
function isUnderSkillsDir(filePath: string, workDir: string): boolean {
  const marker = `${path.sep}.claude${path.sep}skills${path.sep}`
  const idx = filePath.indexOf(marker)
  if (idx < 0) return false

  // The directory that contains `.claude/skills/`
  const root = filePath.substring(0, idx)

  // Allow if the root is $HOME
  if (root === os.homedir()) return true

  // Allow if the root is an ancestor of (or equal to) workDir.
  // e.g. workDir = /workspace/project, root = /workspace  → allowed
  //      workDir = /workspace/project, root = /tmp         → denied
  return workDir === root || workDir.startsWith(root + path.sep)
}

export function buildScriptTools(ctx: BrowserContext) {

const browser_run = tool(
  'browser_run',
  `Execute a JavaScript file in the current browser page context. The file must contain a single async arrow function: \`async (params) => { ... return result }\`. The tool reads the file from disk, injects it into the page, and returns the JSON result. The page must already be navigated to the target URL (use browser_navigate first). Use this for pre-built, deterministic browser scripts instead of writing inline code with browser_evaluate.`,
  {
    file: z.string().describe(
      'Absolute path to the .js file to execute. The file must contain a single async arrow function: `async (params) => { ... return result }`'
    ),
    params: z.record(z.unknown()).optional().describe(
      'Parameters object passed as the first argument to the script function'
    ),
    timeout: z.number().optional().describe(
      `Execution timeout in ms. Default: ${BROWSER_RUN_DEFAULT_TIMEOUT}. Max: ${BROWSER_RUN_MAX_TIMEOUT}.`
    ),
  },
  async (args) => {
    // 1. Validate active page
    if (!ctx.getActiveViewId()) {
      return textResult('No active browser page. Use browser_navigate first.', true)
    }

    // 2. Resolve and validate file path.
    //    Relative paths are resolved against ctx.workDir (the space's working
    //    directory, set at MCP server creation), matching the cwd that the
    //    Claude SDK session itself uses.  Absolute paths are used as-is.
    const baseDir = ctx.workDir ?? process.cwd()
    const resolved = path.isAbsolute(args.file)
      ? path.normalize(args.file)
      : path.resolve(baseDir, args.file)
    console.log(`[browser_run] file="${args.file}" baseDir="${baseDir}" resolved="${resolved}" timeout=${args.timeout ?? BROWSER_RUN_DEFAULT_TIMEOUT}`)

    if (!resolved.endsWith('.js')) {
      return textResult(`Invalid file type: expected .js file, got "${path.extname(resolved) || '(no extension)'}".`, true)
    }

    // Path whitelist: .claude/skills/ directories (rooted at an ancestor of
    // baseDir or $HOME) or the space working directory itself.
    const isInSkills = isUnderSkillsDir(resolved, baseDir)
    const isInWorkDir = resolved.startsWith(baseDir + path.sep) || resolved === baseDir

    if (!isInSkills && !isInWorkDir) {
      return textResult(
        `Path not allowed: "${resolved}". Scripts must be within a .claude/skills/ directory or the space working directory.`,
        true
      )
    }

    if (!fs.existsSync(resolved)) {
      return textResult(`File not found: "${resolved}".`, true)
    }

    // 3. Read script from disk (fresh each time — supports hot reload during development)
    let scriptContent: string
    try {
      scriptContent = fs.readFileSync(resolved, 'utf-8').trim()
      // Strip trailing semicolons — the file is wrapped as (script)(args) by
      // evaluateScript, so a trailing `;` would produce `(...;)(args)` which
      // is a SyntaxError.  This is a common AI-generation mistake.
      scriptContent = scriptContent.replace(/;+\s*$/, '')
    } catch (error) {
      return textResult(`Failed to read file: ${(error as Error).message}`, true)
    }

    if (!scriptContent) {
      return textResult(`File is empty: "${resolved}".`, true)
    }

    // 4. Execute in browser page context
    const timeout = Math.min(
      Math.max(args.timeout ?? BROWSER_RUN_DEFAULT_TIMEOUT, 1000),
      BROWSER_RUN_MAX_TIMEOUT
    )
    console.log(`[browser_run] executing script, length=${scriptContent.length}, timeout=${timeout}ms`)

    try {
      const result = await withTimeout(
        ctx.evaluateScript(scriptContent, [args.params ?? {}], timeout),
        timeout,
        'browser_run'
      )
      console.log(`[browser_run] script completed, result type=${typeof result}`)
      const resultStr = typeof result === 'object'
        ? JSON.stringify(result, null, 2)
        : String(result)

      return textResult(`Script executed successfully.\n\`\`\`json\n${resultStr}\n\`\`\``)
    } catch (error) {
      return textResult(`Script execution failed: ${(error as Error).message}`, true)
    }
  }
)

return [
  browser_run
]

} // end buildScriptTools
