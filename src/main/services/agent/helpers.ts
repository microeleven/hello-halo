/**
 * Agent Module - Helper Functions
 *
 * Utility functions shared across the agent module.
 * Includes working directory management, Electron path handling,
 * API credential resolution, and renderer communication.
 */

import { app } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, readlinkSync } from 'fs'
import { getConfig, getTempSpacePath } from '../config.service'
import { getSpace } from '../space.service'
import { getAISourceManager } from '../ai-sources'
import { getAppManager } from '../../apps/manager'
import type { McpSpec } from '../../apps/spec/schema'
import type { BackendRequestConfig } from '../../../shared/types/ai-sources'
import type { ApiCredentials } from './types'

// ============================================
// Headless Electron Path Management
// ============================================

// Cached path to headless Electron binary (outside .app bundle to prevent Dock icon on macOS)
let headlessElectronPath: string | null = null

/**
 * Get the path to the headless Electron binary.
 *
 * On macOS, when spawning Electron as a child process with ELECTRON_RUN_AS_NODE=1,
 * macOS still shows a Dock icon because it detects the .app bundle structure
 * before Electron checks the environment variable.
 *
 * Solution: Create a symlink to the Electron binary outside the .app bundle.
 * When the symlink is not inside a .app bundle, macOS doesn't register it
 * as a GUI application and no Dock icon appears.
 *
 * Why symlink instead of copy?
 * - The Electron binary depends on Electron Framework.framework via @rpath
 * - Copying just the binary breaks the framework loading
 * - Symlinks preserve the framework resolution because the real binary is still in .app
 *
 * This is a novel solution discovered while building Halo - most Electron apps
 * that spawn child processes suffer from this Dock icon flashing issue.
 */
export function getHeadlessElectronPath(): string {
  // Return cached path if already set up
  if (headlessElectronPath && existsSync(headlessElectronPath)) {
    return headlessElectronPath
  }

  const electronPath = process.execPath

  // On non-macOS platforms or if not inside .app bundle, use original path
  if (process.platform !== 'darwin' || !electronPath.includes('.app/')) {
    headlessElectronPath = electronPath
    console.log('[Agent] Using original Electron path (not macOS or not .app bundle):', headlessElectronPath)
    return headlessElectronPath
  }

  // macOS: Create symlink to Electron binary outside .app bundle to prevent Dock icon
  try {
    // Use app's userData path for the symlink (persistent across sessions)
    const userDataPath = app.getPath('userData')
    const headlessDir = join(userDataPath, 'headless-electron')
    const headlessSymlinkPath = join(headlessDir, 'electron-node')

    // Create directory if needed
    if (!existsSync(headlessDir)) {
      mkdirSync(headlessDir, { recursive: true })
    }

    // Check if symlink exists and points to correct target
    let needsSymlink = true

    if (existsSync(headlessSymlinkPath)) {
      try {
        const stat = lstatSync(headlessSymlinkPath)
        if (stat.isSymbolicLink()) {
          const currentTarget = readlinkSync(headlessSymlinkPath)
          if (currentTarget === electronPath) {
            needsSymlink = false
          } else {
            // Symlink exists but points to wrong target, remove it
            console.log('[Agent] Symlink target changed, recreating...')
            unlinkSync(headlessSymlinkPath)
          }
        } else {
          // Not a symlink (maybe old copy), remove it
          console.log('[Agent] Removing old non-symlink file...')
          unlinkSync(headlessSymlinkPath)
        }
      } catch {
        // If we can't read it, try to remove and recreate
        try {
          unlinkSync(headlessSymlinkPath)
        } catch { /* ignore */ }
      }
    }

    if (needsSymlink) {
      console.log('[Agent] Creating symlink for headless Electron mode...')
      console.log('[Agent] Target:', electronPath)
      console.log('[Agent] Symlink:', headlessSymlinkPath)

      symlinkSync(electronPath, headlessSymlinkPath)

      console.log('[Agent] Symlink created successfully')
    }

    headlessElectronPath = headlessSymlinkPath
    console.log('[Agent] Using headless Electron symlink:', headlessElectronPath)
    return headlessElectronPath
  } catch (error) {
    // Fallback to original path if symlink fails
    console.error('[Agent] Failed to set up headless Electron symlink, falling back to original:', error)
    headlessElectronPath = electronPath
    return headlessElectronPath
  }
}

