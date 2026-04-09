# Agent-Core SDK — Development Progress

Drop-in replacement for `@anthropic-ai/claude-agent-sdk`.
In-process execution, OpenAI-compat providers, Worker Thread multi-agent isolation.

## Status: Active Development

Branch: `feature/sdk`

---

## Completed (Run 1–13)

### Run 1 — Foundation
- Created `index.ts` public API surface (query, createSession, tool, createSdkMcpServer, etc.)
- Fixed 4 critical bugs: missing export, wrong type signatures, import cycles, AbortError handling

### Run 2 — Consumer Compatibility (P0)
- Implemented `tool()` factory function
- Implemented `createSdkMcpServer()` with in-process MCP tool registration
- Consumer (hello-halo) can bridge its tools with zero subprocess overhead

### Run 3 — External MCP Transport
- Implemented stdio, SSE, and streamable-http MCP transports
- MCP protocol version 2024-11-05: initialize → notifications/initialized → tools/list → tools/call
- Bridge external MCP servers to the tool registry

### Run 4 — Orchestrator + TodoWrite Fix
- Implemented foreground and background sub-agent spawning
- Fixed TodoWrite schema ({content, status, activeForm} not old {id, content, status})
- Orchestrator uses DI: setSpawner/setMessageRouter accept null for reset

### Run 5 — Hook System + Compact Fix
- PreToolUse/PostToolUse/PostToolUseFailure hooks in query-loop
- Fixed microCompact to handle array-typed ToolResultBlock.content

### Run 6 — SDKMessage Wire Format + V2 Session Control
- SDKMessage fields are snake_case (CC-compatible wire format)
- uuid on all SDKMessage variants
- Session control: interrupt/setModel/setMaxThinkingTokens/setPermissionMode

### Run 7 — Effort Level Mapping + Init Message Enrichment
- Effort: Low→disabled+temp0, Medium→5k, High→10k, Max→20k thinking budget
- OpenAI reasoning_effort: Low→"low", Medium→"medium", High/Max→"high"
- Init message: mcp_servers/slash_commands/skills/agents fields populated
- Fixed slash_commands from {name,description}[] to string[]

### Run 8 — MCP Connection Manager
- McpConnectionManager with exponential backoff reconnection (1s→2s→4s…60s cap)
- Health monitoring with per-server status tracking
- Tool-call-level single retry on transport death
- Circular dep fix: transport factory deduped into connection-manager.ts

### Run 9 — Consumer-Compatible Session Internals + SDKMessage Fixes
- Exposed session.pid, session.query.transport, session.query.supportedCommands(), session.abortController
- compact_boundary includes compact_metadata: {trigger, pre_tokens}
- tool_progress includes session_id
- All SDKMessage variants have uuid field
- CC SDK result subtypes: success/error_during_execution/error_max_turns/error_max_budget_usd

### Run 10 — Session Lifecycle Hooks + Compact Lifecycle Hooks
- **SessionStart hook**: fires after createSession() completes, fire-and-forget
- **SessionEnd hook**: fires before session.close() cleanup, fire-and-forget with fresh AbortController
- **UserPromptSubmit hook**: fires on send(), additionalContext injected into user message
- **PreCompact hook**: fires before auto-compact LLM call with context_length
- **PostCompact hook**: fires after successful compact with summary + tokens_freed
- Consolidated duplicate `shouldTriggerAutoCompact` → use `shouldAutoCompact` from compact.ts (removes `contextWindowForModel` import from query-loop.ts)
- tsc --noEmit passes

### Run 11 — Qwen Think Streaming + resumeSession + Anthropic listModels
- **ThinkTagParser**: stateful `<think>` tag parser in `model-quirks.ts`
  - Correctly handles `<think>` content spread across multiple SSE chunks
  - `ThinkTagParser.process(text, index)` returns `reasoning_delta` + `text_delta` events
  - Replaces naive stateless regex in `openai-compat.ts` streaming path
  - Qwen model detection via `isQwenThinkModel()` — parser only instantiated for Qwen
- **`unstable_v2_resumeSession(sessionId, options)`**: exported from `index.ts`
  - Creates a fresh session with the supplied `sessionId` (CC SDK API compat)
  - Consumer's session-manager can call it for session restore flow
