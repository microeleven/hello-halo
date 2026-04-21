/**
 * Analytics Provider - Self-Hosted Telemetry
 *
 * Privacy-safe batched reporting to an internal telemetry endpoint.
 *
 * Protocol:
 *   POST {endpoint}/v1/events
 *   Authorization: Bearer {apiKey}
 *   Content-Type: application/json
 *   body: { sent_at, context, events[] }
 *
 * Batching strategy:
 *   - Events accumulate in an in-memory queue. All events (IPC-received from
 *     the renderer and main-native ones like `app.installed`, `app.run.*`,
 *     `installed_apps.snapshot`) funnel through the same `track()` entry, so
 *     this queue is the single aggregation point.
 *   - Flushed when any of:
 *       (a) queue length reaches MAX_QUEUE_SIZE (100) — hard cap, flushed
 *           immediately and the debounce timer is cancelled.
 *       (b) DEBOUNCE_FLUSH_MS (5s) of quiet since the last track() — the
 *           timer is reset on every event, so a burst ships together once
 *           the burst ends.
 *       (c) destroy() is called (shutdown) — cancels timer, drains best-effort.
 *   - Per flush: payload is reset before the HTTP call. On failure the
 *     already-shipped batch is NOT re-queued — we prefer losing a batch
 *     over duplicating or holding memory indefinitely.
 *
 * Privacy:
 *   - `track()` applies a per-event whitelist of property keys before
 *     enqueueing; any property not on the whitelist is dropped at the
 *     source, so it never leaves the main process even in memory.
 *   - A fallback blocklist guards against accidental additions to event
 *     types that omit an explicit whitelist.
 *
 * Disabled when endpoint or apiKey is empty. When disabled the provider
 * never starts its timer and `track()` is a no-op — safe to use in
 * open-source builds where no credentials are injected.
 */

import { BaseProvider, BaseProviderOptions } from './base'
import type { AnalyticsEvent, UserContext } from '../types'

/** Hard cap on in-memory queue length. Reaching this triggers an immediate flush. */
const MAX_QUEUE_SIZE = 100

/**
 * Debounce window since the last `track()` call before auto-flushing.
 *
 * Resetting the timer on every event means a burst (e.g. startup snapshot,
 * app install + multiple run events) ships as one batch once the burst
 * settles, instead of trickling out on a fixed cadence.
 */
const DEBOUNCE_FLUSH_MS = 5_000

/** Budget for the final flush during destroy(). */
const SHUTDOWN_FLUSH_TIMEOUT_MS = 3_000

/**
 * Property keys that must NEVER be forwarded to the telemetry backend.
 * Enforced on every event regardless of whitelist outcome.
 */
const BLOCKED_KEYS = new Set<string>([
  'content',
  'body',
  'text',
  'message',
  'messages',
  'prompt',
  'systemPrompt',
  'system_prompt',
  'path',
  'filePath',
  'file_path',
  'fullPath',
  'absolutePath',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'secret',
  'password',
])

/**
 * Per-event-name property whitelist.
 *
 * When a name is present in this map, only the listed keys survive.
 * When absent, the event keeps the caller-provided keys minus anything in
 * BLOCKED_KEYS (used for renderer-driven generic events where the key set
 * is harder to enumerate, e.g. `action.*`).
 */
const EVENT_WHITELIST: Record<string, readonly string[]> = {
  // Session / navigation
  'session.start':  ['view', 'platform', 'startedAt'],
  'session.end':    ['view', 'platform', 'durationMs'],
  'page.view':      ['view', 'from'],

  // Chat message counts (identifiers only — never content)
  'message.sent':     ['source', 'appId', 'specId', 'channel', 'instanceId', 'conversationId', 'spaceId', 'hasImages'],
  'message.received': ['source', 'appId', 'specId', 'channel', 'instanceId', 'conversationId', 'spaceId'],

  // Digital human lifecycle
  'app.installed':      ['appId', 'specId', 'version', 'type'],
  'app.uninstalled':    ['appId', 'specId', 'type'],
  'app.run.started':    ['appId', 'specId', 'runId', 'trigger'],
  'app.run.completed':  ['appId', 'specId', 'runId', 'trigger', 'status', 'durationMs'],
  'app.run.failed':     ['appId', 'specId', 'runId', 'trigger', 'status', 'durationMs', 'errorCode'],
  'app.run.replay':     ['appId', 'specId', 'runId', 'trigger', 'status', 'durationMs', 'errorCode', 'startedAt', 'finishedAt'],

  // Startup snapshot
  'installed_apps.snapshot': ['apps', 'count'],
}

export interface TelemetryProviderConfig extends BaseProviderOptions {
  endpoint: string
  apiKey: string
}

interface QueuedEvent extends AnalyticsEvent {
  timestamp: number
}

interface TelemetryPayload {
  sent_at: number
  context: UserContext
  events: QueuedEvent[]
}

export class TelemetryProvider extends BaseProvider {
  readonly name = 'Telemetry'

