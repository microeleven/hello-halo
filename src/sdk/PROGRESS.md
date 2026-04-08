# Agent-Core SDK — Development Progress

Drop-in replacement for `@anthropic-ai/claude-agent-sdk`.
In-process execution, OpenAI-compat providers, Worker Thread multi-agent isolation.

## Status: Active Development

Branch: `feature/sdk`

---

## Completed (Run 1–10)

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

---

## Priority Queue (Next Runs)

### P1 (Critical)
- [ ] Worker Thread isolation for background agents (true parallelism)
- [ ] resume session support (Options.resume → reload messages from transcript)

### P2 (Important)
- [ ] WebSearchTool real implementation
- [ ] Agent progress summaries (agentProgressSummaries fork+summarize every 30s)

### P3 (Nice to have)
- [ ] GlobTool hidden directory handling
- [ ] TaskStopTool actual process termination
