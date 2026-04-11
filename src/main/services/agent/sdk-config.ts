/**
 * Agent Module - SDK Configuration Builder
 *
 * Pure functions for building SDK configuration.
 * Centralizes all SDK-related configuration logic to ensure consistency
 * between send-message.ts and session-manager.ts.
 */

import path from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { app } from 'electron'
import { resolveClaudeConfigDir } from '../config.service'
import { ensureOpenAICompatRouter, encodeBackendConfig } from '../../openai-compat-router'
import type { ApiCredentials } from './types'
import { inferOpenAIWireApi, credentialsToBackendConfig } from './helpers'
import { buildSystemPrompt, DEFAULT_ALLOWED_TOOLS } from './system-prompt'
import { createCanUseTool } from './permission-handler'

// ============================================
// Configuration
// ============================================

/**
 * When true, Anthropic requests route through the local router for interceptor
 * coverage (warmup, preflight, etc.) with zero-conversion passthrough.
 * When false, Anthropic requests go directly to the API via the SDK's built-in
 * HTTP client — no router, no interceptors, no overhead.
 *
 * Toggle this to A/B test proxy overhead vs direct SDK performance.
 * OpenAI/OAuth providers always route through the router regardless of this flag.
 */
const PROXY_ANTHROPIC = true

// ============================================
// Types
// ============================================

/**
 * Resolved credentials ready for SDK use.
 * This is the output of credential resolution process.
 */
export interface ResolvedSdkCredentials {
  /** Base URL for Anthropic API (may be OpenAI compat router) */
  anthropicBaseUrl: string
  /** API key for Anthropic API (may be encoded backend config) */
  anthropicApiKey: string
  /** Model to pass to SDK (may be fake Claude model for compat) */
  sdkModel: string
  /** User's actual configured model name (for display) */
  displayModel: string
}

/**
 * Parameters for building SDK environment variables
 */
export interface SdkEnvParams {
  anthropicApiKey: string
  anthropicBaseUrl: string
  /** Claude CLI config directory mode */
  configDirMode?: 'halo' | 'cc' | 'custom'
  /** Custom config dir path (when configDirMode === 'custom') */
  customConfigDir?: string
  /** Enable Agent Teams (multi-agent collaboration) */
  enableTeams?: boolean
}

/**
 * Parameters for building base SDK options
 */
export interface BaseSdkOptionsParams {
  /** Resolved SDK credentials */
  credentials: ResolvedSdkCredentials
  /** Working directory for the agent */
  workDir: string
  /** Path to headless Electron binary */
  electronPath: string
  /** Space ID */
  spaceId: string
  /** Conversation ID */
  conversationId: string
  /** Optional stderr handler (for error accumulation) */
  stderrHandler?: (data: string) => void
  /** Optional MCP servers configuration */
  mcpServers?: Record<string, any> | null
  /** Maximum tool call turns per message (from config) */
  maxTurns?: number
  /** System prompt profile ('official' | 'halo') */
  promptProfile?: 'official' | 'halo'
  /** Claude CLI config directory mode */
  configDirMode?: 'halo' | 'cc' | 'custom'
  /** Custom config dir path (when configDirMode === 'custom') */
  customConfigDir?: string
  /** Enable Agent Teams (multi-agent collaboration) */
  enableTeams?: boolean
}

// ============================================
// Credential Resolution
// ============================================

/**
 * Resolve API credentials for SDK use.
 *
 * This function handles the complexity of different providers:
 * - Anthropic: Routed through OpenAI compat router (PROXY_ANTHROPIC=true)
 * - OpenAI/OAuth: Route through OpenAI compat router with encoded config
 *
 * Important: The model is encoded into the apiKey (ANTHROPIC_API_KEY env var)
 * at session creation time. Model changes require session rebuild — they cannot
 * be switched dynamically via setModel(). See config.service.ts getAiSourcesSignature().
 *
 * @param credentials - Raw API credentials from getApiCredentials()
 * @returns Resolved credentials ready for SDK
 */