  private endpoint: string
  private apiKey: string
  private queue: QueuedEvent[] = []
  /** Debounce timer — reset on every `track()` call, cleared on flush/destroy. */
  private flushTimer: NodeJS.Timeout | null = null
  /** Captured per track() call; used when a scheduled flush fires without a fresh track. */
  private lastContext: UserContext | null = null

  constructor(config: TelemetryProviderConfig) {
    super(config)
    // Normalize trailing slashes so `${endpoint}/v1/events` is always well-formed.
    this.endpoint = (config.endpoint || '').replace(/\/+$/, '')
    this.apiKey = config.apiKey || ''
  }

  async init(userId: string): Promise<void> {
    await super.init(userId)

    if (!this.endpoint || !this.apiKey) {
      this._initialized = false
      this.log('disabled (no endpoint or apiKey)')
      return
    }

    // No background timer is started here. Flushes are scheduled on-demand
    // from `track()` via a debounce window, and cleared on flush/destroy —
    // when the queue is idle, no timers exist at all.
    this.log(`ready (endpoint=${this.endpoint})`)
  }

  async track(event: AnalyticsEvent, context: UserContext): Promise<void> {
    if (!this._initialized) return

    const sanitized = this.sanitizeProperties(event.name, event.properties)

    const queued: QueuedEvent = {
      name: event.name,
      properties: sanitized,
      timestamp: event.timestamp ?? Date.now(),
    }

    this.lastContext = context
    this.queue.push(queued)

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Size-triggered flush — drain the queue immediately without blocking
      // the caller on the network round-trip. Cancel any pending debounce
      // since it would otherwise fire against an empty queue.
      this.cancelDebouncedFlush()
      void this.flushNow()
      return
    }

    // Debounce — each new event pushes the flush further out, so a burst
    // ships together once the burst ends.
    this.scheduleDebouncedFlush()
  }

  /**
   * (Re)arm the debounce timer. Safe to call repeatedly — each call clears
   * the previous timer so the wait window always counts from the latest
   * `track()`.
   */
  private scheduleDebouncedFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      // Fire-and-forget — errors are swallowed inside flushNow.
      void this.flushNow()
    }, DEBOUNCE_FLUSH_MS)
    // Don't keep the event loop alive just for the telemetry timer.
    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref()
    }
  }

  /** Clear any pending debounce. Idempotent. */
  private cancelDebouncedFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  /**
   * Immediately drain the queue to the endpoint.
   *
   * Safe to call while another flush is in flight — we snapshot the queue
   * synchronously before the await, so concurrent callers each ship a
   * distinct batch and never double-send the same events.
   */
  private async flushNow(): Promise<void> {
    if (!this._initialized) return
    if (this.queue.length === 0) return
    if (!this.lastContext) return

    const batch = this.queue
    this.queue = []
    const context = this.lastContext

    const payload: TelemetryPayload = {
      sent_at: Date.now(),
      context,
      events: batch,
    }

    await this.safeTrack(async () => {
      const response = await this.fetchWithRetry(`${this.endpoint}/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        this.log(`flushed ${batch.length} event(s)`)
      } else {
        const errorText = await response.text().catch(() => '')
        this.log(`flush failed (${response.status}): ${errorText.slice(0, 200)}`)
      }
    })
  }

  /**
   * Stop the flush timer and drain the queue best-effort.
   *
   * Called from the shutdown path. Bounded by SHUTDOWN_FLUSH_TIMEOUT_MS so
   * the process doesn't hang on an unreachable endpoint.
   */
  async destroy(): Promise<void> {
    this.cancelDebouncedFlush()

    if (!this._initialized || this.queue.length === 0) return

    await Promise.race([
      this.flushNow(),
      new Promise<void>(resolve => setTimeout(resolve, SHUTDOWN_FLUSH_TIMEOUT_MS)),
    ])
  }

  /**
   * Apply the whitelist + blocklist to caller-provided properties.
   *
   * - If an event whitelist exists for this event name, only whitelisted
   *   keys are kept.
   * - Otherwise, every key not in BLOCKED_KEYS is kept.
   * - Keys in BLOCKED_KEYS are always dropped, even if whitelisted — the
   *   blocklist wins in case of accidental overlap.
   */
  private sanitizeProperties(
    eventName: string,
    props: Record<string, unknown> | undefined
  ): Record<string, unknown> | undefined {
    if (!props) return undefined

    const whitelist = EVENT_WHITELIST[eventName]
    const out: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(props)) {
      if (BLOCKED_KEYS.has(key)) continue
      if (whitelist && !whitelist.includes(key)) continue
      if (value === undefined) continue
      out[key] = value
    }

    return Object.keys(out).length > 0 ? out : undefined
  }

  /** Expose queue length for tests. */
  get queueLength(): number {
    return this.queue.length
  }
}

/**
 * Create a TelemetryProvider instance. Returns a provider whose
 * `initialized` will flip to false inside `init()` when credentials are
 * empty — callers can use either `provider.initialized` after init or just
 * let `track()` be a no-op.
 */
export function createTelemetryProvider(endpoint: string, apiKey: string): TelemetryProvider {
  return new TelemetryProvider({
    endpoint,
    apiKey,
    debug: process.env.NODE_ENV === 'development',
  })
}
