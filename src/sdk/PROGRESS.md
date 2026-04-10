# Agent-Core SDK — Development Progress

Drop-in replacement for `@anthropic-ai/claude-agent-sdk`.
In-process execution, OpenAI-compat providers, Worker Thread multi-agent isolation.

## Status: Active Development | Branch: `feature/sdk`

---

## Completed Runs Summary (1–28)

| Run | Key Change |
|-----|-----------|
| 1 | Foundation: `index.ts` public API, 4 critical bug fixes |
| 2 | `tool()` factory + `createSdkMcpServer()` in-process MCP (P0 compat) |
| 3 | stdio/SSE/http MCP transports, MCP protocol 2024-11-05 |
| 4 | Foreground+background sub-agent spawning; TodoWrite schema fix |
| 5 | PreToolUse/PostToolUse hooks; `microCompact` array content fix |
| 6 | snake_case SDKMessage wire format; uuid on all variants; V2 session control |
| 7 | Effort level mapping; init message mcp_servers/slash_commands/skills/agents |
| 8 | `McpConnectionManager`: reconnection, health monitoring, backoff |
| 9 | session.pid/query.transport/abortController; compact_boundary shape; SDKMessage uuids |
| 10 | SessionStart/End/UserPromptSubmit/PreCompact/PostCompact hooks |
| 11 | Stateful `ThinkTagParser` for Qwen; `unstable_v2_resumeSession`; Anthropic `listModels` |
| 12 | Sub-agent message forwarding; task_started/progress/notification lifecycle events |
| 13 | `utils/retry.ts` dedup; GlobTool hidden-dir fix; `Retry-After` HTTP-date support |
| 14 | `core/transcript.ts`: CC-compatible JSONL read/write; `resume` option |
| 15 | AbortSignal forwarded to providers; abort-aware retry sleeps in all providers |
| 16 | `reasoning_delta` accumulation fix; slashCommands/skills propagation; `duration_api_ms` |
| 17 | ThinkingBlock `signature` preservation; TaskStop/TaskOutput → AgentRegistry bridge |
| 18 | CostTracker running accumulator; `PermissionResult.message` optional; `ModelUsage.contextWindow` |
| 19 | Multi-modal `send()` (3 envelope shapes); git worktree isolation for sub-agents |
| 20 | WebSearch: Brave API + DuckDuckGo fallback; dynamic `currentDate` in description |
| 21 | `agents` field fix (strings not objects); `task_started.description`; stream concurrency guard |
| 22 | Init message CC SDK contract; `permissionMode` propagation; `session_state_changed` events |
| 23 | Adaptive thinking (`type:'adaptive'`) for Opus 4.6+; permission denial tracking + interrupt |
| 24 | Stale-config fix (spawner getter pattern); `setMaxThinkingTokens` adaptive mapping |
| 25 | Full CC SDK type alignment: Options, CanUseTool, PermissionResult, HookEvent, SDKMessage variants |
| 26 | `rate_limit_event`/`prompt_suggestion` top-level type fix; `SDKRateLimitInfo`; stream wire format |
| 27 | **CRITICAL**: `system:init` per-turn fix; `interrupt()` idle wake; session management API |
| 28 | Full Query interface (16 methods); CC SDK types (ModelInfo, AgentInfo, etc.); `bypassPermissions` |
| 29–38 | See detailed entries below |

---

## Recent Runs (Detail)

### Run 29 — Unit Test Coverage for Core Modules
- Added 7 test files: `cost`, `compact`, `hooks`, `messages`, `transcript`, `retry`, `tokens`
- **122 unit tests + 14 e2e = 136 passing**

### Run 30 — Dynamic MCP Server Management
- `McpConnectionManager.removeServer()`, `toggle()`, `setServers()` implemented
- Session + query() paths both support real-time MCP server changes via `refreshMcpToolsFromManager`
- **28 new tests (connection-manager.test.ts) — 164 tests total**