- **Anthropic `listModels()` real API call**:
  - `GET /v1/models?limit=100` using the same auth headers
  - Graceful fallback to hardcoded list on API error / no key
  - Model `display_name` used for human-readable name
- tsc --noEmit passes

### Run 12 — Sub-Agent Message Forwarding + Task Lifecycle Events
- **`ToolContext.toolUseId` + `ToolContext.onSubAgentMessage`** (new fields in `types/tool.ts`):
  - `toolUseId?: string` — the parent Agent tool_use_id passed into each tool invocation
  - `onSubAgentMessage?: (msg: Record<string, unknown>) => void` — callback for streaming child messages
  - Uses `Record<string,unknown>` to avoid circular import between `types/tool.ts` and `core/query-loop.ts`
- **Query loop sub-agent message forwarding** (`core/query-loop.ts`):
  - Creates per-tool-call ToolContext extending the shared context with `toolUseId` and `onSubAgentMessage`
  - Buffers messages from AgentTool execution in a per-call `subAgentMsgs[]`
  - After all tool calls complete, yields buffered sub-agent messages in tool-call order before the tool result
  - Only foreground agents (not background) have their messages forwarded (background returns immediately)
- **Spawner task lifecycle events** (`orchestrator/spawner.ts`):
  - `runSubAgent()` now accepts `parentToolUseId`, `onMessage`, `parentSessionId` parameters
  - Emits `system/task_started` before the sub-agent loop starts (with `tool_use_id` for consumer routing)
  - Forwards each `assistant`/`user` sub-agent message to parent stream with `parent_tool_use_id` tagged
  - Tracks `toolUseCount` and `lastToolName` from assistant message content blocks
  - Emits `system/task_progress` after each completed turn (when `user` tool-result message arrives)
  - Emits `system/task_notification` at completion (status: completed/stopped, with usage + summary)
- Consumer compatibility: stream-processor.ts `handleTaskStarted/Progress/Notification` + sub-agent timeline now work with our SDK
- tsc --noEmit passes

### Run 13 — Retry Dedup + GlobTool Hidden Directory Fix
- **`utils/retry.ts`** — new shared retry utility module:
  - `RetryConfig` interface + `DEFAULT_RETRY` constant (5 retries, 1 s → 60 s exponential backoff)
  - `delayForAttempt(config, attempt)` — exponential backoff with ±10 % jitter
  - `isRetryableStatus(status)` — 429, 529 (Anthropic overload), 5xx
  - `parseRetryAfterMs(headers)` — parses both delta-seconds and HTTP-date `Retry-After` forms
  - `sleep(ms, signal?)` — abort-aware sleep utility
- **`llm/anthropic.ts`** — imports from `utils/retry.ts`, removed duplicate local definitions
  - Upgraded `Retry-After` handling to use `parseRetryAfterMs` (supports HTTP-date form, not just integers)
- **`llm/openai-compat.ts`** — imports from `utils/retry.ts`, removed 26-line duplicate block
  - Added `Retry-After` header handling in both `createMessage` and `createMessageStream` retry loops
  - `isRetryableStatus` now includes 529 (was missing in openai-compat, now consistent via shared fn)
- **`tools/glob/index.ts`** — hidden directory traversal fixed:
  - Removed blanket `entry.name.startsWith('.')` skip — patterns like `.claude/**`, `.halo/**`, `.github/**` now work
  - Expanded `SKIP_DIRS` with `.npm`, `.yarn`, `.cache`, `.cargo`, `.gradle` for cache hygiene
- tsc --noEmit passes

### Run 14 — Transcript Persistence (Resume Session Support)
- **`core/transcript.ts`** — new module for CC-compatible JSONL transcript read/write:
  - `getTranscriptPath(sessionId, cwd)` — computes file path using same rule as CC CLI
    (`CLAUDE_CONFIG_DIR/projects/<project-dir>/<session-id>.jsonl`, where `<project-dir>` replaces non-alphanumeric chars with `-`)
  - `appendToTranscript(path, entry)` — async append to JSONL, auto-creates directories
  - `TranscriptWriter` — stateful writer that tracks `parentUuid` chain across messages
    - `writeUserMessage(message)` + `writeAssistantMessage(message)` → async append, returns uuid
  - `readTranscriptMessages(sessionId, cwd)` — reads JSONL and reconstructs `Message[]` for resume
    (skips non-message entries like `queue-operation`; returns null if file not found)
  - `transcriptExists(sessionId, cwd)` — sync file existence check