export async function resolveCredentialsForSdk(
  credentials: ApiCredentials
): Promise<ResolvedSdkCredentials> {
  // Experimental: route Anthropic through local router for interceptor coverage
  if (PROXY_ANTHROPIC && credentials.provider === 'anthropic') {
    return resolveAnthropicPassthrough(credentials)
  }

  // ── Original logic (identical to pre-optimization code) ──
  // Start with direct values
  let anthropicBaseUrl = credentials.baseUrl
  let anthropicApiKey = credentials.apiKey
  let sdkModel = credentials.model || 'claude-opus-4-5-20251101'
  const displayModel = credentials.displayModel || credentials.model

  // For non-Anthropic providers (openai or OAuth), use the OpenAI compat router
  if (credentials.provider !== 'anthropic') {
    const router = await ensureOpenAICompatRouter({ debug: false })
    anthropicBaseUrl = router.baseUrl

    // Use apiType from credentials (set by provider), fallback to inference
    const apiType = credentials.apiType
      || (credentials.provider === 'oauth' ? 'chat_completions' : inferOpenAIWireApi(credentials.baseUrl))

    anthropicApiKey = encodeBackendConfig(credentialsToBackendConfig(credentials, { apiType }))

    // Pass a fake Claude model to CC for normal request handling
    sdkModel = 'claude-sonnet-4-20250514'

    console.log(`[SDK Config] ${credentials.provider} provider: routing via ${anthropicBaseUrl}, apiType=${apiType}`)
  }

  return {
    anthropicBaseUrl,
    anthropicApiKey,
    sdkModel,
    displayModel
  }
}

/**
 * Resolve Anthropic credentials via local router passthrough (experimental).
 * Isolated from the main path — only called when PROXY_ANTHROPIC = true.
 */
async function resolveAnthropicPassthrough(
  credentials: ApiCredentials
): Promise<ResolvedSdkCredentials> {
  const router = await ensureOpenAICompatRouter({ debug: false })
  const configUrl = credentials.baseUrl.replace(/\/+$/, '') + '/v1/messages'

  const anthropicApiKey = encodeBackendConfig(
    credentialsToBackendConfig(credentials, { url: configUrl, apiType: 'anthropic_passthrough' })
  )

  console.log(`[SDK Config] Anthropic passthrough: routing via ${router.baseUrl}`)

  return {
    anthropicBaseUrl: router.baseUrl,
    anthropicApiKey,
    sdkModel: credentials.model || 'claude-opus-4-5-20251101',
    displayModel: credentials.displayModel || credentials.model
  }
}

// ============================================
// Sandbox Settings (written to settings.json)
// ============================================

/**
 * Sandbox configuration
 *
 * Sandbox is enabled primarily for performance optimization (skips some runtime checks).
 * Network and filesystem access are intentionally permissive - the goal is not strict
 * security isolation, but rather to enable SDK's internal optimizations.
 *
 * Note: Do NOT add `network.allowedDomains` config unless you actually need domain filtering.
 * Setting this array (even to ['*']) triggers SDK's network proxy infrastructure, which:
 *   - Starts HTTP + SOCKS proxy servers (performance overhead)
 *   - Routes all network requests through the proxy (added latency)
 *   - Has a bug where '*' wildcard is not properly handled (causes false blocks)
 *
 * Security note: SDK has built-in filesystem restrictions (e.g., protecting Halo config files)
 * that are separate from these sandbox settings.
 */
const SANDBOX_CONFIG = {
  enabled: false,
  autoAllowBashIfSandboxed: true,
  // No network config → proxy servers won't start → no performance overhead
}
let sandboxSettingsWritten = false

/**
 * Ensure sandbox config exists in CLAUDE_CONFIG_DIR/settings.json.
 *
 * By writing sandbox to the userSettings file, the CLI reads it natively
 * without needing --settings flag. This avoids the CLI writing a temp file
 * to $TMPDIR and chokidar watching the entire tmpdir (which crashes on
 * macOS due to Unix socket files like CloudClient).
 *
 * Runs once per process lifetime — subsequent calls are no-ops.
 */
function ensureSandboxSettings(configDir: string): void {
  if (sandboxSettingsWritten) return
  mkdirSync(configDir, { recursive: true })
  const settingsPath = path.join(configDir, 'settings.json')
  try {
    let settings: Record<string, any> = {}
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    }
    let dirty = false
    if (JSON.stringify(settings.sandbox) !== JSON.stringify(SANDBOX_CONFIG)) {
      settings.sandbox = SANDBOX_CONFIG
      dirty = true
    }
    if (settings.skipWebFetchPreflight !== true) {
      settings.skipWebFetchPreflight = true
      dirty = true
    }
    if (dirty) {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    }
  } catch (err) {
    console.error('[SDK Config] Failed to write sandbox settings:', err)
  }
  sandboxSettingsWritten = true
}