### Run 31 — Query-Loop + Spawner Unit Tests + Token Tracking Fix
- **Bug fix**: `total_tokens: 0` in task_progress/notification — now accumulates from assistant message usage
- **20 new tests** in `core/query-loop.test.ts` (mock provider, zero network)
- **12 new tests** in `orchestrator/spawner.test.ts` (foreground/background/lifecycle/tokens)
- **214 tests total**

### Run 32 — MCP Elicitation Support
- Full MCP elicitation pipeline: server-initiated `elicitation/create` requests
- Transport layer: `setRequestHandler(method, handler)` on all 3 transports (stdio/SSE/http)
- `McpClient`: registers `elicitation/create` handler, passes `serverName` to consumer
- `McpConnectionManager.setElicitationHandler()`; wired through `createSession` / `query`
- **11 new tests (tools/mcp/elicitation.test.ts) — 225 tests total**

### Run 33 — Session Unit Tests
- **27 new tests** in `core/session.test.ts` covering full V2 session lifecycle:
  init/result shapes, multi-turn, send() input shapes (string/Message/envelope/multimodal),
  session control (interrupt/close/setModel), options forwarding, concurrent stream guard,
  transcript persistence + resume
- **252 tests total**

### Run 34 — SDKSessionInfo Type Contract Fix
- **Bug fix**: `lastModified`/`createdAt` were strings — now numeric ms epoch (CC SDK contract)
- **Bug fix**: `listSessions` sort was string comparison — now numeric subtraction
- **Enhancement**: `firstPrompt` populated via minimal `FileHandle.read(8KB)` I/O
- **Enhancement**: `summary` now `customTitle ?? firstPrompt ?? sessionId`
- **8 new tests (session-metadata.test.ts) — 260 tests total**

### Run 35 — Sub-agent Transcript Persistence
- **Previous state**: `listSubagents`/`getSubagentMessages` were stubs returning `[]`
- **Directory layout** mirrors CC SDK:
  `<configDir>/projects/<projectDir>/<parentSessionId>/subagents/agent-<agentId>.jsonl`
- **New `transcript.ts` exports**: `getSubagentDir`, `getSubagentTranscriptPath`,
  `writeSubagentTranscript`, `listSubagentIds`, `readSubagentMessages`
- **Spawner**: after each sub-agent run, calls `writeSubagentTranscript` fire-and-forget
- **`index.ts`**: `listSubagents` + `getSubagentMessages` now read from disk (not stubs)
- Options enrichment: `GetSubagentMessagesOptions` adds `limit`/`offset`;
  `ListSubagentsOptions` adds `dir`
- **9 new tests (transcript.test.ts extended) — 269 tests total**

### Run 36 — Agent Progress Summaries in task_progress Events
- **Feature**: `task_progress` events now include a human-readable `summary` field
- **Consumer reads `msg.summary` from task_progress** (subagent-handler.ts) — previously always empty
- **`buildProgressSummary(recentCalls)`**: exported utility that builds a concise description
  of the last two tool invocations (e.g. "reading index.ts, then running `npm test`")
- **`describeToolCall(name, input)`**: maps each tool + its key input fields to a user-friendly
  phrase; handles Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch/TodoWrite/Agent + fallback
- **Sliding ring buffer** in `runSubAgent`: tracks last 4 tool calls, refreshed per assistant turn
- **`basename`** extracted from path inputs so summaries show filenames, not full paths
- **12 new tests** (buildProgressSummary suite + task_progress integration) — **281 tests total**

### Run 37 — GLM Model Support + model-quirks Unit Tests
- **GLM model support**: `glm` added to `QUIRKY_PREFIXES`; GLM-Think/GLM-Z1 series (Zhipu AI)
  use `<think>...</think>` XML tags, same pattern as Qwen — now correctly extracted