- **`core/session.ts`** — integrated transcript persistence:
  - `createSession()` reads transcript on `options.resume` via `readTranscriptMessages()`
    — populates `state.messages` with history before first send (full context restore)
  - `TranscriptWriter` created for every session (writes to `$CLAUDE_CONFIG_DIR/projects/...`)
  - `stream()` writes user message + each assistant/tool-result message as they flow
  - `SessionState.initEmitted` flag replaces fragile `messages.length === 1` heuristic
    — init event now correctly emitted once per consumer attach, including after resume
- **`index.ts`** — `unstable_v2_resumeSession()` now passes `resume: sessionId` so transcript is loaded
- tsc --noEmit passes

### Run 15 — AbortSignal propagation + retry system hardening

**Bug fixes (correctness):**
- **`core/query-loop.ts`** — AbortSignal was never forwarded to LLM providers:
  - `provider.createMessageStream()` call now always passes `signal: config.abortSignal` in `providerOptions`
  - Providers can now cancel their in-flight HTTP requests immediately on abort (saves tokens + latency)
- **`llm/anthropic.ts`** — abort-aware retry sleeps:
  - Extracted `abortSignal` from `request.providerOptions?.signal` before retry loop (no more repeated casts)
  - Replaced `new Promise(setTimeout)` with `sleep(delay, abortSignal)` — aborts during backoff are now immediate
  - Re-throw AbortError in fetch catch block — abort no longer causes a useless retry cycle
- **`llm/openai-compat.ts`** — same abort-awareness improvements in both `createMessage` and `createMessageStream`

**Retry system improvements (`core/query-loop.ts`):**
- Removed duplicate local `sleep` function — now imports from `utils/retry.ts`
- Increased query-loop max retries from 2 to `DEFAULT_RETRY.maxRetries` (5)
- Replaced fixed backoff (1–3 s) with `delayForAttempt()` exponential backoff (1 s → 60 s, ±10 % jitter)
- Emits `system/api_retry` SDKMessage before each retry — consumer can display retry progress in UI
- Abort-aware retry sleep in query-loop (matches provider behaviour)

**Agent types (`tools/agent/agent-types.ts`):**
- Added `fork` built-in agent type — inherits all parent tools, used for parallel sub-tasks (per CC spec)

- tsc --noEmit passes

### Run 16 — Bug Fixes: reasoning_delta accumulation + slashCommands/skills propagation + duration_api_ms

**Bug fix: reasoning_delta not accumulated (`core/query-loop.ts`)**
- Qwen/DeepSeek models emit `reasoning_delta` events (via `ThinkTagParser`); there was no case for them in `accumulateAndStream`'s accumulation switch — thinking content was silently dropped from the conversation history (it streamed to the consumer but was never stored)
- Added `case 'reasoning_delta'` that pushes `event.reasoning` directly to `thinkingChunks` (no index check needed since these events have no `content_block_start` predecessor)
- Final `ThinkingBlock` is now correctly built for OpenAI-compat thinking models

**Bug fix: slashCommands / skills not passed to init message (`core/session.ts`, `index.ts`)**
- `session.stream()` was building `queryOpts` without `slashCommands` / `skills`, so the `system:init` message emitted to the consumer had empty slash command and skill lists regardless of what the host passed in `Options`
- Added `skills: string[]` field to `SessionState`; populated from `options.skills` in `createSession()`
- `stream()` now passes `slashCommands` (mapped to name strings) and `skills` in `queryOpts`
- `query()` in `index.ts` was missing the same — added slash command name extraction + `queryOpts` population

