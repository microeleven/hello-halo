/**
 * Claude OAuth Provider
 *
 * Implements OAuth PKCE flow for Claude.ai (Claude Pro/Max) authentication.
 *
 * Authentication Flow:
 * 1. Generate PKCE code_verifier + code_challenge (S256)
 * 2. Open BrowserWindow to claude.com/cai/oauth/authorize
 * 3. User logs in and authorizes → redirected to callback with code
 * 4. Exchange code for access_token + refresh_token
 * 5. Use Bearer token for API calls with required headers
 *
 * Mirrors the OAuth contract of the bundled @anthropic-ai/claude-code package
 * so requests are indistinguishable from a direct CLI invocation. Drift from
 * the bundled CLI's behavior risks server-side rejection (stale endpoints,
 * scope mismatch, missing beta gates) — keep the constants and the beta
 * builder below in sync with the official package on every dependency bump.
 *
 * Key Implementation Details:
 * - OAuth code may contain '#' separator → must split on '#' before exchange
 * - OAuth endpoints use platform.claude.com / claude.com (the legacy
 *   claude.ai / console.anthropic.com hosts still redirect today but are
 *   end-of-life — use the canonical hosts to survive sunset)
 * - anthropic-beta is computed per model (see buildBetaHeaders) to match the
 *   official getAllModelBetas() output for the firstParty + OAuth subscriber
 *   profile (the only profile hello-halo runs in)
 * - Must delete x-api-key header (use Authorization: Bearer instead)
 * - User-Agent is intentionally NOT set here — the Claude Code subprocess's
 *   bundled @anthropic-ai/sdk already injects the canonical
 *   `claude-cli/<version> (external, cli)` UA on every request. Re-injecting
 *   it from the provider produced a duplicate value at the undici layer
 *   (case-insensitive header merge: `User-Agent` + `user-agent`), which is
 *   itself a fingerprint that no real CLI ever emits.
 * - The /v1/messages URL does NOT include ?beta=true here; the bundled
 *   @anthropic-ai/sdk's BetaMessages.create() appends it itself, and the
 *   router forwards that query string through. Adding it again in the
 *   backend URL was redundant.
 *
 * Note: Halo uses the official Anthropic Claude SDK which handles tool naming
 * correctly, so we don't need to add/strip the mcp_ prefix ourselves.
 */

import { randomBytes, createHash, randomUUID } from 'crypto'
import { proxyFetch } from '../../proxy-fetch'
import type {
  OAuthAISourceProvider,
  ProviderResult
} from '../../../../shared/interfaces'
import type {
  AISourceType,
  AISourcesConfig,
  BackendRequestConfig,
  OAuthSourceConfig,
  OAuthStartResult,
  OAuthCompleteResult,
  AISourceUserInfo
} from '../../../../shared/types'

// ============================================================================
// Constants
// ============================================================================

/** OAuth client_id for the bundled Claude Code CLI (production). */
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

/** OAuth endpoints (canonical platform.claude.com / claude.com hosts). */
const CLAUDE_AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize'
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const CLAUDE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'

/**
 * OAuth scopes.
 *
 * Two sets, mirroring the official CLI:
 *
 * - `CLAUDE_AI_OAUTH_SCOPES` — the Claude.ai (Pro/Max) inference scopes used
 *   on token refresh; matches the official `y$8` array in claude-code 2.1.89.
 *   Refresh deliberately narrows from the authorize-time scope by dropping
 *   `org:create_api_key`.
 *
 * - `CLAUDE_AUTHORIZE_SCOPES` — the union sent at the initial authorize
 *   request; matches the official `H41` (ALL_OAUTH_SCOPES). Sending a
 *   smaller subset would cause feature gates (sessions, MCP, file upload)
 *   to fail server-side once Anthropic enforces scope checks.
 */
const CLAUDE_AI_OAUTH_SCOPES = [
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
]
const CLAUDE_AUTHORIZE_SCOPES = ['org:create_api_key', ...CLAUDE_AI_OAUTH_SCOPES].join(' ')