- **`isXmlThinkModel(model)`**: new exported function covering all XML-think models (Qwen + GLM)
- **`isQwenThinkModel` deprecated** in favour of `isXmlThinkModel` (delegates internally)
- **`extractXmlThinking`**: renamed from `extractQwenThinking` — generic for all XML-think models
- **52 new unit tests** (`llm/model-quirks.test.ts`):
  - `isQuirkyModel` / `isXmlThinkModel` / `isQwenThinkModel` detection across all model families
  - `applyModelQuirks`: `<think>` extraction for both Qwen and GLM, no-op for DeepSeek/GPT
  - Generic fixes: missing tool IDs, empty content injection, stopReason correction
  - DeepSeek argument repair
  - `ThinkTagParser`: full streaming lifecycle — single chunks, multi-chunk, state tracking
  - `applyStreamQuirks`: passthrough contract
- **333 tests total** (16 test files)

### Run 38 — openai-compat Unit Tests + GLM Think-Tag Streaming Fix
- **Bug fix**: `openai-compat.ts` imported/used deprecated `isQwenThinkModel` instead of
  `isXmlThinkModel` — GLM-Think/GLM-Z1 streaming responses never activated the ThinkTagParser
- **Fix**: Updated import and `thinkTagParser` construction to use `isXmlThinkModel`
- **41 new unit tests** (`llm/openai-compat.test.ts`):
  - `capabilities()` with and without `reasoningField` quirk
  - `createMessage()` non-streaming: text, tool_calls, finish_reason mapping,
    tools in request body, temperature, defaultTemperature quirk, reasoning_effort,
    HTTP 4xx error, 429 retry, empty content placeholder
  - `createMessageStream()` streaming: text deltas, tool call with input_json_delta fragments,
    `reasoning_content` field → `reasoning_delta` + thinking block start,
    Qwen `<think>` tag parsing via ThinkTagParser, **GLM `<think>` tag parsing** (the bug path),
    usage-only chunk, `includeUsageInStream` → `stream_options`, 4xx throw, 503 retry
  - `toOpenAiMessages`: string content, system prompt (string + blocks), assistant tool_use,
    tool_result string content, tool_result ContentBlock[] content, image→image_url
  - Provider quirks: `toolIdMaxLen`, `toolIdAlphanumericOnly`, `fixToolUserSequence`
  - `listModels()`: success, HTTP error, network failure, missing id filter
  - `healthCheck()`: healthy, no-key guard, network failure, localhost no-key bypass
- **374 tests total** (17 test files)

### Run 39 — Anthropic Provider: Debug Log Removal + Unit Tests
- **Bug fix**: `stream-parser.ts` and `anthropic.ts` had pervasive debug `console.log` calls
  left from development — these caused noise in production and impacted performance
  (per-chunk and per-event logging, read counts, yield counts). Fully removed.
- **50 new unit tests** (`llm/anthropic.test.ts`):
  - `capabilities()`: all 9 Anthropic-specific capability flags verified
  - `createMessage()` (non-streaming facade):
    - Text response: content, id, model, stopReason, usage assembled from streaming events
    - Request body: headers (x-api-key, anthropic-version, content-type), stream=true
    - Tool_use: input_json_delta chunked assembly → correct input object
    - Thinking + signature: accumulation across multiple deltas
    - HTTP 401/400 throws with status in message
    - HTTP 429 retry + success (2-attempt cycle)
    - Network failure retry + success
    - Retry-After header respected
    - baseUrl override
    - Beta headers (anthropic-beta) joined with comma
  - `buildRequestBody` (via fetch inspection):
    - temperature, topP, topK, stopSequences (present/absent)
    - Tools serialized; empty array → key omitted
    - thinking: enabled (budget_tokens), adaptive, disabled (omitted)
    - System prompt: string and block-array forms
  - `normalizeMessages` (via fetch inspection):
    - String content passthrough
    - ContentBlock array: text, thinking+signature, tool_use, tool_result, image, document
    - tool_result is_error flag
  - `createMessageStream()`:
    - Full event sequence with correct types
    - message_stop terminates early (no [DONE] required, non-closing stream)
    - Tool call events with input_json_delta
    - thinking_delta + signature_delta events
    - Error events yielded (consumer handles throw); createMessage() does throw
    - Ping events skipped (not yielded)
    - AbortError not retried (1 call only)
    - message_delta with no usage field (graceful)
  - `listModels()`: API success, no key (fallback, no fetch), HTTP error, network error,
    empty data array, GET method + content-type absent + x-api-key present
  - `healthCheck()`: with key → healthy; no key → unavailable with reason
