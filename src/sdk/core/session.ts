/**
 * @module core/session
 * V2Session — stateful send/stream/close interface for the Agent-Core SDK.
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import type { Message, LlmProvider } from '../types/provider.js';
import type { Tool } from '../types/tool.js';
import type { Options, QueryConfig, PermissionMode, SlashCommand } from '../types/config.js';
import { resolveQueryConfig } from './context.js';
import { AnthropicProvider } from '../llm/anthropic.js';
import { queryLoop } from './query-loop.js';
import type { SDKMessage, QueryLoopOptions } from './query-loop.js';
import type { McpServerConnectionStatus } from '../tools/mcp/bridge.js';
import { getAllTools, filterTools } from '../tools/registry.js';
import { extractSdkMcpTools } from '../tools/mcp/bridge.js';
import {
  McpConnectionManager,
  createMcpConnectionManager,
} from '../tools/mcp/connection-manager.js';
import { initOrchestrator } from '../orchestrator/init.js';
import type { OrchestratorHandle } from '../orchestrator/init.js';
import { runEventHooks } from './hooks.js';
import { TranscriptWriter, readTranscriptMessages } from './transcript.js';

// ---------------------------------------------------------------------------
// SDKSession interface
// ---------------------------------------------------------------------------

/**
 * A stateful session that holds conversation state across multiple sends.
 */
export interface SDKSession {
  /** Unique identifier for this session. */
  readonly sessionId: string;

  /**
   * Send a message to the session. The session will process the message
   * through the query loop and yield results via `stream()`.
   */
  send(message: string | { role: 'user'; content: string }): Promise<void>;

  /**
   * Stream events from the session. Returns an async generator that yields
   * SDKMessage events as the session processes messages.
   */
  stream(): AsyncGenerator<SDKMessage, void, undefined>;

  /** Close the session and release resources. */
  close(): void;

  /** Interrupt the current query loop iteration. */
  interrupt(): Promise<void>;

  /** Change the model used for subsequent turns. */
  setModel(model: string | undefined): Promise<void>;

  /** Change the max thinking tokens for subsequent turns. */
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;

  /** Change the permission mode for subsequent turns. */
  setPermissionMode(mode: PermissionMode): Promise<void>;