**Enhancement: accurate `duration_api_ms` tracking (`core/query-loop.ts`)**
- Previously both `duration_ms` and `duration_api_ms` in result messages were set to `Date.now() - startTime` (total wall-clock time including tool execution)
- Added `totalApiTimeMs` counter; each `createMessageStream` / `accumulateAndStream` call now wraps the API call with `Date.now()` bookmarks and accumulates elapsed time across turns
- `duration_api_ms` in success and error result messages now reports pure LLM API wait time (tool execution time excluded)

**Fix: `content_block_start` event field naming (`types/provider.ts`)**
- `StreamEvent` for `content_block_start` had `contentBlock` (camelCase) but all usages in `anthropic.ts`, `openai-compat.ts`, and `query-loop.ts` used `content_block` (snake_case)
- Corrected field name to `content_block` — matches the Anthropic wire format and the consumer's CC SDK type expectations

- tsc --noEmit passes

---

### Run 17 — Background Agent Lifecycle + ThinkingBlock Signature Fix

**Bug fix: TaskStopTool / TaskOutputTool disconnected from AgentRegistry (`tools/task/list.ts`, `orchestrator/init.ts`)**
- Background agents were registered in `AgentRegistry` (per-session, per-spawner) but
  `TaskStopTool` / `TaskOutputTool` / `TaskListTool` / `TaskGetTool` all used `taskStore`
  (a separate global store for todo-style tasks). Using `TaskOutput` with a background
  agent's ID returned "Task not found" — making background agents completely unqueryable.
- Added `setAgentRegistry(registry: AgentRegistry | null)` to `tools/task/list.ts`
- `TaskOutputTool`: checks `_agentRegistry.get(taskId)` as fallback when not found in `taskStore`;
  when `block=true` and agent is still running, awaits `entry.done` with a configurable timeout
- `TaskStopTool`: checks `_agentRegistry.get(taskId)` and calls `_agentRegistry.stop()` to abort the agent
- `TaskListTool` / `TaskGetTool`: also surface running agents from the registry
- `orchestrator/init.ts`: calls `setAgentRegistry(registry)` after creating the registry,
  and `setAgentRegistry(null)` in `dispose()` to prevent cross-session leaks

**Enhancement: `TaskOutput` timeout parameter (`tools/task/schema.ts`, `tools/task/list.ts`)**
- Added `timeout` field (number, ms) to `TASK_OUTPUT_INPUT_SCHEMA`
- When `block=true` and a background agent is still running, uses `Promise.race(entry.done, timeout)`
  instead of blocking indefinitely (default: 30 000 ms)
- Returns `retrieval_status: 'not_ready'` when timeout is exceeded

**Bug fix: ThinkingBlock signature not preserved across turns (`types/provider.ts`, `core/query-loop.ts`, `llm/anthropic.ts`)**
- Anthropic extended thinking blocks carry a cryptographic `signature` field that MUST
  be sent back unchanged in subsequent turns — the API verifies it. Without the signature,
  multi-turn conversations with extended thinking fail.
- Added `signature?: string` to `ThinkingBlock` interface
- `accumulateAndStream` now:
  - Resets `thinkingSignature = ''` on each `content_block_start` (thinking)
  - Accumulates `signature_delta` events into `thinkingSignature`
  - Includes `signature` in the final assembled `ThinkingBlock`
- `anthropic.ts` `mapContentBlock()`: includes `raw.signature` when building ThinkingBlock
- `anthropic.ts` `createMessage()`: `thinkingParts` Map changed from `Map<number, string>` to
  `Map<number, {thinking, signature}>`; `signature_delta` events are now tracked; final
  ThinkingBlock assembly includes `signature`
- `anthropic.ts` `normalizeMessages()`: includes `signature` when serializing ThinkingBlock
  for API request body (was silently dropping it)

- tsc --noEmit passes

---

### Run 18 — Consumer Compatibility Audit: CostTracker + PermissionResult + ModelUsage + Error Result

**Bug fix: CostTracker `totalCostUsd` incorrect after model switch (`core/cost.ts`)**
- `totalCostUsd` was a computed getter that multiplied ALL accumulated tokens by
  `this._pricing` — a single pricing instance that changes on every `add(model)` or
  `setModel()` call. After fallback from Opus to Sonnet, all prior Opus tokens were
  retroactively priced at Sonnet rates, yielding a ~5x cost undercount.