- **424 tests total** (18 test files)

### Run 40 — stream-parser.ts Unit Tests
- **31 new unit tests** (`llm/stream-parser.test.ts`):
  - **Basic parsing**: single object, multiple objects, `data:` without space,
    trailing whitespace trimmed, nested objects/arrays
  - **[DONE] sentinel**: stops before subsequent data lines, stops even with more
    network chunks queued, handles [DONE] as the only event
  - **event: prefix**: attaches `__event` field to next data object; cleared after one use;
    absent when no `event:` preceded; whitespace handling around event name
  - **Skipped lines**: empty SSE boundary lines, `:` comments, unknown-prefix lines,
    `data:` with blank payload
  - **Chunked data**: JSON split mid-value across two reads; newline in next chunk;
    multiple events in one read; one-character-per-chunk reassembly;
    `event:` type split across chunks
  - **Malformed JSON**: single bad line skipped, multiple bad lines skipped —
    generator continues to valid lines without throwing
  - **AbortSignal**: pre-aborted signal yields nothing; signal firing during a read
    still delivers that read's data but prevents the next read (abort detected at
    top of following iteration — accurate per-spec behavior documented in test)
  - **Edge cases**: `body:null` / `body:undefined` throw; reader lock released on
    normal completion and on mid-stream exception; empty stream (immediate done);
    stream with only comments/empty lines
- **455 tests total** (19 test files)

### Run 41 — Debug Log Removal (query-loop.ts) + TokenBudget + Context Unit Tests
- **Bug fix**: `query-loop.ts` had 3 leftover `[QUERY-LOOP]` debug `console.log` calls
  (stream_event counter, accumulateAndStream done, yielding result) plus the `_dbgStreamEventCount`
  variable — all fully removed. These appeared in e2e test stdout, causing noise in CI output.
- **New `core/token-budget.test.ts`** (23 tests):
  - Constructor: contextWindow 200k/100k selection, maxOutputTokens default/override
  - `currentInputTokens`: heuristic fallback, API usage preference, sequential updates
  - `remainingInputTokens`: correct arithmetic, clamped at 0 when over budget
  - `usageRatio`: 0 for empty, proportional to API usage, capped at 1.0, saturated when maxOut >= cw
  - `shouldCompact`: false below 90%, true at/above 90%
  - `shouldReduceToolResults`: false below 70%, true at/above 70%
  - `summary`: readable format with commas and % sign
- **New `core/context.test.ts`** (46 tests):
  - `resolveQueryConfig` defaults: model, maxTokens, maxTurns, maxBudgetUsd, cwd, env,
    systemPrompt, effort, toolResultBudget, includePartialMessages, permissionMode,
    abortSignal creation vs. reuse, optional fields passthrough
  - `resolveQueryConfig` thinking: disabled default, explicit config, precedence over
    maxThinkingTokens, adaptive for claude-opus-4/sonnet-4 with maxThinkingTokens,
    enabled-with-budget for legacy models, zero maxThinkingTokens → disabled
  - `createAgentContext`: UUID generation, sessionId reuse, provider reference,
    tools array, isSubAgent flag, parentAgentId, empty messages, currentTurn=0,
    shellState/toolContext cwd matching, toolContext.sessionId matching, costTracker presence,
    config resolution, unique sessionIds across calls
- **524 tests total** (21 test files)

---

## Priority Queue (Next Runs)

### P1 (Important)
- [ ] Worker Thread isolation for background agents (current fire-and-forget Promise model)