  /** Async dispose support — calls close(). */
  [Symbol.asyncDispose](): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal session state
// ---------------------------------------------------------------------------

interface SessionState {
  sessionId: string;
  config: QueryConfig;
  provider: LlmProvider;
  tools: Tool[];
  messages: Message[];
  abortController: AbortController;
  closed: boolean;
  /** Queue of pending user messages. */
  pendingMessages: Array<string | Message>;
  /** Resolve function to wake up stream() when a message arrives via send(). */
  pendingWakeUp: (() => void) | null;
  /** Active stream generator (only one at a time). */
  activeStream: AsyncGenerator<SDKMessage, void, undefined> | null;
  /** MCP connection manager (for reconnection + cleanup). */
  mcpManager: McpConnectionManager | null;
  /** All MCP server connection statuses (SDK + external). */
  mcpServerStatuses: McpServerConnectionStatus[];
  /** Orchestrator handle (for sub-agent lifecycle). */
  orchestrator: OrchestratorHandle | null;
  /** Slash commands for supportedCommands() (from config). */
  slashCommands: SlashCommand[];
  /** Exit listeners for the transport shim. */
  exitListeners: Set<(error: Error | undefined) => void>;
  /** Transcript writer for session persistence (null if disabled). */
  transcriptWriter: TranscriptWriter | null;
  /** Whether the system:init event has been emitted to the current consumer. */
  initEmitted: boolean;
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

/**
 * Create a new SDK session.
 *
 * The session maintains conversation state across multiple `send()` calls.
 * Use `stream()` to receive SDKMessage events.
 *
 * @param options - SDK Options for configuring the session
 * @returns A new SDKSession instance
 */
export async function createSession(options: Options): Promise<SDKSession> {
  const env = options.env as Record<string, string | undefined> | undefined;
  const apiKey = env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  const baseUrl = env?.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL;
  const provider = options.provider ?? (
    apiKey
      ? new AnthropicProvider({ apiKey, baseUrl })
      : (() => { throw new Error('createSession() requires options.provider or ANTHROPIC_API_KEY in options.env / process.env.'); })()
  );

  const config = resolveQueryConfig(options);
  const sessionId = options.sessionId ?? randomUUID();
  const abortController = options.abortController ?? new AbortController();

  // Build tool list:
  // 1. Start with built-in tools
  // 2. Merge customTools (custom overrides built-in by name)
  // 3. Bridge SDK MCP server tools (synchronous, in-process)
  // 4. Connect external MCP servers (async, stdio/sse/http)
  // 5. Apply allowedTools/disallowedTools filtering
  let tools: Tool[];
  if (options.customTools && options.customTools.length > 0) {
    const customToolNames = new Set(options.customTools.map((t) => t.name));
    const builtInTools = getAllTools().filter((t) => !customToolNames.has(t.name));
    tools = [...builtInTools, ...options.customTools];
  } else {
    tools = getAllTools();
  }

  // Bridge SDK MCP server tools into the tool list (synchronous)
  const mcpTools = extractSdkMcpTools(
    options.mcpServers as Record<string, unknown> | undefined,
  );
  if (mcpTools.length > 0) {
    const mcpToolNames = new Set(mcpTools.map((t) => t.name));
    tools = tools.filter((t) => !mcpToolNames.has(t.name));
    tools.push(...mcpTools);
  }

  // Collect MCP server statuses for the init message.
  // SDK (in-process) servers are always "connected".
  const mcpServerStatuses: McpServerConnectionStatus[] = [];
  if (options.mcpServers) {
    for (const [name, cfg] of Object.entries(options.mcpServers)) {
      if (cfg && typeof cfg === 'object' && (cfg as Record<string, unknown>).type === 'sdk') {
        mcpServerStatuses.push({ name, status: 'connected' });
      }
    }
  }

  // Connect external MCP servers via the connection manager (with reconnection support)
  let mcpManager: McpConnectionManager | null = null;
  try {
    mcpManager = createMcpConnectionManager(
      options.mcpServers as Record<string, unknown> | undefined,
    );
    await mcpManager.connectAll();
    const extTools = mcpManager.getBridgedTools();
    if (extTools.length > 0) {
      const extToolNames = new Set(extTools.map((t) => t.name));
      tools = tools.filter((t) => !extToolNames.has(t.name));
      tools.push(...extTools);
    }
    // Merge external server statuses
    mcpServerStatuses.push(...mcpManager.getStatuses());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[SDK] External MCP connection error: ${msg}`);
  }

  tools = filterTools(tools, {
    allowedTools: config.allowedTools,
    disallowedTools: config.disallowedTools,
  });

  // Initialize the orchestrator (wires AgentTool spawner + SendMessage router)
  const configWithSignal = { ...config, abortSignal: abortController.signal };
  const orchestrator = initOrchestrator({
    provider,
    config: configWithSignal,
    tools,
  });

  // Build slash commands from options (if provided)
  const slashCommands: SlashCommand[] = [];
  if (options.slashCommands) {
    for (const cmd of options.slashCommands) {
      if (typeof cmd === 'string') {
        slashCommands.push({ name: cmd, description: '' });
      } else if (cmd && typeof cmd === 'object' && 'name' in cmd) {
        slashCommands.push(cmd as SlashCommand);
      }
    }
  }

  // Resume session: load transcript messages from disk
  let resumedMessages: Message[] = [];
  const resumeSessionId = options.resume as string | undefined;
  if (resumeSessionId) {
    try {
      const loaded = await readTranscriptMessages(resumeSessionId, config.cwd);
      if (loaded && loaded.length > 0) {
        resumedMessages = loaded;
        console.log(
          `[SDK] Resumed session ${resumeSessionId} with ${loaded.length} messages from transcript`,
        );
      } else {
        console.log(`[SDK] No transcript found for session ${resumeSessionId}, starting fresh`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SDK] Failed to load transcript for resume: ${msg}`);
    }
  }

  // Create transcript writer for this session (persists conversation to disk)
  const transcriptWriter = new TranscriptWriter(sessionId, config.cwd);

  const state: SessionState = {
    sessionId,
    config: configWithSignal,
    provider,
    tools,
    messages: resumedMessages,
    abortController,
    closed: false,
    pendingMessages: [],
    pendingWakeUp: null,
    activeStream: null,
    mcpManager,
    mcpServerStatuses,
    orchestrator,
    slashCommands,
    exitListeners: new Set(),
    transcriptWriter,
    initEmitted: false,
  };