// ============================================
// Environment Variables
// ============================================

/**
 * Prefixes to strip from inherited env before spawning CC subprocess.
 * Prevents leaked vars (ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY, CLAUDE_CODE_SSE_PORT, etc.)
 * from overriding Halo's explicit configuration.
 */
const AI_SDK_ENV_PREFIXES = ['ANTHROPIC_', 'OPENAI_', 'CLAUDE_']

/**
 * Copy of process.env with all AI SDK variables removed.
 */
export function getCleanUserEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (AI_SDK_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) {
      delete env[key]
    }
  }
  return env
}

/**
 * Build env for CC subprocess.
 * Inherits user env (PATH, HOME, SSH, proxy, etc.) for toolchain compat,
 * strips AI SDK vars, then sets exactly what CC needs.
 */
export function buildSdkEnv(params: SdkEnvParams): Record<string, string | number> {
  const env: Record<string, string | number | undefined> = {
    ...getCleanUserEnv(),

    // Electron: run as Node.js process
    ELECTRON_RUN_AS_NODE: 1,
    ELECTRON_NO_ATTACH_CONSOLE: 1,

    // API credentials
    ANTHROPIC_API_KEY: params.anthropicApiKey,
    ANTHROPIC_BASE_URL: params.anthropicBaseUrl,

    // Claude config dir: resolved from configDirMode (halo default / cc default / custom)
    CLAUDE_CONFIG_DIR: (() => {
      const configDir = resolveClaudeConfigDir(params.configDirMode, params.customConfigDir)
      ensureSandboxSettings(configDir)
      return configDir
    })(),

    // Localhost bypasses proxy (for OpenAI compat router)
    NO_PROXY: 'localhost,127.0.0.1',
    no_proxy: 'localhost,127.0.0.1',

    // Disable non-essential traffic
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_COST_WARNINGS: '1',
    CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK: '1',

    // Align entrypoint with hardcoded User-Agent (external, cli) so billing header
    // and User-Agent are consistent — matches a regular CLI OAuth user's fingerprint.
    // Without this, main.tsx would auto-set it to 'sdk-cli' (non-interactive mode).
    CLAUDE_CODE_ENTRYPOINT: 'cli',

    // Performance: skip warmup calls + raise V8 heap ceiling
    CLAUDE_CODE_REMOTE: 'true',

    // Performance: skip file snapshot I/O (Halo doesn't expose /rewind)
    CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: '1',

    // Enable Agent Teams (multi-agent collaboration with named teammates)
    // Only set when explicitly enabled via Settings > Advanced
    ...(params.enableTeams ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } : {}),

    // Windows: pass through Git Bash path (set by git-bash.service during startup)
    // This was stripped by getCleanUserEnv() along with all CLAUDE_* vars
    ...(process.env.CLAUDE_CODE_GIT_BASH_PATH
      ? { CLAUDE_CODE_GIT_BASH_PATH: process.env.CLAUDE_CODE_GIT_BASH_PATH }
      : {}),

    // debug flag to claude code sdk
    // DEBUG: '1',
    // DEBUG_CLAUDE_AGENT_SDK: '1',
  }

  // Normalize proxy env vars: add http:// if protocol is missing.
  // Some Windows users (esp. with Clash/V2Ray) set HTTPS_PROXY=127.0.0.1:7890
  // without protocol prefix. The Claude Code CLI's Anthropic SDK does
  // new URL(process.env.HTTPS_PROXY) which throws ERR_INVALID_URL.
  // NO_PROXY check happens AFTER URL parsing, so it can't prevent the crash.
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    const val = env[key]
    if (typeof val === 'string' && val && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(val)) {
      env[key] = `http://${val}`
    }
  }

  return env as Record<string, string | number>
}

// ============================================
// Claude Code CLI Path Resolution
// ============================================

const CLI_RELATIVE = 'node_modules/@anthropic-ai/claude-code/cli.js'