// ============================================
// Working Directory Management
// ============================================

/**
 * Get working directory for a space
 */
export function getWorkingDir(spaceId: string): string {
  console.log(`[Agent] getWorkingDir called with spaceId: ${spaceId}`)

  if (spaceId === 'halo-temp') {
    const artifactsDir = join(getTempSpacePath(), 'artifacts')
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true })
    }
    console.log(`[Agent] [temp] Using temp space artifacts dir: ${artifactsDir}`)
    return artifactsDir
  }

  const space = getSpace(spaceId)
  if (space) {
    const dir = space.workingDir || space.path
    console.log(`[Agent] Space "${space.name}" (${space.id}): path=${space.path}, workingDir=${space.workingDir ?? '(none)'}, resolved=${dir}`)
    return dir
  }

  console.log(`[Agent] WARNING: Space not found, falling back to temp path`)
  return getTempSpacePath()
}

// ============================================
// API Credentials
// ============================================

/**
 * Get API credentials based on current aiSources configuration (v2)
 * This is the central place that determines which API to use
 * Now uses AISourceManager for unified access with v2 format
 */
export async function getApiCredentials(config: ReturnType<typeof getConfig>): Promise<ApiCredentials> {
  const manager = getAISourceManager()
  await manager.ensureInitialized()

  console.log('[AgentService] getApiCredentials called')

  // Get current source from manager (v2 format)
  const currentSource = manager.getCurrentSourceConfig()

  console.log('[AgentService] currentSource:', currentSource ? {
    id: currentSource.id,
    name: currentSource.name,
    provider: currentSource.provider,
    authType: currentSource.authType
  } : null)

  // Ensure token is valid for OAuth sources
  if (currentSource?.authType === 'oauth') {
    console.log('[AgentService] Checking OAuth token validity for:', currentSource.name)
    const tokenResult = await manager.ensureValidToken(currentSource.id)
    console.log('[AgentService] Token check result:', tokenResult.success)
    if (!tokenResult.success) {
      throw new Error('OAuth token expired or invalid. Please login again.')
    }
  }

  // Get backend config from manager
  console.log('[AgentService] Calling manager.getBackendConfig()')
  const backendConfig = manager.getBackendConfig()
  console.log('[AgentService] backendConfig:', backendConfig ? {
    url: backendConfig.url,
    model: backendConfig.model,
    hasKey: !!backendConfig.key
  } : null)

  if (!backendConfig) {
    throw new Error('No AI source configured. Please configure an API key or login.')
  }

  // Determine provider type based on current source
  let provider: 'anthropic' | 'openai' | 'oauth'

  if (currentSource?.authType === 'oauth') {
    provider = 'oauth'
    console.log(`[Agent] Using OAuth provider ${currentSource.provider} via AISourceManager`)
  } else if (currentSource?.provider === 'anthropic') {
    provider = 'anthropic'
    console.log(`[Agent] Using Anthropic API via AISourceManager`)
  } else {
    // OpenAI-compatible providers (deepseek, siliconflow, etc.)
    provider = 'openai'
    console.log(`[Agent] Using OpenAI-compatible API (${currentSource?.provider || 'unknown'}) via AISourceManager`)
  }

  const modelId = backendConfig.model || 'claude-opus-4-5-20251101'
  const modelOption = currentSource?.availableModels?.find(m => m.id === modelId)
  const displayModel = modelOption?.name || modelId

  return {
    baseUrl: backendConfig.url,
    apiKey: backendConfig.key,
    model: modelId,
    displayModel,
    provider,
    customHeaders: backendConfig.headers,
    apiType: backendConfig.apiType,
    forceStream: backendConfig.forceStream,
    filterContent: backendConfig.filterContent,
    adapterId: backendConfig.adapterId
  }
}

/**
 * Get API credentials for a specific AI source (used for per-app model overrides).
 * Falls back to getApiCredentials() if the specified source is not found or not configured.
 */