  // Fire SessionStart hook (fire-and-forget; advisory, does not block init)
  void runEventHooks(
    configWithSignal.hooks,
    'SessionStart',
    {
      hook_event_name: 'SessionStart',
      session_id: sessionId,
      cwd: configWithSignal.cwd,
    },
    abortController.signal,
  ).catch(() => {});

  return createSessionProxy(state);
}

// ---------------------------------------------------------------------------
// Session proxy implementation
// ---------------------------------------------------------------------------

/**
 * Create an in-process transport shim.
 *
 * Exposes `isReady()`, `.ready`, and `onExit()` as trivial stubs because
 * there is no subprocess to monitor. The consumer (hello-halo) accesses
 * these via `(session as any).query.transport`.
 */
function createTransportShim(state: SessionState) {
  return {
    /** Always true — no subprocess; the query loop is in-process. */
    isReady(): boolean {
      return !state.closed;
    },
    /** Always true — no subprocess. */
    get ready(): boolean {
      return !state.closed;
    },
    /**
     * Register a callback for "process exit". In the in-process SDK, this
     * fires when the session is closed. Returns an unsubscribe function.
     */
    onExit(callback: (error: Error | undefined) => void): () => void {
      state.exitListeners.add(callback);
      return () => {
        state.exitListeners.delete(callback);
      };
    },
  };
}

/**
 * Create a query proxy exposing transport and supportedCommands.
 *
 * The consumer accesses `(session as any).query.transport` and
 * `(session as any).query.supportedCommands()`.
 */
function createQueryProxy(state: SessionState) {
  const transport = createTransportShim(state);
  return {
    transport,
    /** Return slash commands registered in this session. */
    async supportedCommands(): Promise<SlashCommand[]> {
      return state.slashCommands;
    },
  };
}

