/**
 * Auth Provider Loader
 *
 * Dynamically loads authentication providers based on product.json configuration.
 *
 * Design Principles:
 * - Configuration-driven provider loading
 * - Graceful fallback when providers are unavailable
 * - Type-safe provider interface enforcement
 */

import { join, dirname } from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'
import { app } from 'electron'
import type { AISourceProvider, OAuthAISourceProvider } from '../../../shared/interfaces'
import { type AISourceType, type LocalizedText } from '../../../shared/types'

// ============================================================================
// Types
// ============================================================================

/**
 * Provider configuration from product.json
 */
export interface AuthProviderConfig {
  /** Provider type identifier (e.g., 'oauth', 'custom') */
  type: AISourceType
  /** Display name for UI (supports i18n: string or { "en": "...", "zh-CN": "..." }) */
  displayName: LocalizedText
  /** Description text for UI (supports i18n: string or { "en": "...", "zh-CN": "..." }) */
  description: LocalizedText
  /** Lucide icon name */
  icon: string
  /** Icon background color (hex color) */
  iconBgColor: string
  /** Whether this is the recommended option */
  recommended: boolean
  /** Path to provider module (relative to product.json) */
  path?: string
  /** Whether this is a built-in provider */
  builtin?: boolean
  /** Whether this provider is enabled */
  enabled: boolean
}

/**
 * Update configuration for auto-updater
 */
export interface UpdateConfig {
  /** Provider type: 'github' for GitHub Releases, 'generic' for custom server */
  provider: 'github' | 'generic'
  /** URL for generic provider (empty string = disabled) */
  url?: string
  /** GitHub repository owner (for github provider) */
  owner?: string
  /** GitHub repository name (for github provider) */
  repo?: string
}

/**
 * Browser network access policy (enterprise feature).
 *
 * Controls which domains the embedded browser is allowed to navigate to.
 * When not configured, the browser is unrestricted (default for open-source).
 *
 * - "allowlist": only domains matching the patterns are permitted.
 * - "blocklist": all domains except those matching the patterns are permitted.
 * - "unrestricted": no restrictions (explicit opt-out, same as omitting the field).
 */
export interface BrowserPolicy {
  /** Policy mode */
  mode: 'allowlist' | 'blocklist' | 'unrestricted'
  /** Domain patterns for allowlist mode (e.g. "*.weoa.com", "example.com") */
  allowlist?: string[]
  /** Domain patterns for blocklist mode */
  blocklist?: string[]
  /** Default homepage URL for new browser tabs (defaults to about:blank when policy is active) */
  homepage?: string
}

/**
 * Per-registry override entry in product.json.
 *
 * Allows enterprise/custom builds to override specific built-in registry
 * properties without touching source code. Only declared fields are applied;
 * omitted fields retain their built-in defaults.
 *
 * - `url`     — replace the registry endpoint (e.g. point to an internal mirror)
 * - `name`    — replace the display name shown in the Store UI
 * - `enabled` — force-enable or force-disable the registry on every startup;
 *               overrides the user's manual toggle in Settings
 */
export interface RegistryOverride {
  url?: string
  name?: string
  enabled?: boolean
}

/**
 * Enterprise service defaults — pre-populated configuration for internal services.
 *
 * Each key maps to a service's config type with optional fields.
 * At runtime, these defaults are merged under user config (user values take precedence).
 * Open-source builds omit this entirely; enterprise builds set values in product.json.
 */
export interface ServiceDefaults {
  /** Default email channel configuration (partial — user config wins) */
  email?: Partial<import('../../../shared/types/notification-channels').EmailChannelConfig>
}

// ============================================
// IM Channels product defaults
// ============================================

/**
 * Default permission control settings for new IM channel instances.
 *
 * Injected via product.json at build time. Only affects the INITIAL state
 * when a user creates a new IM channel instance — users can override per-instance.
 *
 * Enterprise builds typically set `defaultEnabled: true` with a restrictive guest policy.
 * Open-source/personal builds omit this entirely (defaults to no restrictions).
 */
export interface ImChannelsPermissionDefaults {
  /** Whether Permission Control toggle is ON by default for new instances */
  defaultEnabled?: boolean
  /** Whether Guest Access toggle is ON by default (within permission control) */
  defaultGuestAccess?: boolean
  /** Default guest policy pre-populated for new instances */
  defaultGuestPolicy?: {
    allowedTools?: string[]
  }
}

/**
 * IM Channels section of product.json.
 */
export interface ImChannelsProductConfig {
  /** Default permission settings for new IM channel instances */
  permissionControl?: ImChannelsPermissionDefaults
}

// ============================================
// Product Configuration
// ============================================

/**
 * Product configuration from product.json
 */
