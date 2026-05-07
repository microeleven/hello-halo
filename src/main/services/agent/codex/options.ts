/**
 * Option translation from Halo's Claude Code-shaped SDK options to Codex SDK
 * options. This keeps the rest of the agent engine protocol-driven while the
 * Codex-specific configuration stays isolated here.
 */

import path from 'path'
import { existsSync, mkdirSync } from 'fs'
import type { ApiCredentials } from '../types'
import { getApiCredentials, credentialsToBackendConfig } from '../helpers'
import { getConfig, getHaloDir } from '../../config.service'
import { getCleanUserEnv } from '../sdk-config'
import { ensureOpenAICompatRouter, encodeBackendConfig } from '../../../openai-compat-router'

export interface CodexResolvedOptions {
  clientOptions: Record<string, any>
  threadOptions: Record<string, any>
  systemPrompt?: string
  model: string
  displayModel: string
  mcpServers: Record<string, any>
  maxTurns: number
}

export async function resolveCodexOptions(sdkOptions: Record<string, any>): Promise<CodexResolvedOptions> {
  const appConfig = getConfig()
  const credentials = await getApiCredentials(appConfig)
  const env = buildCodexEnv(sdkOptions.env)
  const model = resolveCodexModel(sdkOptions.model, credentials)
  const clientRouting = await resolveCodexClientRouting(credentials)

  return {
    clientOptions: {
      apiKey: clientRouting.apiKey,
      baseUrl: clientRouting.baseUrl,
      env,
      config: buildCodexConfigOverrides(sdkOptions, appConfig, clientRouting),
      ...resolveCodexExecutableOverride(),
    },
    threadOptions: {
      model,
      workingDirectory: sdkOptions.cwd,
      skipGitRepoCheck: true,
      sandboxMode: resolveSandboxMode(sdkOptions),
      approvalPolicy: resolveApprovalPolicy(sdkOptions),
      networkAccessEnabled: true,
      webSearchMode: hasMcpServer(sdkOptions.mcpServers, 'web-search') ? 'live' : 'disabled',
    },
    systemPrompt: undefined,
    // Codex is a self-contained OpenAI agent product with its own system
    // prompt baked into `codex exec` (sandbox rules, apply_patch contract,
    // web_search policy, approval flow). Halo's system prompt is shaped for
    // the Claude Code harness and references tools that do not exist in
    // Codex (Read/Grep/TodoWrite/AskUserQuestion/etc.) plus a CC-style
    // operator persona. Stacking it on top of Codex's native prompt would
    // both confuse the model about its actual capabilities and double up
    // its operating instructions. We therefore drop the Halo prompt for
    // the Codex engine and let Codex be Codex.
    //
    // Source value (sdkOptions.systemPrompt) is intentionally ignored.
    model,
    displayModel: credentials.displayModel || credentials.model || model,
    mcpServers: sdkOptions.mcpServers || {},
    maxTurns: typeof sdkOptions.maxTurns === 'number' ? sdkOptions.maxTurns : 50,
  }
}

function buildCodexEnv(sourceEnv: Record<string, any> | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  const base = sourceEnv || getCleanUserEnv()
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = String(value)
  }

  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_BASE_URL
  delete env.CLAUDE_CONFIG_DIR

  env.CODEX_HOME = ensureCodexHome()
  env.DISABLE_TELEMETRY = '1'
  env.NO_PROXY = appendNoProxy(env.NO_PROXY || env.no_proxy)
  env.no_proxy = env.NO_PROXY

  // Surface codex CLI's own logs to stderr so the parent process can capture
  // them when a turn produces zero events. The user can override by exporting
  // RUST_LOG before launching Halo.
  if (!env.RUST_LOG) {
    env.RUST_LOG = 'codex_core=info,codex_exec=info'
  }

  return env
}

function ensureCodexHome(): string {
  const codexHome = path.join(getHaloDir(), 'codex')
  mkdirSync(codexHome, { recursive: true })
  return codexHome
}

function appendNoProxy(current: string | undefined): string {
  const values = new Set((current || '').split(',').map((entry) => entry.trim()).filter(Boolean))
  values.add('localhost')
  values.add('127.0.0.1')
  return Array.from(values).join(',')
}

function resolveCodexModel(optionModel: string | undefined, credentials: ApiCredentials): string {
  const candidate = credentials.model || optionModel
  if (candidate && !candidate.startsWith('claude-')) return candidate
  return process.env.HALO_CODEX_DEFAULT_MODEL || 'gpt-5.1-codex-max'
}

interface CodexClientRouting {
  apiKey: string
  baseUrl?: string
  disableWebsockets?: boolean
}