- Replaced with `_totalCostUsd` running accumulator: each `add()` call computes the
  per-call cost at the correct model pricing and accumulates it. `totalCostUsd` getter
  now returns the pre-computed sum. `reset()` also clears `_totalCostUsd` and `_modelUsage`.

**Bug fix: PermissionResult deny `message` field required but consumer omits it (`types/config.ts`, `core/query-loop.ts`)**
- Consumer's `createCanUseTool` returns `{ behavior: 'deny', updatedInput }` without
  a `message` field (permission-handler.ts:129). Our SDK required `message: string` on
  the deny variant and read it unconditionally in query-loop.ts:1041, producing
  `"Permission denied: undefined"`.
- Changed `PermissionResult` deny variant: `message` is now optional (`message?: string`).
- Updated query-loop deny handling: uses `permResult.message` when present, falls back
  to `'Permission denied'` when omitted.

**Enhancement: `ModelUsageEntry.contextWindow` field (`core/cost.ts`)**
- Consumer reads `modelUsage[model].contextWindow` from result messages for context
  window display (message-utils.ts:276). Our `ModelUsageEntry` was missing this field,
  causing silent fallback to 200K default.
- Added `contextWindow: number` to `ModelUsageEntry` interface.
- `CostTracker.add()` now calls `contextWindowForModel(modelKey)` when creating a new
  entry, populating the field with the correct per-model context window size.

**Enhancement: error result `result` field + `stop_reason` (`core/query-loop.ts`)**
- Consumer reads `message.result` from all result messages (message-utils.ts:213),
  including errors. Our error result type only had `errors: string[]`, so error messages
  displayed as empty content in the UI.
- Added `result: string` field to error result type — set to `errors.join('\n')`.
- Added `stop_reason: string | null` to error result type for CC SDK conformance.

- tsc --noEmit passes

---

### Run 19 — Multi-Modal send() Fix + Git Worktree Isolation

**Bug fix: `send()` silently drops multi-modal (image) messages (`core/session.ts`)**
- Consumer sends multi-modal messages using the CC SDK envelope format:
  `{ type: 'user', message: { role: 'user', content: ContentBlock[] } }`
- `send()` only accepted `string | { role: 'user'; content: string }` — when the
  envelope shape was passed, `message.content` resolved to `undefined` because the
  code read `.content` from the outer envelope, not the inner `message` field.
- Refactored `send()` to accept `string | Record<string, unknown>` and handle
  three input shapes:
  1. Plain string — `"hello"`
  2. Direct message — `{ role: 'user', content: string | ContentBlock[] }`
  3. CC SDK envelope — `{ type: 'user', message: { role: 'user', content: ... } }`
- Multi-modal `ContentBlock[]` content is preserved through the pipeline and
  pushed as `Message` objects into `pendingMessages` (not stringified).
- `stream()` updated to drain `pendingMessages` as `Array<string | Message>`,
  merging multi-modal payloads into a single user Message with combined blocks.
- `UserPromptSubmit` hook extracts text representation for hook context but
  injects `additionalContext` as an appended text block (preserves image blocks).
- `SDKSession.send()` interface type widened to `string | Record<string, unknown>`.

**Feature: Git worktree isolation for sub-agents (`orchestrator/spawner.ts`)**
- Implemented worktree lifecycle matching the CC Rust agent_tool.rs behavior:
  - `findGitRoot(start)` — walks up from cwd to locate `.git`
  - `createWorktree(gitRoot, agentId)` — runs `git worktree add --detach`
    into `$TMPDIR/claude-agent-<agentId>`, returns path or null on failure
  - `removeWorktree(gitRoot, worktreeDir)` — force-removes after agent completes
- `runSubAgent()` now resolves `isolation: 'worktree'` from `AgentSpawnRequest`:
  - Finds git root, creates worktree, sets `effectiveCwd` to worktree path
  - Falls back to shared cwd on failure (with warning, no crash)
  - Cleanup runs in `finally`-like position after query loop and before return
- Both foreground and background agents support worktree isolation
- This enables safe parallel file editing when multiple agents are spawned