/**
 * Resolve the path to the Claude Code CLI executable.
 *
 * Three runtime environments need to be handled:
 *
 * 1. **Packaged** (`app.isPackaged === true`): electron-builder bundles node_modules
 *    alongside app.asar. `app.getAppPath()` returns the asar root, so the CLI is
 *    always at `<appPath>/node_modules/...`. This path is guaranteed to exist.
 *
 * 2. **Dev** (`npm run dev`): Vite runs the main process from the project root.
 *    `app.getAppPath()` returns the project root, so the CLI is at
 *    `<projectRoot>/node_modules/...`.
 *
 * 3. **Built but unpackaged** (`npm run build` + run `out/main/index.mjs`, i.e. E2E):
 *    Electron resolves `app.getAppPath()` to `out/main/` (the entry file's directory),
 *    which has no `node_modules`. The CLI must be found at the project root instead.
 *
 * Using `app.isPackaged` cleanly separates case 1 from 2/3. For the unpackaged cases,
 * `existsSync` picks whichever candidate path actually exists, covering both dev and E2E
 * without any hardcoded relative-path assumptions.
 */
function resolveClaudeCodeCliPath(): string {
  if (app.isPackaged) {
    // Packaged: node_modules is bundled inside the asar alongside the app
    return path.join(app.getAppPath(), CLI_RELATIVE)
  }

  // Unpackaged (dev or E2E build): search candidate locations
  const candidates = [
    // Dev mode: app.getAppPath() === project root
    path.join(app.getAppPath(), CLI_RELATIVE),
    // E2E build mode: app.getAppPath() === out/main/, project root is two levels up
    path.join(app.getAppPath(), '..', '..', CLI_RELATIVE),
  ]

  const resolved = candidates.find(existsSync)
  if (!resolved) {
    throw new Error(
      `[SDK Config] Claude Code CLI not found. Searched:\n${candidates.join('\n')}`
    )
  }
  return resolved
}

// ============================================
// SDK Options Builder
// ============================================

/**
 * Build base SDK options.
 *
 * This constructs the common SDK options used by both sendMessage and ensureSessionWarm.
 * Does NOT include dynamic configurations like AI Browser or Thinking mode.
 *
 * @param params - SDK options parameters
 * @returns Base SDK options object
 */
export function buildBaseSdkOptions(params: BaseSdkOptionsParams): Record<string, any> {
  const {
    credentials,
    workDir,
    electronPath,
    spaceId,
    conversationId,
    stderrHandler,
    mcpServers
  } = params

  console.log(`[SDK Config] buildBaseSdkOptions: workDir="${workDir}", spaceId="${spaceId}", configDirMode="${params.configDirMode ?? 'halo'}"`)

  // Build environment variables
  const env = buildSdkEnv({
    anthropicApiKey: credentials.anthropicApiKey,
    anthropicBaseUrl: credentials.anthropicBaseUrl,
    configDirMode: params.configDirMode,
    customConfigDir: params.customConfigDir,
    enableTeams: params.enableTeams,
  })

  const cliPath = resolveClaudeCodeCliPath()

  // Build base options
  const sdkOptions: Record<string, any> = {
    model: credentials.sdkModel,
    cwd: workDir,
    env,
    pathToClaudeCodeExecutable: cliPath,
    extraArgs: {
      'dangerously-skip-permissions': null
    },
    stderr: stderrHandler || ((data: string) => {
      console.error(`[Agent][${conversationId}] CLI stderr:`, data)
    }),
    // Use Halo's custom system prompt instead of SDK's 'claude_code' preset
    systemPrompt: buildSystemPrompt({ workDir, modelInfo: credentials.displayModel, promptProfile: params.promptProfile }),
    maxTurns: params.maxTurns ?? 50,
    allowedTools: [...DEFAULT_ALLOWED_TOOLS],
    // Enable Skills loading from $CLAUDE_CONFIG_DIR/skills/ and <workspace>/.claude/skills/
    settingSources: ['user', 'project'],
    permissionMode: 'bypassPermissions' as const,
    canUseTool: createCanUseTool({
      spaceId,
      conversationId
    }),
    // Requires SDK patch: enable token-level streaming (stream_event)
    includePartialMessages: true,
    executable: electronPath,
    executableArgs: ['--no-warnings'],
    // Sandbox config is written to CLAUDE_CONFIG_DIR/settings.json (see ensureSandboxSettings)
    // instead of passing via SDK's sandbox option → --settings flag → tmpdir temp file.
    // This avoids CLI creating a temp file and chokidar watching the entire tmpdir.
  }

  // Add MCP servers if provided
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    sdkOptions.mcpServers = mcpServers
  }

  return sdkOptions
}
