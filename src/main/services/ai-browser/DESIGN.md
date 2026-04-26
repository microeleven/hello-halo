# AI Browser Module — Design

> For AI developers: Read this before modifying the AI Browser module.

## Architecture

The AI Browser module provides 28 browser control tools via an in-process MCP server.
Tools are exposed with prefix `mcp__ai-browser__` (e.g. `mcp__ai-browser__browser_click`).

```
                      ┌─────────────────────────────────────┐
                      │  createAIBrowserMcpServer()          │
                      │  (sdk-mcp-server.ts)                 │
                      │                                      │
                      │  PRIMARY ENTRY POINT                 │
                      │  All side effects init here          │
                      └──────────┬──────────────────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
   installDownloadHandler()   buildAllTools(ctx)   ctx.workDir
   (download-handler.ts)      (tools/index.ts)
            │                    │
   session-level             28 tool functions
   will-download handler     grouped by category
```

## Entry Points

`createAIBrowserMcpServer()` is the **sole primary entry point**. All session-level
side effects (download handler, future monitoring, etc.) are initialized here
idempotently — not in a separate init function.

### Callers

| Path | File | Context |
|------|------|---------|
| Main chat | `services/agent/send-message.ts` | Global singleton (no scoped ctx) |
| App chat | `apps/runtime/app-chat.ts` | Scoped context |
| Automation | `apps/runtime/execute.ts` | Scoped context |

### Adding new session-level side effects

When a new feature requires a one-time session setup (e.g. registering event
listeners on the Electron session), add the idempotent initialization call
inside `createAIBrowserMcpServer()`, NOT in a separate init function. This
guarantees the effect is active before any tool can trigger it, regardless
of which caller path is used.

## Context Model

```
BrowserContext (singleton)          — used by main chat
BrowserContext (scoped, per-agent)  — used by app-chat / automation
```

Scoped contexts are created via `createScopedBrowserContext(null)` and passed
to `createAIBrowserMcpServer(scopedCtx, workDir)`. They isolate view ownership,
download tracking, and monitoring state per agent session.

### Lifecycle

- **Creation**: Caller creates scoped context → passes to MCP server factory
- **Cleanup (scoped)**: Caller calls `ctx.destroy()` when the agent session ends
- **Cleanup (singleton)**: `cleanupAIBrowser()` called by `bootstrap/extended.ts` on app shutdown

## File Map

| File | Responsibility |
|------|---------------|
| `index.ts` | Public API: re-exports, system prompt, cleanup |
| `sdk-mcp-server.ts` | MCP server factory (primary entry point) |
| `context.ts` | BrowserContext class (state, CDP, element ops, downloads) |
| `snapshot.ts` | Accessibility tree snapshot creation |
| `download-handler.ts` | Session-level `will-download` handler for silent AI downloads |
| `download-utils.ts` | Shared filename sanitization / unique path resolution |
| `types.ts` | Type definitions |
| `tools/` | Tool implementations by category (28 tools) |
| `tools/index.ts` | Tool aggregation (`buildAllTools`) |
| `tools/helpers.ts` | Shared tool utilities |

## Download Architecture

AI-initiated downloads bypass the native Save-As dialog via a session-level
`will-download` handler on `persist:browser`:

```
wc.downloadURL(url)
  → Electron fires will-download on persist:browser session
    → download-handler.ts routes to owning BrowserContext
      → ctx.registerDownload() sets savePath (silent save)
        → ctx.updateDownloadProgress() resolves waitForDownload()
```

The routing uses `contextsByWebContentsId` Map (webContents ID → BrowserContext),
populated by `ctx.trackView()` when `browser_new_page` creates a view.