/** API endpoint */
const CLAUDE_API_BASE = 'https://api.anthropic.com'

/** Token refresh threshold — refresh 5 minutes before expiry */
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000

// ============================================================================
// Beta Header Builder
// ============================================================================

/**
 * Build the anthropic-beta header value for a given model.
 *
 * Mirrors the official @anthropic-ai/claude-code getAllModelBetas() function
 * for hello-halo's runtime profile:
 *   - provider = firstParty (always — we hit api.anthropic.com directly)
 *   - subscriber = true (always — OAuth-based login implies Pro/Max)
 *   - model family = claude-4+ / claude-mythos (no claude-3 in the model list)
 *
 * Under that profile the firstParty experimental betas (context-management,
 * prompt-caching-scope, interleaved-thinking) apply unconditionally, the
 * non-Haiku core CLI marker is gated on model family, and 1M context is
 * gated on the [1m] suffix.
 */
function buildBetaHeaders(model: string, is1mContext: boolean): string[] {
  const isHaiku = /haiku/i.test(model)

  const betas = [
    // OAuth subscriber — always required by the OAuth API gateway.
    'oauth-2025-04-20',
    // firstParty + non-claude-3: thinking-block preservation across turns.
    'context-management-2025-06-27',
    // firstParty: global-scope prompt cache (no-op without cache_control fields).
    'prompt-caching-scope-2026-01-05',
    // firstParty + non-claude-3: interleaved thinking. All hello-halo models
    // (haiku-4-5 / sonnet-4 / opus-4 / mythos) qualify.
    'interleaved-thinking-2025-05-14',
  ]

  // The official CLI tags non-Haiku traffic with the core CLI beta marker;
  // agentic queries also force-include it. Hello-halo is always agentic.
  if (!isHaiku) {
    betas.push('claude-code-20250219')
  }

  // 1M context window — only sent for the [1m] model variants.
  if (is1mContext) {
    betas.push('context-1m-2025-08-07')
  }

  return betas
}

// ============================================================================
// PKCE Implementation (replaces @openauthjs/openauth/pkce dependency)
// ============================================================================

/**
 * Generate PKCE code_verifier and code_challenge (S256).
 * Follows RFC 7636 specification.
 */
function generatePKCE(): { verifier: string; challenge: string } {
  // Generate 32 bytes of random data for code_verifier (43-128 chars in base64url)
  const verifier = randomBytes(32)
    .toString('base64url')

  // S256: SHA-256 hash of verifier, base64url-encoded
  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64url')

  return { verifier, challenge }
}

// ============================================================================
// Module-level State
// ============================================================================

interface PendingClaudeAuth {
  /** PKCE code_verifier — needed for token exchange */
  verifier: string
  /** The full authorize URL opened in the browser */
  authorizeUrl: string
  /** Timestamp when this auth request was created */
  createdAt: number
}

/** Current pending authorization (one at a time) */
let pendingAuth: PendingClaudeAuth | null = null

// ============================================================================
// Claude OAuth Provider Implementation
// ============================================================================

class ClaudeProvider implements OAuthAISourceProvider {
  readonly type: AISourceType = 'claude'
  readonly displayName = 'Claude'

  // ── Configuration ──────────────────────────────────────────────────────────

  isConfigured(config: AISourcesConfig): boolean {
    const c = config['claude'] as OAuthSourceConfig | undefined
    return !!(c?.loggedIn && c?.accessToken)
  }