function createSessionProxy(state: SessionState): SDKSession {
  const queryProxy = createQueryProxy(state);

  // Build the session object with both public interface and internal properties
  // that the consumer accesses via `(session as any).xxx`.
  const session: Record<string, unknown> = {};

  // --- Internal properties (accessed via `as any` by consumer) ---

  // `(session as any).pid` — consumer uses for health monitoring.
  // In-process SDK has no subprocess; expose current process PID.
  Object.defineProperty(session, 'pid', {
    get: () => process.pid,
    enumerable: false,
  });

  // `(session as any).query` — consumer uses for transport + supportedCommands.
  Object.defineProperty(session, 'query', {
    get: () => queryProxy,
    enumerable: false,
  });

  // `(session as any).abortController` — consumer uses for session rebuild abort.
  Object.defineProperty(session, 'abortController', {
    get: () => state.abortController,
    enumerable: false,
  });

  // --- Public SDKSession interface ---

  Object.defineProperty(session, 'sessionId', {
    get: () => state.sessionId,
    enumerable: true,
  });

  session.send = async function send(
    message: string | { role: 'user'; content: string },
  ): Promise<void> {
    if (state.closed) {
      throw new Error('Session is closed');
    }

    let text = typeof message === 'string' ? message : message.content;

    // Fire UserPromptSubmit hook — hooks can inject additionalContext
    if (state.config.hooks?.UserPromptSubmit) {
      try {
        const results = await runEventHooks(
          state.config.hooks,
          'UserPromptSubmit',
          {
            hook_event_name: 'UserPromptSubmit',
            session_id: state.sessionId,
            cwd: state.config.cwd,
            user_message: text,
          },
          state.abortController.signal,
        );
        const ctx = results
          .filter((r) => !('hookError' in r) && r.additionalContext)
          .map((r) => String(r.additionalContext))
          .join('\n');
        if (ctx) {
          text = `${text}\n\n${ctx}`;
        }
      } catch {
        // Advisory — hook errors don't block message delivery
      }
    }

    state.pendingMessages.push(text);
    // Wake up stream() if it is waiting for a message.
    state.pendingWakeUp?.();
    state.pendingWakeUp = null;
  };

  session.stream = async function* stream(): AsyncGenerator<SDKMessage, void, undefined> {
      if (state.closed) {
        throw new Error('Session is closed');
      }

      // If there are no pending messages, wait until send() wakes us up.
      if (state.pendingMessages.length === 0 && !state.closed) {
        await new Promise<void>((resolve) => {
          state.pendingWakeUp = resolve;
        });
      }

      if (state.closed) return;

      // Drain all pending messages
      const pendingTexts: string[] = [];
      while (state.pendingMessages.length > 0) {
        const msg = state.pendingMessages.shift()!;
        pendingTexts.push(typeof msg === 'string' ? msg : String(msg));
      }

      // Combine pending messages into a single prompt
      const prompt = pendingTexts.join('\n\n');

      // Add the user message to session history BEFORE running the query loop
      const userMessage: Message = { role: 'user' as const, content: prompt };
      state.messages.push(userMessage);

      // Persist user message to transcript (fire-and-forget)
      void state.transcriptWriter?.writeUserMessage(userMessage);

      // Build the full conversation as initial messages for the query loop
      const initialMessages: Message[] = [...state.messages];

      // Track whether we've yielded the system:init event to this consumer.
      // On fresh sessions this is the first call; on resumed sessions we always
      // want the init event once (so the consumer can populate model/tools UI).
      const shouldEmitInit = !state.initEmitted;
      state.initEmitted = true;

      // Run the query loop, passing the session ID for consistent message session_id fields
      const queryOpts: QueryLoopOptions = {
        sessionId: state.sessionId,
        mcpServerStatuses: state.mcpServerStatuses.length > 0
          ? state.mcpServerStatuses
          : undefined,
      };
      const gen = queryLoop(
        state.config,
        state.provider,
        state.tools,
        initialMessages,
        queryOpts,
      );

      for await (const msg of gen) {
        if (state.closed) {
          gen.return(undefined);
          return;
        }

        // Track messages for session continuity and persist to transcript
        if (msg.type === 'assistant') {
          state.messages.push(msg.message);
          void state.transcriptWriter?.writeAssistantMessage(msg.message);
        } else if (msg.type === 'user') {
          // Tool result messages from the query loop — persist for full context on resume
          state.messages.push(msg.message);
          void state.transcriptWriter?.writeUserMessage(msg.message);
        }

        // Skip init events after the first send (the session already knows
        // its tools and model). Also emits on resume so consumer can populate UI.
        if (msg.type === 'system' && msg.subtype === 'init' && !shouldEmitInit) {
          continue;
        }

        yield msg;
      }
  };

  session.close = function close(): void {
    if (!state.closed) {
      // Fire SessionEnd hook (fire-and-forget with fresh signal — main signal is about to be aborted)
      void runEventHooks(
        state.config.hooks,
        'SessionEnd',
        {
          hook_event_name: 'SessionEnd',
          session_id: state.sessionId,
          cwd: state.config.cwd,
        },
        new AbortController().signal,
      ).catch(() => {});

      state.closed = true;
      state.abortController.abort();
      // Wake up stream() if it is waiting — it will see closed=true and return.
      state.pendingWakeUp?.();
      state.pendingWakeUp = null;

      // Notify exit listeners (transport shim)
      for (const listener of state.exitListeners) {
        try {
          listener(undefined);
        } catch { /* advisory */ }
      }
      state.exitListeners.clear();

      // Dispose orchestrator (abort sub-agents, reset stubs)
      if (state.orchestrator) {
        state.orchestrator.dispose();
        state.orchestrator = null;
      }

      // Disconnect all external MCP servers (cancels reconnect loops)
      if (state.mcpManager) {
        state.mcpManager.disconnectAll();
        state.mcpManager = null;
      }
    }
  };

  session.interrupt = async function interrupt(): Promise<void> {
    state.abortController.abort();
    // Create a new abort controller for subsequent interactions
    state.abortController = new AbortController();
    state.config = { ...state.config, abortSignal: state.abortController.signal };
  };

  session.setModel = async function setModel(model: string | undefined): Promise<void> {
    if (model) {
      state.config = { ...state.config, model };
    }
  };

  session.setMaxThinkingTokens = async function setMaxThinkingTokens(
    maxThinkingTokens: number | null,
  ): Promise<void> {
    if (maxThinkingTokens === null) {
      state.config = { ...state.config, thinking: { type: 'disabled' } };
    } else {
      state.config = {
        ...state.config,
        thinking: { type: 'enabled', budgetTokens: maxThinkingTokens },
      };
    }
  };

  session.setPermissionMode = async function setPermissionMode(
    _mode: PermissionMode,
  ): Promise<void> {
    // Permission mode is handled by the canUseTool callback.
    // The SDK preserves the callback interface.
  };

  Object.defineProperty(session, Symbol.asyncDispose, {
    value: async function dispose(): Promise<void> {
      (session as unknown as SDKSession).close();
    },
    enumerable: false,
  });

  return session as unknown as SDKSession;
}