- tsc --noEmit passes

---

### Run 20 — WebSearchTool Real Implementation (Brave Search + DuckDuckGo Fallback)

**Feature: WebSearch tool with real search backends (`tools/web-search/index.ts`)**
- Replaced the placeholder WebSearch tool with a production implementation using real search APIs
- **Brave Search API** (primary): when `BRAVE_SEARCH_API_KEY` is set in the environment or tool context
  - Full-text web search via `https://api.search.brave.com/res/v1/web/search`
  - Client-side domain filtering: `allowed_domains` and `blocked_domains` input params
    are applied post-fetch since Brave API doesn't natively support domain filters
  - Results formatted as numbered markdown list with title, URL, and description
  - Abort-signal-aware with configurable timeout (15s)
- **DuckDuckGo Instant Answer API** (fallback): when no Brave API key is available
  - Uses `https://api.duckduckgo.com/` JSON API
  - Returns abstract answers and related topics (limited coverage vs full search)
  - Provides a helpful message suggesting BRAVE_SEARCH_API_KEY for full search
- Both backends are abort-signal-aware and respect the parent ToolContext abort
- Results include duration timing and result count in the header

**Enhancement: dynamic date in WebSearch description (`tools/web-search/schema.ts`)**
- Tool description now includes current month/year (matching CC TypeScript behavior)
- Instructs the LLM to use accurate temporal queries (e.g., "React docs 2026")
- Description is built at module load time via `buildDescription()` function

- tsc --noEmit passes

---

### Run 21 — Consumer Compatibility Audit + Fixes

**Bug fix: `agents` init field shape mismatch (HIGH severity active bug)**
- Consumer (`stream-processor.ts:785`) casts `msg.agents as string[]` — expected agent names
- SDK was emitting `Array<{ name, description, model }>` (objects, not strings)
- Changed `queryLoop()` to emit `agents: Object.keys(config.agents)` (name strings only)
- This fixes `[object Object]` being forwarded to the frontend instead of agent names

**Enhancement: `task_started` now includes `description` field**
- CC SDK's `SDKTaskStartedMessage` declares `description: string` as required
- Spawner now emits `description: request.description` in task_started messages
- Consumer's sub-agent UI can display what the agent is doing