export interface ProductConfig {
  name: string
  version: string
  /**
   * Data folder name for per-variant isolation (e.g. 'halo', 'halo-enterprise').
   * Controls both the Halo config directory (~/.{dataFolderName}/) and
   * Electron userData directory. Defaults to 'halo' when omitted.
   */
  dataFolderName?: string
  authProviders: AuthProviderConfig[]
  /** Update configuration (optional, defaults to GitHub if not specified) */
  updateConfig?: UpdateConfig
  /** Browser network access policy (optional, unrestricted when omitted) */
  browserPolicy?: BrowserPolicy
  /**
   * Enterprise service defaults (optional).
   * Pre-populates service configurations so internal users don't need manual setup.
   * Open-source builds omit this field entirely.
   */
  serviceDefaults?: ServiceDefaults
  /**
   * Built-in registry overrides (optional, enterprise/custom builds only).
   *
   * Keys are built-in registry IDs ('official', 'mcp-official', 'smithery',
   * 'claude-skills'). Each entry is merged on top of the built-in defaults
   * during `ensureBuiltinRegistries()` on every startup, making the values
   * immutable from the user's perspective (same semantics as `url`/`name`).
   *
   * Example (product.enterprise.json):
   * ```json
   * "registryOverrides": {
   *   "official":      { "url": "http://10.x.x.x:18081", "name": "Enterprise Registry" },
   *   "mcp-official":  { "enabled": false },
   *   "smithery":      { "enabled": false },
   *   "claude-skills": { "enabled": false }
   * }
   * ```
   */
  registryOverrides?: Record<string, RegistryOverride>
  /**
   * IM channel defaults (optional, enterprise/custom builds only).
   *
   * Controls default permission settings for new IM channel instances.
   * Open-source builds omit this (no restrictions by default).
   */
  imChannels?: ImChannelsProductConfig
}

/**
 * Loaded provider with its configuration
 */
export interface LoadedProvider {
  config: AuthProviderConfig
  provider: AISourceProvider | null
  loadError?: string
}

// ============================================================================
// Product Configuration Loading
// ============================================================================

let productConfig: ProductConfig | null = null
let productConfigPath: string | null = null

/**
 * Get the path to product.json
 */
function getProductConfigPath(): string {
  if (productConfigPath) return productConfigPath

  // In development, product.json is in project root
  // In production, it's inside app.asar
  const isDev = !app.isPackaged

  if (isDev) {
    // Development: project root (app.getAppPath() returns project root in dev)
    productConfigPath = join(app.getAppPath(), 'product.json')
  } else {
    // Production: inside app.asar (app.getAppPath() returns app.asar path)
    // Electron automatically handles app.asar paths
    productConfigPath = join(app.getAppPath(), 'product.json')
  }

  return productConfigPath
}

/**
 * Load product.json configuration
 */
export function loadProductConfig(): ProductConfig {
  if (productConfig) return productConfig

  const configPath = getProductConfigPath()

  try {
    if (existsSync(configPath)) {
      // Use require for synchronous loading (config is needed at startup)
      delete require.cache[require.resolve(configPath)]
      productConfig = require(configPath) as ProductConfig
      console.log('[AuthLoader] Loaded product.json from:', configPath)
      console.log('[AuthLoader] Auth providers configured:', productConfig.authProviders.map(p => p.type).join(', '))
    } else {
      console.log('[AuthLoader] product.json not found, using defaults')
      productConfig = getDefaultProductConfig()
    }
  } catch (error) {
    console.error('[AuthLoader] Failed to load product.json:', error)
    productConfig = getDefaultProductConfig()
  }

  return productConfig
}

/** Default data folder name when product.json omits dataFolderName */
export const DEFAULT_DATA_FOLDER_NAME = 'halo'

/**
 * Get the data folder name from product.json configuration.
 * Returns the configured dataFolderName or 'halo' as default.
 * Safe to call at any point after Electron app module is available.
 */
export function getDataFolderName(): string {
  return loadProductConfig().dataFolderName || DEFAULT_DATA_FOLDER_NAME
}

/**
 * Get enterprise service defaults from product.json.
 * Returns undefined when no defaults are configured (open-source builds).
 */
export function getServiceDefaults(): ServiceDefaults | undefined {
  return loadProductConfig().serviceDefaults
}

/**
 * Get IM channel permission defaults from product.json.
 * Returns undefined when no defaults are configured (open-source/personal builds).
 */
export function getImChannelsPermissionDefaults(): ImChannelsPermissionDefaults | undefined {
  return loadProductConfig().imChannels?.permissionControl
}

/**
 * Get default product configuration (open-source version)
 */
function getDefaultProductConfig(): ProductConfig {
  return {
    name: 'Halo',
    version: '1.0.0',
    authProviders: [
      {
        type: 'custom',
        displayName: { en: 'Custom API', 'zh-CN': '自定义 API' },
        description: { en: 'Claude / OpenAI compatible', 'zh-CN': '兼容 Claude / OpenAI' },
        icon: 'key',
        iconBgColor: '#da7756',
        recommended: true,
        builtin: true,
        enabled: true
      }
    ]
  }
}