export async function getApiCredentialsForSource(
  config: ReturnType<typeof getConfig>,
  sourceId: string,
  modelId?: string
): Promise<ApiCredentials> {
  const manager = getAISourceManager()
  await manager.ensureInitialized()

  const aiSources = config.aiSources
  const source = aiSources?.version === 2
    ? aiSources.sources.find((s: any) => s.id === sourceId)
    : null

  if (!source) {
    console.warn(`[AgentService] getApiCredentialsForSource: source ${sourceId} not found, falling back to global`)
    return getApiCredentials(config)
  }

  // Ensure token is valid for OAuth sources
  if (source.authType === 'oauth') {
    const tokenResult = await manager.ensureValidToken(source.id)
    if (!tokenResult.success) {
      throw new Error('OAuth token expired or invalid. Please login again.')
    }
  }

  const backendConfig = manager.getBackendConfigForSource(sourceId, modelId)
  if (!backendConfig) {
    console.warn(`[AgentService] getApiCredentialsForSource: no backend config for source ${sourceId}, falling back to global`)
    return getApiCredentials(config)
  }

  // Determine provider type
  let provider: 'anthropic' | 'openai' | 'oauth'
  if (source.authType === 'oauth') {
    provider = 'oauth'
  } else if (source.provider === 'anthropic') {
    provider = 'anthropic'
  } else {
    provider = 'openai'
  }

  const effectiveModelId = backendConfig.model || source.model
  const modelOption = source.availableModels?.find((m: any) => m.id === effectiveModelId)
  const displayModel = modelOption?.name || effectiveModelId

  console.log(`[AgentService] Using per-app model override: source=${source.name}, model=${displayModel}`)

  return {
    baseUrl: backendConfig.url,
    apiKey: backendConfig.key,
    model: effectiveModelId,
    displayModel,
    provider,
    customHeaders: backendConfig.headers,
    apiType: backendConfig.apiType,
    forceStream: backendConfig.forceStream,
    filterContent: backendConfig.filterContent,
    adapterId: backendConfig.adapterId
  }
}

/**
 * Infer OpenAI wire API type from URL or environment
 */
export function inferOpenAIWireApi(apiUrl: string): 'responses' | 'chat_completions' {
  // 1. Check environment variable override
  const envApiType = process.env.HALO_OPENAI_API_TYPE || process.env.HALO_OPENAI_WIRE_API
  if (envApiType) {
    const v = envApiType.toLowerCase()
    if (v.includes('response')) return 'responses'
    if (v.includes('chat')) return 'chat_completions'
  }
  // 2. Infer from URL
  if (apiUrl) {
    if (apiUrl.includes('/chat/completions') || apiUrl.includes('/chat_completions')) return 'chat_completions'
    if (apiUrl.includes('/responses')) return 'responses'
  }
  // 3. Default to chat_completions (most common for third-party providers)
  return 'chat_completions'
}

// ============================================
// Credential → BackendConfig Conversion
// ============================================

/**
 * Convert ApiCredentials back to BackendRequestConfig.
 *
 * Centralizes the reverse mapping (ApiCredentials → BackendRequestConfig)
 * used by sdk-config.ts and mcp-manager.ts when encoding config for the
 * OpenAI compat router. Use `overrides` for computed fields like apiType.
 */
export function credentialsToBackendConfig(
  credentials: ApiCredentials,
  overrides?: Partial<BackendRequestConfig>
): BackendRequestConfig {
  return {
    url: credentials.baseUrl,
    key: credentials.apiKey,
    model: credentials.model,
    headers: credentials.customHeaders,
    apiType: credentials.apiType,
    forceStream: credentials.forceStream,
    filterContent: credentials.filterContent,
    adapterId: credentials.adapterId,
    ...overrides
  }
}

/**
 * Build MCP servers config from installed MCP apps in the database.
 * Reads effective MCP apps for the given space (global + space-scoped, with override)
 * and converts them to the SDK mcpServers format.
 */
