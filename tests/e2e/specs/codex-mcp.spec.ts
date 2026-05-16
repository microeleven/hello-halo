/**
 * Codex + MCP UI E2E Test (Instrumented)
 *
 * What this test verifies (the user's stated guard):
 *   When `agent.sdkEngine = "codex"`, Halo correctly loads its built-in MCP
 *   servers (e.g. `web-search`) into the Codex thread, AND the model can
 *   actually invoke those MCP tools during a turn.
 *
 * Instrumentation (per team-lead diagnostic request):
 *   - Captures Electron main-process stdout AND stderr through a fixture-level
 *     hook on `electronApp.process()`. Saved to tests/e2e/codex-mcp-electron.log.
 *   - Captures EVERY thought type (including `system` envelopes that codex's
 *     event-normalizer emits) into __codexThoughts AND __codexSystemEvents.
 *   - Polls Electron stdout for 30s for `mcpServer/startupStatus`-equivalents
 *     and Codex error lines BEFORE the hard tool_use assertion.
 *   - Soft-asserts presence of four canonical log signatures and dumps the
 *     boolean checks to stdout / markdown summary.
 *   - Always writes the full diagnostic dump to tests/e2e/codex-mcp-result.md
 *     even on failure.
 *
 * The four canonical log signatures we look for in Electron stdout:
 *   1. `[SDK] Active engine: Codex SDK`            — engine swapped
 *   2. `[Agent][...] SDK options: ... mcpServers=[...non-empty...]` — sdkOptions OK
 *   3. `[Codex][mcp] SDK MCP bridge listening on 127.0.0.1:<port> for [...]` — bridge prepared
 *   4. `[Codex][session] initialized`              — codex handshake completed
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { test, expect, codexAvailability } from '../fixtures/codex-electron'
import { navigateToChat } from '../fixtures/helpers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface CapturedThought {
  type: string
  subtype?: string
  name?: string
  input?: unknown
  output?: unknown
  text?: string
  raw?: unknown
  ts: number
}

interface CapturedSystemEvent {
  subtype?: string
  tools?: unknown
  mcp_servers?: unknown
  raw?: unknown
  ts: number
}

const RESULT_PATH = path.resolve(__dirname, '..', 'codex-mcp-result.md')
const TEST_PROMPT =
  'Use the mcp__web-search__web_search tool to search for "halo codex test". ' +
  'Call the tool exactly once, then briefly summarize the result. ' +
  'Do not refuse and do not use any other tool.'

// Canonical log signatures we expect during a healthy Codex+MCP boot.
const LOG_SIGNATURES = [
  {
    key: 'engineActive',
    label: '[SDK] Active engine: Codex',
    test: (line: string) => /\[SDK\]\s+Active engine:\s*Codex/i.test(line),
  },
  {
    key: 'sdkOptionsMcp',
    label: '[Agent][...] SDK options: ... mcpServers=[<non-empty>]',
    test: (line: string) => {
      const m = line.match(/\[Agent\]\[[^\]]+\]\s+SDK options:.*mcpServers=\[([^\]]*)\]/)
      if (!m) return false
      return m[1].trim().length > 0
    },
  },
  {
    key: 'mcpBridgeListening',
    label: '[Codex][mcp] SDK MCP bridge listening on 127.0.0.1:<port> for [<non-empty>]',
    test: (line: string) => {
      const m = line.match(/\[Codex\]\[mcp\]\s+SDK MCP bridge listening on 127\.0\.0\.1:\d+\s+for\s+\[([^\]]*)\]/)
      if (!m) return false
      return m[1].trim().length > 0
    },
  },
  {
    key: 'codexSessionInit',
    label: '[Codex][session] initialized',
    test: (line: string) => /\[Codex\]\[session\]\s+initialized/i.test(line),
  },
] as const

type LogSignatureKey = (typeof LOG_SIGNATURES)[number]['key']

test.describe('Codex MCP integration (UI E2E)', () => {
  test.beforeAll(({}, testInfo) => {
    if (!codexAvailability.ok) {
      testInfo.skip(true, `[codex-mcp] SKIP: ${codexAvailability.reason}`)
    }
  })

  // Codex cold-start + a real model turn with a tool call needs generous time.
  test.setTimeout(240_000)

  test('Codex turn invokes Halo built-in MCP tool web-search', async ({
    window,
    codexSourceId,
    electronLog,
  }) => {
    // Install the thought capture hook BEFORE navigating to chat so we don't
    // miss any early events. The renderer exposes `window.halo` for IPC.
    await window.evaluate(() => {
      const w = window as any
      w.__codexThoughts = []
      w.__codexSystemEvents = []
      w.__codexAgentMessages = []
      const safe = (v: unknown, max = 4000): unknown => {
        if (v == null) return v
        try {
          if (typeof v === 'string') return v.slice(0, max)
          const json = JSON.stringify(v)
          return json.length > max ? json.slice(0, max) : v
        } catch {
          return undefined
        }
      }
      if (w.halo?.onAgentThought) {
        // The agent:thought IPC payload is `{ thought, spaceId, conversationId }`
        // (see src/main/ipc/agent.ts:42 — eventData spreads `data` over the
        // outer envelope). Earlier versions of this hook treated the callback
        // arg as the thought itself, which left every captured `type` field
        // undefined and made the test silently miss tool_use thoughts even
        // when Halo emitted them correctly. Always extract `.thought` first
        // (with a fallback so a future contract simplification still works).
        //
        // Tool name lives at `thought.toolName` (see Thought type; stream-
        // processor.ts:247,480,490). For tool_result-only thoughts the name
        // is on `toolResult.name`. Capture both into a single `name` field
        // so downstream filters don't have to know which shape they got.
        w.halo.onAgentThought((evt: any) => {
          try {
            const thought = evt?.thought ?? evt
            const name =
              thought?.toolName ?? thought?.name ?? thought?.toolResult?.name ?? undefined
            w.__codexThoughts.push({
              type: thought?.type,
              subtype: thought?.subtype,
              name,
              input: safe(thought?.toolInput ?? thought?.input),
              output: safe(thought?.toolResult?.content ?? thought?.output),
              text: typeof thought?.text === 'string' ? thought.text.slice(0, 4000) : undefined,
              raw: safe(thought, 6000),
              ts: Date.now(),
            })
            if (thought?.type === 'system') {
              w.__codexSystemEvents.push({
                subtype: thought?.subtype,
                tools: safe(thought?.tools, 6000),
                mcp_servers: safe(thought?.mcp_servers ?? thought?.mcpServers, 6000),
                raw: safe(thought, 6000),
                ts: Date.now(),
              })
            }
          } catch {
            /* swallow */
          }
        })
      }
      // Tool results arrive via two parallel channels (stream-processor.ts:674
      // and :681): `agent:thought-delta` with `{thoughtId, toolResult}` (the
      // merge form the production UI consumes), and `agent:tool-result` with
      // `{toolId, result, isError}`. Capture both so the assertions don't
      // depend on which channel fires first.
      const safeName = (s: any): string | undefined => (typeof s === 'string' ? s : undefined)
      if (w.halo?.onAgentThoughtDelta) {
        w.halo.onAgentThoughtDelta((evt: any) => {
          try {
            const thoughtId = evt?.thoughtId
            const toolResult = evt?.toolResult
            if (!thoughtId || !toolResult) return
            const target = (w.__codexThoughts as any[]).find((t) => t?.raw?.id === thoughtId)
            if (target) {
              target.output = safe(toolResult.content ?? toolResult)
              if (!target.name && safeName(toolResult.name)) target.name = toolResult.name
            } else {
              w.__codexThoughts.push({
                type: 'tool_result',
                name: safeName(toolResult.name),
                output: safe(toolResult.content ?? toolResult),
                ts: Date.now(),
              })
            }
          } catch {
            /* swallow */
          }
        })
      }
      if (w.halo?.onAgentToolResult) {
        w.halo.onAgentToolResult((evt: any) => {
          try {
            // agent:tool-result payload: {type, toolId, result, isError}.
            // Re-attach to the matching tool_use thought via toolId, OR push
            // as a standalone tool_result thought. We don't have name on this
            // channel, so look it up from the tool_use we already captured.
            const toolId = evt?.toolId
            const target = (w.__codexThoughts as any[]).find((t) => t?.raw?.id === toolId || t?.raw?.toolId === toolId)
            const name = target?.name
            const out = evt?.result
            if (target) {
              if (target.output == null) target.output = safe(out)
            } else {
              w.__codexThoughts.push({
                type: 'tool_result',
                name,
                output: safe(out),
                ts: Date.now(),
              })
            }
          } catch {
            /* swallow */
          }
        })
      }
      if (w.halo?.onAgentMessage) {
        // agent:message payload is `{ ...messageFields, spaceId, conversationId }`
        // — message fields live at the top level (no nested envelope), so
        // reading evt.role / evt.content directly is correct.
        w.halo.onAgentMessage((evt: any) => {
          try {
            w.__codexAgentMessages.push({
              role: evt?.role,
              content: typeof evt?.content === 'string' ? evt.content.slice(0, 4000) : undefined,
              ts: Date.now(),
            })
          } catch {
            /* swallow */
          }
        })
      }
    })

    await navigateToChat(window)

    // Send the prompt.
    const chatInput = await window.waitForSelector('textarea', { timeout: 10_000 })
    await chatInput.fill(TEST_PROMPT)

    const sendButton = await window.waitForSelector(
      '[data-onboarding="send-button"]',
      { timeout: 10_000 },
    )
    await sendButton.click({ force: true })

    // Wait for the user message to land.
    await window.waitForSelector('.message-user', { timeout: 15_000 })

    // Wait for an assistant bubble to appear.
    await window.waitForSelector('.message-assistant', { timeout: 60_000 })

    // ── Diagnostic poll: 30s window watching electron stdout for codex/mcp
    // signals BEFORE we even check for tool_use. Helps localize which step
    // (engine swap / sdkOptions / bridge / session init) is failing.
    const pollStart = Date.now()
    const pollDeadline = pollStart + 30_000
    let firstSystemInit: CapturedSystemEvent | undefined
    while (Date.now() < pollDeadline) {
      // Have we already seen a system.init? Stop early if yes.
      const sysEvents = (await window.evaluate(
        () => (window as any).__codexSystemEvents || [],
      )) as CapturedSystemEvent[]
      if (sysEvents.length > 0) {
        firstSystemInit = sysEvents[0]
        break
      }
      // If electron logs already show codex session initialized, we can break early.
      if (electronLog.lines.some((l) => /\[Codex\]\[session\]\s+initialized/i.test(l))) {
        break
      }
      // Or if we already see any tool_use thought, we can stop polling.
      const thoughtsSoFar = (await window.evaluate(
        () => (window as any).__codexThoughts || [],
      )) as CapturedThought[]
      if (thoughtsSoFar.some((t) => t?.type === 'tool_use')) break
      await new Promise((r) => setTimeout(r, 750))
    }

    // Wait for end-of-turn. The most authoritative signal is a `result`
    // thought emitted by the agent stream processor, OR the absence of the
    // working indicator for a sustained period.
    await window
      .waitForFunction(
        () => {
          const w = window as any
          const ts: Array<{ type?: string }> = w.__codexThoughts || []
          if (ts.some((t) => t?.type === 'result' || t?.type === 'error')) return true
          const text = document.body.innerText || ''
          return !/Halo\s*(正在工作|is working)/i.test(text) && ts.length > 1
        },
        null,
        { timeout: 180_000, polling: 750 },
      )
      .catch(() => {
        /* fall through and let the assertions describe what we got */
      })

    // ── Pull all captured state out of the page.
    const captured = (await window.evaluate(
      () => (window as any).__codexThoughts || [],
    )) as CapturedThought[]
    const systemEvents = (await window.evaluate(
      () => (window as any).__codexSystemEvents || [],
    )) as CapturedSystemEvent[]
    const agentMessages = (await window.evaluate(
      () => (window as any).__codexAgentMessages || [],
    )) as Array<{ role: string; content?: string; ts: number }>

    if (!firstSystemInit && systemEvents.length > 0) {
      firstSystemInit = systemEvents[0]
    }

    // Halo merges tool_use + tool_result into a SINGLE thought of type
    // 'tool_use' whose `output` field carries the result (see stream-processor:
    // "Tool result merged into thought thought-tool-..."). Older Halo versions
    // could also surface a separate `tool_result` thought; accept either shape.
    const toolUses = captured.filter((t) => t.type === 'tool_use')
    const toolResults = captured.filter(
      (t) => t.type === 'tool_result' || (t.type === 'tool_use' && t.output != null),
    )
    const webSearchUses = toolUses.filter(
      (t) => typeof t.name === 'string' && /web[_-]?search/i.test(t.name),
    )
    const webSearchResults = toolResults.filter(
      (t) => typeof t.name === 'string' && /web[_-]?search/i.test(t.name),
    )

    const assistantText =
      (await window
        .$$eval('.message-assistant', (els) => els.map((el) => el.textContent || '').join('\n---\n'))
        .catch(() => '')) || ''

    // ── Soft log-signature checks.
    const logCheck: Record<LogSignatureKey, boolean> = {
      engineActive: false,
      sdkOptionsMcp: false,
      mcpBridgeListening: false,
      codexSessionInit: false,
    }
    for (const line of electronLog.lines) {
      for (const sig of LOG_SIGNATURES) {
        if (!logCheck[sig.key] && sig.test(line)) {
          logCheck[sig.key] = true
        }
      }
    }

    // ── Hypothesis check (per runtime-integration teammate):
    // The openai-compat-router may be dropping codex's MCP tool descriptors
    // when converting /v1/responses → upstream /v1/chat/completions.
    // If team-lead lands the diagnostic line in
    // src/main/openai-compat-router/server/codex-responses-handler.ts:
    //   `[CodexResponsesHandler] inbound tools=N types=[...] -> anthropic tools=M`
    // we capture N, types, and M here for instant verdict.
    let routerToolsDiag: {
      seen: boolean
      inboundCount: number | null
      inboundTypes: string | null
      anthropicCount: number | null
      raw: string | null
    } = {
      seen: false,
      inboundCount: null,
      inboundTypes: null,
      anthropicCount: null,
      raw: null,
    }
    const routerToolsRe =
      /\[CodexResponsesHandler\]\s+inbound tools=(\d+)\s+types=\[([^\]]*)\]\s*->\s*anthropic tools=(\d+)/
    for (const line of electronLog.lines) {
      const m = line.match(routerToolsRe)
      if (m) {
        routerToolsDiag = {
          seen: true,
          inboundCount: parseInt(m[1], 10),
          inboundTypes: m[2],
          anthropicCount: parseInt(m[3], 10),
          raw: line,
        }
        break
      }
    }
    let routerToolsVerdict = 'unknown — diagnostic line not present in stdout'
    if (routerToolsDiag.seen) {
      const i = routerToolsDiag.inboundCount ?? 0
      const a = routerToolsDiag.anthropicCount ?? 0
      if (i > 0 && a === 0) {
        routerToolsVerdict =
          'CONFIRMED: router received tools but converted zero — extend ' +
          'responsesToolsToAnthropicTools in codex-responses-handler.ts to handle ' +
          `the dropped types: [${routerToolsDiag.inboundTypes}]`
      } else if (i === 0) {
        routerToolsVerdict =
          'Router saw zero inbound tools — codex did not include them in /v1/responses. ' +
          'Look upstream of the router (codex MCP fetch / thread/start config).'
      } else {
        routerToolsVerdict = `Router OK: inbound=${i}, anthropic=${a}`
      }
    }

    // Useful filtered slices for the report.
    const codexOrMcpStderr = electronLog.lines
      .filter((l) => l.startsWith('[stderr]') && /Codex|mcp|error/i.test(l))
      .slice(0, 50)
    const stdoutTail = electronLog.lines
      .filter((l) => l.startsWith('[stdout]'))
      .slice(-100)
    const codexOrMcpAnywhere = electronLog.lines
      .filter((l) => /\[Codex\]|prepareCodex|\[Agent\]|\[SDK\]/.test(l))
      .slice(0, 100)

    const summary = {
      passed: webSearchUses.length > 0 && webSearchResults.length > 0,
      sourceId: codexSourceId,
      prompt: TEST_PROMPT,
      logSignatures: Object.entries(logCheck).map(([key, present]) => {
        const sig = LOG_SIGNATURES.find((s) => s.key === key)!
        return { key, label: sig.label, present }
      }),
      thoughtCounts: {
        total: captured.length,
        tool_use: toolUses.length,
        tool_result: toolResults.length,
        system: systemEvents.length,
        web_search_calls: webSearchUses.length,
        web_search_results: webSearchResults.length,
      },
      firstSystemInit: firstSystemInit ?? null,
      toolUses: toolUses.map((t) => ({ name: t.name, input: t.input })),
      toolResults: toolResults.map((t) => ({
        name: t.name,
        output:
          typeof t.output === 'string' ? t.output.slice(0, 500) : JSON.stringify(t.output)?.slice(0, 500),
      })),
      assistantTextPreview: assistantText.slice(0, 1500),
      agentMessageCount: agentMessages.length,
      routerToolsDiag,
      routerToolsVerdict,
      diagnostics: {
        electronLogPath: electronLog.logFilePath,
        codexOrMcpStderr,
        stdoutTail,
        codexOrMcpAnywhere,
      },
    }

    // Print compact summary (always).
    console.log('\n===== CODEX_MCP_E2E_LOG_CHECKS =====')
    for (const entry of summary.logSignatures) {
      console.log(`  ${entry.present ? '✓' : '✗'}  ${entry.label}`)
    }
    console.log(
      `  ${routerToolsDiag.seen ? '✓' : '✗'}  [CodexResponsesHandler] inbound tools=… types=[…] -> anthropic tools=…`,
    )
    console.log(`  Router-tools verdict: ${routerToolsVerdict}`)
    console.log('===== END CODEX_MCP_E2E_LOG_CHECKS =====\n')

    console.log('\n===== CODEX_MCP_E2E_RESULT_JSON =====')
    console.log(JSON.stringify(summary, null, 2))
    console.log('===== END CODEX_MCP_E2E_RESULT_JSON =====\n')

    // Always write markdown summary to disk.
    try {
      fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true })
      fs.writeFileSync(RESULT_PATH, renderMarkdown(summary), 'utf-8')
      console.log(`[codex-mcp] Wrote summary to ${RESULT_PATH}`)
    } catch (err) {
      console.warn('[codex-mcp] Failed to write markdown summary:', err)
    }

    // ── Soft assertions on log signatures (don't abort the test, just record).
    expect.soft(logCheck.engineActive, '[SDK] Active engine: Codex not seen in stdout').toBe(true)
    // Intentionally do NOT assert logCheck.sdkOptionsMcp: that line is a
    // `console.debug` (session-manager.ts:538) and only reaches stdout when
    // the SDK debug log level is enabled — which the production-build E2E
    // does not enable. The mcpBridgeListening signature below covers the same
    // ground (`mcpServers` could only have populated the bridge if it reached
    // options.ts).
    expect
      .soft(logCheck.mcpBridgeListening, '[Codex][mcp] SDK MCP bridge listening line not seen')
      .toBe(true)
    expect.soft(logCheck.codexSessionInit, '[Codex][session] initialized not seen').toBe(true)

    // ── Hard assertions (the real guards).
    expect(
      webSearchUses.length,
      `Expected at least one MCP web-search tool_use thought during the Codex turn, ` +
        `but observed none. Total thoughts=${captured.length}, tool_use=${toolUses.length}. ` +
        `Log-signature presence: ` +
        summary.logSignatures.map((s) => `${s.key}=${s.present}`).join(', ') +
        `. See tests/e2e/codex-mcp-result.md and tests/e2e/codex-mcp-electron.log.`,
    ).toBeGreaterThan(0)

    expect(
      webSearchResults.length,
      'Expected at least one tool_result for web-search but got none.',
    ).toBeGreaterThan(0)

    const okResult = webSearchResults.find((t) => {
      const out = t.output
      if (!out) return false
      const str = typeof out === 'string' ? out : JSON.stringify(out)
      return str.length > 0 && !/^error/i.test(str)
    })
    expect(okResult, 'web-search tool_result was empty or an error.').toBeTruthy()
  })
})