// ============================================================================
// Provider Loading
// ============================================================================

/**
 * Resolve the absolute path to a provider module
 */
function resolveProviderPath(providerConfig: AuthProviderConfig): string | null {
  if (!providerConfig.path) return null

  const configPath = getProductConfigPath()
  const configDir = dirname(configPath)

  // Remove leading ./ from path if present
  const cleanPath = providerConfig.path.startsWith('./')
    ? providerConfig.path.slice(2)
    : providerConfig.path

  // Resolve path relative to product.json
  return join(configDir, cleanPath)
}

/**
 * Load a provider module dynamically using ESM import()
 */
async function loadProviderModuleAsync(providerPath: string): Promise<AISourceProvider | null> {
  try {
    // Check if the provider directory exists
    if (!existsSync(providerPath)) {
      console.log(`[AuthLoader] Provider path does not exist: ${providerPath}`)
      return null
    }

    // Use file URL to ensure Windows paths import correctly
    const importUrl = pathToFileURL(providerPath).href
    console.log(`[AuthLoader] Attempting to load provider from: ${importUrl}`)

    // Use dynamic import for ESM compatibility
    const providerModule = await import(importUrl)

    // Look for a getter function (e.g., getGoogleProvider)
    const getterNames = Object.keys(providerModule).filter(key =>
      key.startsWith('get') && key.endsWith('Provider') && typeof providerModule[key] === 'function'
    )

    if (getterNames.length > 0) {
      const provider = providerModule[getterNames[0]]()
      console.log(`[AuthLoader] Loaded provider from ${providerPath} using ${getterNames[0]}`)
      return provider
    }

    // Fallback: look for a class export
    const classNames = Object.keys(providerModule).filter(key =>
      key.endsWith('Provider') && typeof providerModule[key] === 'function'
    )

    if (classNames.length > 0) {
      const ProviderClass = providerModule[classNames[0]]
      const provider = new ProviderClass()
      console.log(`[AuthLoader] Loaded provider from ${providerPath} using class ${classNames[0]}`)
      return provider
    }

    console.warn(`[AuthLoader] No provider found in module: ${providerPath}`)
    return null
  } catch (error) {
    console.error(`[AuthLoader] Failed to load provider from ${providerPath}:`, error)
    return null
  }
}

/**
 * Load all enabled providers based on product.json configuration
 * This is the core configuration-driven loading mechanism
 */
export async function loadAuthProvidersAsync(): Promise<LoadedProvider[]> {
  const config = loadProductConfig()
  const loadedProviders: LoadedProvider[] = []

  for (const providerConfig of config.authProviders) {
    if (!providerConfig.enabled) {
      console.log(`[AuthLoader] Skipping disabled provider: ${providerConfig.type}`)
      continue
    }

    const loaded: LoadedProvider = {
      config: providerConfig,
      provider: null
    }

    if (providerConfig.builtin) {
      // Built-in provider (loaded separately by manager)
      console.log(`[AuthLoader] Built-in provider: ${providerConfig.type}`)
      loaded.provider = null // Will be loaded by manager
    } else if (providerConfig.path) {
      // External provider - load from path using dynamic import
      const providerPath = resolveProviderPath(providerConfig)
      if (providerPath) {
        loaded.provider = await loadProviderModuleAsync(providerPath)
        if (!loaded.provider) {
          loaded.loadError = `Failed to load from ${providerPath}`
        }
      }
    }

    loadedProviders.push(loaded)
  }

  return loadedProviders
}

/**
 * Synchronous version for backward compatibility (returns configs only)
 * @deprecated Use loadAuthProvidersAsync for full provider loading
 */
export function loadAuthProviders(): LoadedProvider[] {
  const config = loadProductConfig()
  return config.authProviders
    .filter(p => p.enabled)
    .map(providerConfig => ({
      config: providerConfig,
      provider: null,
      loadError: providerConfig.builtin ? undefined : 'Use loadAuthProvidersAsync for dynamic loading'
    }))
}

/**
 * Get enabled auth provider configurations for UI
 * This returns only the configs, not the loaded providers
 */
export function getEnabledAuthProviderConfigs(): AuthProviderConfig[] {
  const config = loadProductConfig()
  return config.authProviders.filter(p => p.enabled)
}

/**
 * Check if a specific provider type is available
 */
export function isProviderAvailable(type: AISourceType): boolean {
  const providers = loadAuthProviders()
  const provider = providers.find(p => p.config.type === type)
  return provider !== undefined && (provider.config.builtin || provider.provider !== null)
}

/**
 * Get a specific provider by type
 */
export function getProviderByType(type: AISourceType): LoadedProvider | null {
  const providers = loadAuthProviders()
  return providers.find(p => p.config.type === type) || null
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a provider supports OAuth
 */
export function isOAuthProvider(provider: AISourceProvider): provider is OAuthAISourceProvider {
  return 'startLogin' in provider && 'completeLogin' in provider
}