export function getDbMcpServers(spaceId: string): Record<string, unknown> | null {
  const manager = getAppManager()
  if (!manager) return null

  const mcpApps = manager.listEffectiveMcpApps(spaceId)
  if (mcpApps.length === 0) return null

  const servers: Record<string, unknown> = {}
  for (const app of mcpApps) {
    if (app.status === 'paused') continue
    if (app.spec.type !== 'mcp') continue
    const mcpServer = (app.spec as McpSpec).mcp_server
    if (!mcpServer) continue // defensive: required by schema but guard against old data

    const serverConfig: Record<string, unknown> = {}

    // Map transport type
    if (mcpServer.transport === 'sse') {
      serverConfig.type = 'sse'
      serverConfig.url = mcpServer.command // For SSE, command holds URL
    } else if (mcpServer.transport === 'streamable-http') {
      serverConfig.type = 'http'
      serverConfig.url = mcpServer.command
    } else {
      // stdio (default)
      serverConfig.command = mcpServer.command
      if (mcpServer.args?.length) serverConfig.args = mcpServer.args
      if (mcpServer.cwd) serverConfig.cwd = mcpServer.cwd
    }
    // Merge static spec env with user-provided config values (e.g. API tokens).
    // userConfig keys map directly to env var names; user values override spec defaults.
    const mergedEnv: Record<string, string> = {
      ...(mcpServer.env ?? {}),
      ...Object.fromEntries(
        Object.entries(app.userConfig ?? {})
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)])
      )
    }
    if (Object.keys(mergedEnv).length > 0) {
      serverConfig.env = mergedEnv
    }
    if (mcpServer.headers && Object.keys(mcpServer.headers).length > 0) {
      serverConfig.headers = mcpServer.headers
    }

    servers[app.specId] = serverConfig
  }

  return Object.keys(servers).length > 0 ? servers : null
}

/**
 * Build MCP servers config for a specific set of MCP dependency declarations.
 *
 * Used by automation runtime (execute.ts) to inject only the MCPs that
 * an automation explicitly declares in its requires.mcps field.
 * This enforces least-privilege: automations only receive the tools they declare.
 *
 * @param requiredMcps - The requires.mcps array from the automation spec
 * @param spaceId - The space context (app.spaceId ?? fallback)
 * @returns SDK-compatible mcpServers config, keyed by specId
 */
export function getMcpServersForRequires(
  requiredMcps: Array<{ id: string; reason?: string; bundled?: boolean }> | undefined,
  spaceId: string
): Record<string, unknown> {
  if (!requiredMcps || requiredMcps.length === 0) return {}

  const manager = getAppManager()
  if (!manager) return {}

  // Get all effective MCP apps for this space (global + space-scoped)
  const allMcpApps = manager.listEffectiveMcpApps(spaceId)

  const result: Record<string, unknown> = {}

  for (const dep of requiredMcps) {
    const app = allMcpApps.find(
      (a) => a.specId === dep.id && a.status === 'active'
    )
    if (!app) {
      console.warn(
        `[Agent] Required MCP "${dep.id}" not found or not active (spaceId=${spaceId})`
      )
      continue
    }

    if (app.spec.type !== 'mcp') continue
    const mcpServer = (app.spec as McpSpec).mcp_server
    if (!mcpServer) continue // defensive: required by schema but guard against old data

    const serverConfig: Record<string, unknown> = {}

    // Map transport type — mirrors getDbMcpServers conversion logic
    if (mcpServer.transport === 'sse') {
      serverConfig.type = 'sse'
      serverConfig.url = mcpServer.command // For SSE, command holds URL
    } else if (mcpServer.transport === 'streamable-http') {
      serverConfig.type = 'http'
      serverConfig.url = mcpServer.command
    } else {
      // stdio (default)
      serverConfig.command = mcpServer.command
      if (mcpServer.args?.length) serverConfig.args = mcpServer.args
      if (mcpServer.cwd) serverConfig.cwd = mcpServer.cwd
    }
    // Merge static spec env with user-provided config values (e.g. API tokens).
    // userConfig keys map directly to env var names; user values override spec defaults.
    const mergedEnv: Record<string, string> = {
      ...(mcpServer.env ?? {}),
      ...Object.fromEntries(
        Object.entries(app.userConfig ?? {})
          .filter(([, v]) => v != null)
          .map(([k, v]) => [k, String(v)])
      )
    }
    if (Object.keys(mergedEnv).length > 0) {
      serverConfig.env = mergedEnv
    }
    if (mcpServer.headers && Object.keys(mcpServer.headers).length > 0) {
      serverConfig.headers = mcpServer.headers
    }

    result[app.specId] = serverConfig
  }

  return result
}