**Enhancement: `task_notification` now includes `output_file` field**
- CC SDK's `SDKTaskNotificationMessage` declares `output_file: string` as required
- Spawner now includes `output_file: ''` (in-process agents don't write output files)
- Prevents structural mismatch if consumer ever reads this field

**Enhancement: `api_retry` now includes CC-compatible `error` field**
- CC SDK's `SDKAPIRetryMessage` has `error: SDKAssistantMessageError` (typed string union)
- Added `classifyApiError(statusCode)` helper that maps HTTP status codes to:
  - 401/403 → 'authentication_failed', 402 → 'billing_error', 429 → 'rate_limit'
  - 400/422 → 'invalid_request', 5xx → 'server_error', other → 'unknown'
- Both `api_retry` emission and the `SDKMessage` type union now include the `error` field

**Enhancement: error result `stop_reason` values**
- `error_max_turns` now has `stop_reason: 'max_turns'` (was `null`)
- `error_max_budget_usd` now has `stop_reason: 'max_budget'` (was `null`)

**Enhancement: session stream concurrency guard**
- `session.stream()` now tracks the active generator via `state.activeStream`
- If a new `stream()` call arrives while a previous one is running, the old generator is
  gracefully returned before the new one starts — prevents two generators competing for
  the same pending message queue
- Uses `innerStream()` indirection with `try/finally` to auto-clear `state.activeStream`

- tsc --noEmit passes

---

### Run 22 — Init Message Enrichment + permissionMode + session_state_changed

**Enhancement: init message now matches CC SDK `SDKSystemMessage` contract**
- Added all required fields from the CC SDK type definition:
  - `apiKeySource: string` — detected from env vars (defaults to `'user'`)
  - `claude_code_version: string` — SDK version from `SDK_VERSION` constant
  - `output_style: string` — derived from `config.outputFormat?.type ?? 'text'`
  - `plugins: Array<{ name, path }>` — always `[]` (plugins not yet supported)
  - `betas?: string[]` — forwarded from `config.betas`
- Changed optional fields to required (matching CC SDK contract):
  - `cwd`, `permissionMode`, `mcp_servers`, `slash_commands`, `skills` are now always present
  - Empty arrays instead of `undefined` when no values are configured
  
**Enhancement: `permissionMode` propagation through the system**
- Added `permissionMode: PermissionMode` to `QueryConfig` (was missing)
- `resolveQueryConfig()` now reads `options.permissionMode ?? 'default'`
- Init message populates `permissionMode` from resolved config
- `session.setPermissionMode()` now actually updates `state.config.permissionMode`
  (was previously a no-op; now consumer-visible in subsequent turns)

**Feature: `session_state_changed` SDKMessage variant**
- Added new SDKMessage union member: `{ type: 'system', subtype: 'session_state_changed', state: 'idle' | 'running' | 'requires_action' }`
- Session `stream()` emits `state: 'running'` when processing starts
- Session `stream()` emits `state: 'idle'` after query loop completes
- Matches CC SDK `SDKSessionStateChangedMessage` — authoritative turn-over signal

- tsc --noEmit passes

---

### Run 23 — Adaptive Thinking + Permission Denial Tracking

**Bug fix: adaptive thinking silently ignored by Anthropic provider (`llm/anthropic.ts`)**
- `buildRequestBody()` only handled `thinking.type === 'enabled'` — when `type === 'adaptive'`
  (the default for Opus 4.6+ models), no thinking config was sent to the API, causing
  adaptive thinking to silently fall back to no thinking at all
- Added `else if (request.thinking.type === 'adaptive')` branch that passes `{ type: 'adaptive' }`
  directly to the Anthropic API body
- `type: 'disabled'` correctly omits the thinking param (API default behavior)
- This fix is critical for any session using Opus 4.6+ where thinking config resolves to `adaptive`

**Enhancement: permission denial tracking (`core/query-loop.ts`)**
- Added `permissionDenials` array to accumulate denied tool uses throughout the query loop
- Each denial records `{ tool_name, tool_use_id, tool_input }` matching CC SDK `SDKPermissionDenial` type
- Updated `permission_denials` field in both success and error result messages from `unknown[]`
  to the properly typed array — now populated with actual denial records
- Previously `permission_denials: []` was always empty regardless of denials

**Enhancement: permission denial interrupt support (`core/query-loop.ts`)**
- When `PermissionResult.interrupt === true`, the tool result carries an `interrupt` flag
- After all tool results are collected, if any result has `interrupt: true`, the query loop
  yields an `error_during_execution` result and terminates the turn
- This allows the consumer's permission handler to signal "stop everything" on a critical denial
  (e.g., user explicitly rejected a dangerous operation)

- tsc --noEmit passes

---

### Run 24 — Stale Config Fix + Adaptive Thinking + Options Enrichment

**Bug fix: sub-agent spawner uses stale config after interrupt()/setModel() (`orchestrator/spawner.ts`, `orchestrator/init.ts`, `core/session.ts`)**
- `createSpawner()` captured `parentConfig` as a static snapshot at `initOrchestrator()` time
- After `session.interrupt()` or `session.setModel()` / `setMaxThinkingTokens()` / `setPermissionMode()`,
  `state.config` was replaced but the spawner closure still held the old reference
- Sub-agents spawned after config changes inherited stale model, thinking, effort, and env values
- Fix: `SpawnerDeps.parentConfig` now accepts `QueryConfig | (() => QueryConfig)` (getter pattern)
- Session passes `() => state.config` — spawner calls `getParentConfig()` at spawn time (not at init time)
- `query()` path still passes a static config (no mid-stream changes in the one-shot flow)

**Bug fix: `setMaxThinkingTokens()` wrong mode for Opus 4.6+ (`core/session.ts`)**
- Consumer calls `setMaxThinkingTokens(10240)` to enable thinking
- Our SDK always mapped non-null values to `{ type: 'enabled', budgetTokens: N }`
- Per CC SDK docs: "On Opus 4.6, this is treated as on/off (0 = disabled, any other value = adaptive)"
- Added `supportsAdaptiveThinking(model)` — matches `claude-(opus|sonnet)-4` models
- `setMaxThinkingTokens(N)` now correctly maps to `{ type: 'adaptive' }` on supported models
- `setMaxThinkingTokens(0)` now correctly maps to `{ type: 'disabled' }` (was previously `{ type: 'enabled', budgetTokens: 0 }`)

**Enhancement: Options type enrichment (`types/config.ts`)**
- Added `toolConfig?: Record<string, Record<string, unknown>>` — per-tool configuration (CC SDK has ToolConfig)
- Added `taskBudget?: { total: number }` — API-side task budget in tokens (CC SDK alpha feature)
- Added `includeHookEvents?: boolean` — include hook lifecycle events in output stream

- tsc --noEmit passes

---

### Run 25 — CC SDK Type Contract Alignment

**Type system: full alignment with CC SDK `sdk-types.ts` contract**

- **`Options` type enrichment** (`types/config.ts`):
  - Added CC SDK compat aliases: `apiKey`, `anthropicBaseUrl` at the top level
  - The consumer's `mcp-manager.ts` passes these fields via CC SDK options format — our SDK
    now resolves them alongside `env.ANTHROPIC_API_KEY` / `env.ANTHROPIC_BASE_URL`
  - Added missing fields: `promptSuggestions`, `agentProgressSummaries`, `sandbox`, `settings`,
    `settingSources`, `debug`, `debugFile`, `onElicitation`, `plugins`

- **`CanUseTool` callback expanded** (`types/config.ts`):
  - Added all missing options from CC SDK: `suggestions`, `blockedPath`, `decisionReason`,
    `title`, `displayName`, `description` (6 new fields)
  - These fields are passed through to the consumer's permission handler for richer UI

- **`PermissionResult` expanded** (`types/config.ts`):
  - Added `updatedPermissions`, `toolUseID`, `decisionClassification` to both `allow` and `deny` variants
  - Added `PermissionDecisionClassification`, `PermissionBehavior`, `PermissionUpdate`,
    `PermissionUpdateDestination`, `PermissionRuleValue` types — full permission system vocabulary

- **`HookEvent` expanded** (`types/config.ts`):
  - Added 15 missing hook event types: `StopFailure`, `PermissionRequest`, `PermissionDenied`,
    `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `Elicitation`, `ElicitationResult`,
    `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`

- **`AgentDefinition` expanded** (`types/config.ts`):
  - Added missing fields: `criticalSystemReminder_EXPERIMENTAL`, `skills`, `initialPrompt`,
    `memory`, `effort` (6 new fields matching CC SDK contract)

- **`SDKMessage` type union expanded** (`core/query-loop.ts`):
  - Added `fast_mode_state?` field to init message, success result, and error result types
  - Added `structured_output?` and `deferred_tool_use?` fields to success result type
  - Added `error_max_structured_output_retries` to error result subtype union
  - Added 6 new message type variants: `task_started`, `task_progress`, `task_notification`,
    `tool_use_summary`, `rate_limit_event`, `prompt_suggestion`, `files_persisted`
  - Added generic `system` catch-all variant for forward compatibility

- **Provider resolution** (`core/session.ts`, `index.ts`):
  - Both `createSession()` and `query()` now resolve `options.apiKey` and `options.anthropicBaseUrl`
    before falling back to env vars — enables zero-change consumption by `mcp-manager.ts`

- tsc --noEmit passes

---

## Priority Queue (Next Runs)

### P1 (Critical)
- [ ] Full consumer compatibility e2e test (spawn session, send message, verify all SDKMessage shapes)

### P2 (Important)
- [x] ~~WebSearchTool real implementation~~ (Run 20)
- [ ] Worker Thread isolation for background agents (deferred: CC Rust uses Tokio tasks, not threads; our Promise-based approach is equivalent)
- [ ] Agent progress summaries (agentProgressSummaries fork+summarize every 30s)
- [x] ~~Typed system subtypes for task_started/task_progress/task_notification in SDKMessage union~~ (Run 22 + Run 25 complete)