function renderMarkdown(summary: ReturnType<typeof buildSummaryShape>): string {
  const status = summary.passed ? 'PASSED' : 'FAILED'
  const out: string[] = []
  out.push(`# Codex MCP E2E Result — ${status}`)
  out.push('')
  out.push(`- Source id: \`${summary.sourceId}\``)
  out.push(`- Total thoughts: ${summary.thoughtCounts.total}`)
  out.push(`- tool_use / tool_result / system: ${summary.thoughtCounts.tool_use} / ${summary.thoughtCounts.tool_result} / ${summary.thoughtCounts.system}`)
  out.push(`- web_search calls / results: ${summary.thoughtCounts.web_search_calls} / ${summary.thoughtCounts.web_search_results}`)
  out.push(`- Electron log file: \`${summary.diagnostics.electronLogPath}\``)
  out.push('')
  out.push('## Log signature presence')
  out.push('')
  for (const sig of summary.logSignatures) {
    out.push(`- ${sig.present ? '✓' : '✗'} \`${sig.label}\``)
  }
  out.push('')
  out.push('## Router tool-conversion diagnostic')
  out.push('')
  out.push(`- Verdict: **${summary.routerToolsVerdict}**`)
  out.push(`- Diagnostic line seen: ${summary.routerToolsDiag.seen}`)
  if (summary.routerToolsDiag.seen) {
    out.push(`- Inbound count: ${summary.routerToolsDiag.inboundCount}`)
    out.push(`- Inbound types: \`${summary.routerToolsDiag.inboundTypes}\``)
    out.push(`- Anthropic-converted count: ${summary.routerToolsDiag.anthropicCount}`)
    out.push(`- Raw line: \`${summary.routerToolsDiag.raw}\``)
  } else {
    out.push(
      '- _Diagnostic console.log in `src/main/openai-compat-router/server/codex-responses-handler.ts` ' +
        'has not been added yet. Once team-lead lands it, the next run will fill in the verdict._',
    )
  }
  out.push('')
  out.push('## First `system.init` payload')
  out.push('')
  out.push('```json')
  out.push(JSON.stringify(summary.firstSystemInit, null, 2) || 'null')
  out.push('```')
  out.push('')
  out.push('## Prompt')
  out.push('')
  out.push('```')
  out.push(summary.prompt)
  out.push('```')
  out.push('')
  out.push('## Tool uses observed')
  out.push('')
  if (summary.toolUses.length === 0) {
    out.push('_None._')
  } else {
    for (const tu of summary.toolUses) {
      out.push(`- \`${tu.name}\` input=\`${JSON.stringify(tu.input)?.slice(0, 200)}\``)
    }
  }
  out.push('')
  out.push('## Tool results observed')
  out.push('')
  if (summary.toolResults.length === 0) {
    out.push('_None._')
  } else {
    for (const tr of summary.toolResults) {
      out.push(`- \`${tr.name}\` output preview=\`${tr.output}\``)
    }
  }
  out.push('')
  out.push('## Assistant text preview (first 1500 chars)')
  out.push('')
  out.push('```')
  out.push(summary.assistantTextPreview)
  out.push('```')
  out.push('')
  out.push('## Stderr lines mentioning Codex / mcp / error (up to 50)')
  out.push('')
  out.push('```')
  out.push(summary.diagnostics.codexOrMcpStderr.join('\n') || '(none)')
  out.push('```')
  out.push('')
  out.push('## Stdout tail (last 100 lines)')
  out.push('')
  out.push('```')
  out.push(summary.diagnostics.stdoutTail.join('\n') || '(none)')
  out.push('```')
  out.push('')
  out.push('## Codex / Agent / SDK lines (up to 100)')
  out.push('')
  out.push('```')
  out.push(summary.diagnostics.codexOrMcpAnywhere.join('\n') || '(none)')
  out.push('```')
  out.push('')
  return out.join('\n')
}

// Helper purely for the type signature above — not invoked at runtime.
function buildSummaryShape() {
  return {
    passed: true,
    sourceId: '',
    prompt: '',
    logSignatures: [] as Array<{ key: string; label: string; present: boolean }>,
    thoughtCounts: {
      total: 0,
      tool_use: 0,
      tool_result: 0,
      system: 0,
      web_search_calls: 0,
      web_search_results: 0,
    },
    firstSystemInit: null as CapturedSystemEvent | null,
    routerToolsDiag: {
      seen: false,
      inboundCount: null as number | null,
      inboundTypes: null as string | null,
      anthropicCount: null as number | null,
      raw: null as string | null,
    },
    routerToolsVerdict: '',
    toolUses: [] as Array<{ name?: string; input?: unknown }>,
    toolResults: [] as Array<{ name?: string; output?: unknown }>,
    assistantTextPreview: '',
    agentMessageCount: 0,
    diagnostics: {
      electronLogPath: '',
      codexOrMcpStderr: [] as string[],
      stdoutTail: [] as string[],
      codexOrMcpAnywhere: [] as string[],
    },
  }
}