async function resolveCodexClientRouting(credentials: ApiCredentials): Promise<CodexClientRouting> {
  if (credentials.provider === 'anthropic') {
    return {
      apiKey: credentials.apiKey,
      baseUrl: resolveCodexBaseUrl(credentials),
    }
  }

  const router = await ensureOpenAICompatRouter({ debug: false })
  const upstreamApiType = credentials.apiType || inferCodexUpstreamApiType(credentials.baseUrl)
  const backendUrl = normalizeBackendEndpointUrl(credentials.baseUrl, upstreamApiType)
  const apiKey = encodeBackendConfig(
    credentialsToBackendConfig(credentials, {
      url: backendUrl,
      apiType: upstreamApiType,
    })
  )

  console.log(`[Codex Options] Routing ${credentials.provider} provider through Halo Responses proxy: upstream=${upstreamApiType}`)

  return {
    apiKey,
    baseUrl: `${router.baseUrl}/v1`,
    disableWebsockets: true,
  }
}

function inferCodexUpstreamApiType(apiUrl: string): 'responses' | 'chat_completions' {
  if (apiUrl.includes('/responses')) return 'responses'
  return 'chat_completions'
}

function normalizeBackendEndpointUrl(apiUrl: string, apiType: 'responses' | 'chat_completions'): string {
  const baseUrl = normalizeCodexBaseUrl(apiUrl)
  return apiType === 'responses' ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`
}

function resolveCodexBaseUrl(credentials: ApiCredentials): string | undefined {
  const baseUrl = credentials.baseUrl?.trim()
  if (!baseUrl) return undefined

  const normalized = normalizeCodexBaseUrl(baseUrl)
  return isDefaultOpenAIBaseUrl(normalized) ? undefined : normalized
}

export function normalizeCodexBaseUrl(input: string): string {
  let normalized = input.replace(/\s/g, '').replace(/\/+$/, '')

  if (!normalized) {
    throw new Error('Codex SDK requires a non-empty API base URL.')
  }

  const endpointSuffixes = ['/chat/completions', '/responses']
  for (const suffix of endpointSuffixes) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length)
      break
    }
  }

  if (normalized.endsWith('/chat')) {
    normalized = normalized.slice(0, -5)
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+$/.test(normalized)) {
    normalized = `${normalized}/v1`
  }

  return normalized.replace(/\/+$/, '')
}

function isDefaultOpenAIBaseUrl(baseUrl: string): boolean {
  return baseUrl === 'https://api.openai.com' || baseUrl === 'https://api.openai.com/v1'
}

function resolveCodexExecutableOverride(): Record<string, string> {
  const candidates = [
    path.join(process.cwd(), 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    path.join(process.resourcesPath || '', 'app.asar', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  ]
  const found = candidates.find((candidate) => candidate && existsSync(candidate))
  return found ? { codexPathOverride: found } : {}
}

function buildCodexConfigOverrides(
  sdkOptions: Record<string, any>,
  _appConfig: ReturnType<typeof getConfig>,
  routing: CodexClientRouting
): Record<string, any> {
  const config: Record<string, any> = {
    model_reasoning_effort: sdkOptions.maxThinkingTokens ? 'high' : 'medium',
    approval_policy: resolveApprovalPolicy(sdkOptions),
    sandbox_workspace_write: {
      network_access: true,
    },
    hide_agent_reasoning: false,
    show_raw_agent_reasoning: false,
    tools: {
      web_search: hasMcpServer(sdkOptions.mcpServers, 'web-search'),
    },
  }

  if (routing.disableWebsockets && routing.baseUrl) {
    config.model_provider = 'halo-router'
    config.model_providers = {
      'halo-router': {
        name: 'Halo OpenAI compatibility router',
        base_url: routing.baseUrl,
        wire_api: 'responses',
        requires_openai_auth: false,
        supports_websockets: false,
      },
    }
  }

  return config
}

function resolveSandboxMode(_sdkOptions: Record<string, any>): 'read-only' | 'workspace-write' | 'danger-full-access' {
  return 'danger-full-access'
}

function resolveApprovalPolicy(sdkOptions: Record<string, any>): 'never' | 'on-request' | 'on-failure' | 'untrusted' {
  if (sdkOptions.permissionMode === 'bypassPermissions' || sdkOptions.extraArgs?.['dangerously-skip-permissions'] === null) {
    return 'never'
  }
  return 'on-request'
}

function hasMcpServer(mcpServers: Record<string, any> | undefined, name: string): boolean {
  return !!mcpServers && Object.prototype.hasOwnProperty.call(mcpServers, name)
}