  /**
   * Build the BackendRequestConfig for each outgoing API request.
   *
   * Header set:
   * - Authorization: Bearer <access_token> (NOT x-api-key)
   * - anthropic-beta is computed per-model by buildBetaHeaders(); see that
   *   helper for the exact set and the official CLI logic it mirrors. The
   *   router merges this with the SDK's anthropic-beta (deduplicated).
   * - x-client-request-id: a fresh UUID per request. The CC subprocess only
   *   injects this header when ANTHROPIC_BASE_URL points at api.anthropic.com,
   *   and Halo configures it to point at localhost — so the CC subprocess
   *   skips it and Halo is the sole emitter. No duplication.
   *
   * Headers intentionally NOT set:
   * - user-agent / User-Agent — owned by the bundled @anthropic-ai/sdk in the
   *   CC subprocess. Setting it here caused a `User-Agent: X, X` duplicate
   *   at the undici layer (case-insensitive merge of `User-Agent` and
   *   `user-agent`).
   *
   * URL:
   * - Plain `/v1/messages` — the bundled @anthropic-ai/sdk's
   *   BetaMessages.create() appends `?beta=true` itself, and the router
   *   forwards that query string. Hardcoding it here was redundant and
   *   risked forcing it onto non-beta paths if the route ever changed.
   */
  getBackendConfig(config: AISourcesConfig): BackendRequestConfig | null {
    const c = config['claude'] as OAuthSourceConfig | undefined
    if (!c?.loggedIn || !c?.accessToken) {
      return null
    }

    const rawModel = c.model || 'claude-sonnet-4-6'
    const is1mContext = /\[1m\]$/i.test(rawModel)
    // Strip [1m] suffix — it's a client-side marker for 1M context, not part of the API model ID
    const model = rawModel.replace(/\[1m\]$/i, '')

    const betas = buildBetaHeaders(model, is1mContext)

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${c.accessToken}`,
      'anthropic-beta': betas.join(','),
      'x-client-request-id': randomUUID()
    }

    const url = `${CLAUDE_API_BASE}/v1/messages`

    return {
      url,
      key: c.accessToken,
      model,
      headers,
      apiType: 'anthropic_passthrough'
    }
  }

  getCurrentModel(config: AISourcesConfig): string | null {
    const c = config['claude'] as OAuthSourceConfig | undefined
    return c?.model || null
  }

  // ── Available Models ────────────────────────────────────────────────────────

  async getAvailableModels(_config: AISourcesConfig): Promise<string[]> {
    // Claude OAuth uses the same models as regular Anthropic API
    // [1m] suffix indicates 1M context window variant (stripped before API call)
    return [
      'claude-mythos-preview',
      'claude-opus-4-7',
      'claude-opus-4-7[1m]',
      'claude-opus-4-6',
      'claude-opus-4-6[1m]',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-6',
      'claude-sonnet-4-6[1m]',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001'
    ]
  }

  getUserInfo(config: AISourcesConfig): AISourceUserInfo | null {
    const c = config['claude'] as OAuthSourceConfig | undefined
    return c?.user || null
  }

  // ── OAuth PKCE Flow ────────────────────────────────────────────────────────

  /**
   * Start the OAuth login flow.
   * Generates PKCE challenge and returns the authorize URL for the BrowserWindow.
   *
   * OAuth authorize params:
   * - URL: CLAUDE_AUTHORIZE_URL
   * - Params: code=true, client_id, response_type=code, redirect_uri, scope, code_challenge, code_challenge_method=S256
   * - state is set to verifier
   *
   * The redirectUri is returned so the renderer can hand it to the
   * `auth:open-login-window` IPC without duplicating the constant.
   */
  async startLogin(): Promise<ProviderResult<OAuthStartResult>> {
    try {
      console.log('[Claude] Starting OAuth PKCE flow')

      const pkce = generatePKCE()

      const url = new URL(CLAUDE_AUTHORIZE_URL)
      url.searchParams.set('code', 'true')
      url.searchParams.set('client_id', CLAUDE_CLIENT_ID)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('redirect_uri', CLAUDE_REDIRECT_URI)
      url.searchParams.set('scope', CLAUDE_AUTHORIZE_SCOPES)
      url.searchParams.set('code_challenge', pkce.challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('state', pkce.verifier)

      const authorizeUrl = url.toString()

      pendingAuth = {
        verifier: pkce.verifier,
        authorizeUrl,
        createdAt: Date.now()
      }

      console.log('[Claude] OAuth authorize URL generated')

      return {
        success: true,
        data: {
          loginUrl: authorizeUrl,
          state: pkce.verifier,
          redirectUri: CLAUDE_REDIRECT_URI
        }
      }
    } catch (error) {
      console.error('[Claude] Start login error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start login'
      }
    }
  }

  /**
   * Complete the OAuth login flow.
   * The state parameter contains the authorization code from the callback URL.
   *
   * Token exchange details:
   * - Code may contain '#' separator → split on '#', use splits[0] as code, splits[1] as state
   * - POST to CLAUDE_TOKEN_URL
   * - Body: { code, state, grant_type: "authorization_code", client_id, redirect_uri, code_verifier }
   */
  async completeLogin(state: string): Promise<ProviderResult<OAuthCompleteResult>> {
    if (!pendingAuth) {
      return { success: false, error: 'No pending authentication' }
    }

    try {
      console.log('[Claude] Exchanging authorization code for tokens')

      // The 'state' parameter here is actually the authorization code from the callback
      const code = state

      // Code may contain '#' separator — split and use first part as the actual code
      const splits = code.split('#')

      const response = await proxyFetch(CLAUDE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: splits[0],
          state: splits[1] || '',
          grant_type: 'authorization_code',
          client_id: CLAUDE_CLIENT_ID,
          redirect_uri: CLAUDE_REDIRECT_URI,
          code_verifier: pendingAuth.verifier
        })
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        console.error('[Claude] Token exchange failed:', response.status, errorText)
        pendingAuth = null
        return {
          success: false,
          error: `Token exchange failed: ${response.status}`
        }
      }

      const json = await response.json() as {
        access_token: string
        refresh_token: string
        expires_in: number
      }

      const accessToken = json.access_token
      const refreshToken = json.refresh_token
      const expiresAt = Date.now() + json.expires_in * 1000

      pendingAuth = null

      console.log('[Claude] Token exchange successful, expires in', json.expires_in, 'seconds')

      // Get available models
      const models = await this.getAvailableModels({} as AISourcesConfig)
      const modelNames: Record<string, string> = {
        'claude-mythos-preview': 'Claude Mythos (Preview)',
        'claude-opus-4-7': 'Claude Opus 4.7',
        'claude-opus-4-7[1m]': 'Claude Opus 4.7 (1M context)',
        'claude-opus-4-6': 'Claude Opus 4.6',
        'claude-opus-4-6[1m]': 'Claude Opus 4.6 (1M context)',
        'claude-opus-4-5-20251101': 'Claude Opus 4.5',
        'claude-sonnet-4-6': 'Claude Sonnet 4.6',
        'claude-sonnet-4-6[1m]': 'Claude Sonnet 4.6 (1M context)',
        'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
        'claude-haiku-4-5-20251001': 'Claude Haiku 4.5'
      }
      const defaultModel = 'claude-sonnet-4-6'

      const result: OAuthCompleteResult & {
        _tokenData: { accessToken: string; refreshToken: string; expiresAt: number; uid: string }
        _availableModels: string[]
        _modelNames: Record<string, string>
        _defaultModel: string
      } = {
        success: true,
        user: {
          name: 'Claude User',
          uid: ''
        },
        _tokenData: {
          accessToken,
          refreshToken,
          expiresAt,
          uid: ''
        },
        _availableModels: models,
        _modelNames: modelNames,
        _defaultModel: defaultModel
      }

      return { success: true, data: result }
    } catch (error) {
      console.error('[Claude] Complete login error:', error)
      pendingAuth = null
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete login'
      }
    }
  }

  async refreshToken(): Promise<ProviderResult<void>> {
    return { success: true }
  }

  async checkToken(): Promise<ProviderResult<{ valid: boolean; expiresIn?: number }>> {
    return { success: true, data: { valid: true } }
  }

  async logout(): Promise<ProviderResult<void>> {
    pendingAuth = null
    return { success: true }
  }

  // ── Token Management ────────────────────────────────────────────────────────

  /**
   * Check token validity for the manager's ensureValidToken() flow.
   */
  checkTokenWithConfig(config: AISourcesConfig): { valid: boolean; expiresIn?: number; needsRefresh: boolean } {
    const c = config['claude'] as OAuthSourceConfig | undefined
    if (!c?.accessToken) {
      return { valid: false, needsRefresh: false }
    }

    const now = Date.now()
    const expiresAt = c.tokenExpires || 0
    const needsRefresh = expiresAt <= now + TOKEN_REFRESH_THRESHOLD_MS

    return {
      valid: true,
      expiresIn: Math.max(0, expiresAt - now),
      needsRefresh
    }
  }

  /**
   * Refresh the OAuth token using refresh_token grant.
   *
   * Token refresh details:
   * - POST to CLAUDE_TOKEN_URL
   * - Body: { grant_type, refresh_token, client_id, scope }
   *   `scope` is required to match the official CLI; it narrows the
   *   refreshed token to the Claude.ai inference scopes (drops
   *   `org:create_api_key`).
   * - Response: { access_token, refresh_token, expires_in }
   */
  async refreshTokenWithConfig(config: AISourcesConfig): Promise<ProviderResult<{
    accessToken: string
    refreshToken: string
    expiresAt: number
  }>> {
    const c = config['claude'] as OAuthSourceConfig | undefined
    if (!c?.refreshToken) {
      return { success: false, error: 'No refresh token available' }
    }

    try {
      console.log('[Claude] Refreshing OAuth token')

      const response = await proxyFetch(CLAUDE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: c.refreshToken,
          client_id: CLAUDE_CLIENT_ID,
          // Refresh narrows the token from the authorize-time superset
          // (drops org:create_api_key) — matches the official CLI's default.
          scope: CLAUDE_AI_OAUTH_SCOPES.join(' ')
        })
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        console.error('[Claude] Token refresh failed:', response.status, errorText)
        return {
          success: false,
          error: `Token refresh failed: ${response.status}`
        }
      }

      const json = await response.json() as {
        access_token: string
        refresh_token: string
        expires_in: number
      }

      console.log('[Claude] Token refreshed, expires in', json.expires_in, 'seconds')

      return {
        success: true,
        data: {
          accessToken: json.access_token,
          refreshToken: json.refresh_token,
          expiresAt: Date.now() + json.expires_in * 1000
        }
      }
    } catch (error) {
      console.error('[Claude] Token refresh error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to refresh token'
      }
    }
  }

  async refreshConfig(config: AISourcesConfig): Promise<ProviderResult<Partial<AISourcesConfig>>> {
    const c = config['claude'] as OAuthSourceConfig | undefined
    if (!c?.accessToken) {
      return { success: false, error: 'Not logged in' }
    }

    try {
      const models = await this.getAvailableModels(config)
      const modelNames: Record<string, string> = {
        'claude-mythos-preview': 'Claude Mythos (Preview)',
        'claude-opus-4-7': 'Claude Opus 4.7',
        'claude-opus-4-7[1m]': 'Claude Opus 4.7 (1M context)',
        'claude-opus-4-6': 'Claude Opus 4.6',
        'claude-opus-4-6[1m]': 'Claude Opus 4.6 (1M context)',
        'claude-opus-4-5-20251101': 'Claude Opus 4.5',
        'claude-sonnet-4-6': 'Claude Sonnet 4.6',
        'claude-sonnet-4-6[1m]': 'Claude Sonnet 4.6 (1M context)',
        'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
        'claude-haiku-4-5-20251001': 'Claude Haiku 4.5'
      }
      return {
        success: true,
        data: {
          'claude': {
            ...c,
            availableModels: models,
            modelNames
          }
        }
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let providerInstance: ClaudeProvider | null = null

export function getClaudeProvider(): ClaudeProvider {
  if (!providerInstance) {
    providerInstance = new ClaudeProvider()
  }
  return providerInstance
}

export { ClaudeProvider }
