/**
 * CC-compatible session wrapper around Codex SDK threads.
 */

import { randomUUID } from 'crypto'
import type { CodexModuleRuntime, CodexThreadEvent } from './types'
import { resolveCodexOptions, type CodexResolvedOptions } from './options'
import { CodexEventNormalizer } from './event-normalizer'

interface PendingTurn {
  input: any
  abortController: AbortController
}

export class CodexSessionAdapter {
  private readonly codex: any
  private readonly normalizer: CodexEventNormalizer
  private readonly sessionId: string
  private thread: any
  private closed = false
  private activeTurn: PendingTurn | null = null
  private queue: PendingTurn[] = []
  private waitingResolvers: Array<() => void> = []

  /**
   * Implements the Claude Code session protocol's transport-readiness probe.
   *
   * CC SDK exposes `session.query.transport.isReady()` as its liveness signal,
   * and Halo's session-manager (`isSessionTransportReady`) treats that shape as
   * the canonical contract for "is this session safe to reuse / not yet dead".
   *
   * Codex has no long-running transport (each turn spawns a fresh `codex exec`
   * subprocess), so we surface a CC-shaped probe whose readiness is bound to
   * this adapter's lifecycle: ready iff the adapter has not been closed.
   *
   * Without this shim, session-manager's polling sweep would see `transport`
   * as undefined, declare the session dead, and tear it down between turns —
   * which manifested as Codex losing all conversation history.
   */
  readonly query: { transport: { isReady: () => boolean; ready: boolean } }

  private constructor(
    runtime: CodexModuleRuntime,
    private readonly options: CodexResolvedOptions,
    resumeSessionId?: string
  ) {
    this.sessionId = resumeSessionId || randomUUID()
    this.codex = new runtime.Codex(options.clientOptions)
    this.thread = resumeSessionId
      ? this.codex.resumeThread(resumeSessionId, options.threadOptions)
      : this.codex.startThread(options.threadOptions)
    this.normalizer = new CodexEventNormalizer({
      sessionId: this.sessionId,
      model: options.model,
      systemPrompt: options.systemPrompt,
      mcpServers: options.mcpServers,
    })

    // CC-shaped readiness probe — see field declaration above.
    const isReady = (): boolean => !this.closed
    this.query = {
      transport: {
        isReady,
        get ready() { return isReady() },
      },
    }
  }

  static async create(runtime: CodexModuleRuntime, sdkOptions: Record<string, any>): Promise<CodexSessionAdapter> {
    const options = await resolveCodexOptions(sdkOptions)
    return new CodexSessionAdapter(runtime, options, sdkOptions.resume)
  }

  send(message: any): void {
    if (this.closed) {
      throw new Error('Codex session is closed')
    }
    const turn: PendingTurn = {
      input: normalizeMessageInput(message, this.options.systemPrompt),
      abortController: new AbortController(),
    }
    this.queue.push(turn)
    this.wakeStreamWaiters()
  }

  async *stream(): AsyncIterable<any> {
    while (!this.closed) {
      const turn = await this.nextTurn()
      if (!turn) return
      this.activeTurn = turn

      let events: AsyncGenerator<CodexThreadEvent> | null = null
      let eventCount = 0
      let runStartedAt = Date.now()
      const threadIdBefore = (this.thread && (this.thread.id ?? this.thread._id)) ?? null
      // Reset normalizer's per-turn state. The same normalizer instance drives
      // every turn of the session (so init/tool-names persist), but the
      // terminal flag, message envelope, and block indices must be cleared or
      // a stale `terminal=true` from the previous turn would short-circuit the
      // event loop on the next turn — which manifested as the second user
      // message returning empty after a single `thread.started` event.
      this.normalizer.resetTurn()
      try {
        yield this.normalizer.createInit(this.sessionId)
        console.log(
          `[Codex][${this.sessionId}] runStreamed start: threadId=${threadIdBefore} ` +
          `inputType=${typeof turn.input} inputPreview=${previewInput(turn.input)}`
        )
        const streamed = await this.thread.runStreamed(turn.input, {
          signal: turn.abortController.signal,
        })
        runStartedAt = Date.now()
        events = streamed.events as AsyncGenerator<CodexThreadEvent>

        // Drain Codex events. Once the normalizer reports terminal (turn.completed
        // / turn.failed / error), stop consuming and explicitly release the
        // generator. Otherwise the SDK's stdin-pipe iterator can hold the turn
        // open until its idle timeout fires, which surfaces as ~10s of "ghost"
        // delay between the final assistant message and the UI completion event.
        for await (const event of events) {
          eventCount++
          if (eventCount <= 3 || event.type === 'turn.completed' || event.type === 'turn.failed' || event.type === 'error') {
            console.log(`[CodexRaw][${this.sessionId}] #${eventCount} ${event.type}: ${truncate(JSON.stringify(event), 240)}`)
          }
          for (const message of this.normalizer.normalize(event)) {
            yield message
          }
          if (this.normalizer.isTerminal()) break
        }

        const elapsed = Date.now() - runStartedAt
        console.log(
          `[Codex][${this.sessionId}] runStreamed drained: events=${eventCount} ` +
          `terminal=${this.normalizer.isTerminal()} threadIdAfter=${(this.thread.id ?? this.thread._id) ?? null} elapsed=${elapsed}ms`
        )

        // Safety net: codex CLI sometimes exits cleanly with zero JSONL events
        // (e.g. corrupted thread state from a prior aborted turn, or a CLI
        // startup failure that is not surfaced as an exception). Without this
        // branch the generator returns silently, the consumer reports "No
        // content from stream", and the user has no signal about what failed.
        if (!this.normalizer.isTerminal()) {
          const reason = eventCount === 0
            ? 'Codex CLI exited without producing any events. The thread state may be corrupted from a previous interruption — restarting the conversation should recover.'
            : `Codex CLI ended after ${eventCount} events without a turn.completed signal. The model run was incomplete.`
          console.warn(`[Codex][${this.sessionId}] Forcing error result: ${reason}`)
          // Mark the session unhealthy so session-manager rebuilds it on the
          // next user message. Without close(), the broken thread would keep
          // being reused.
          this.closed = true
          yield this.normalizer.createResult(true, reason)
        }
      } catch (error) {
        const elapsed = Date.now() - runStartedAt
        console.error(
          `[Codex][${this.sessionId}] runStreamed threw after ${elapsed}ms (events=${eventCount}):`,
          error
        )
        if (turn.abortController.signal.aborted) {
          yield this.normalizer.createResult(true, 'Stopped by user.')
        } else {
          // Any thrown error from the codex CLI invalidates the underlying
          // thread state. Force a rebuild on the next turn rather than risk
          // resuming a corrupted thread.
          this.closed = true
          const message = error instanceof Error ? error.message : String(error)
          yield this.normalizer.createResult(true, message)
        }
      } finally {
        // Explicitly release the underlying Codex iterator. The Codex CLI keeps
        // its stdout JSONL pipe open until exit; without an explicit return()
        // here, GC is the only thing that closes it, and the SDK's idle wait
        // delays the next turn.
        if (events) {
          await events.return?.(undefined as unknown as CodexThreadEvent).catch(() => undefined)
        }
        this.activeTurn = null
      }

      return
    }
  }

  close(): void {
    this.closed = true
    this.activeTurn?.abortController.abort()
    for (const turn of this.queue) turn.abortController.abort()
    this.queue = []
    this.wakeStreamWaiters()
  }

  async interrupt(): Promise<void> {
    this.activeTurn?.abortController.abort()
    this.queue[0]?.abortController.abort()
  }

  async setModel(model: string | undefined): Promise<void> {
    if (model) this.options.threadOptions.model = model
  }

  async setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void> {
    this.options.clientOptions.config = {
      ...this.options.clientOptions.config,
      model_reasoning_effort: maxThinkingTokens ? 'high' : 'medium',
    }
  }

  async setPermissionMode(mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'): Promise<void> {
    this.options.threadOptions.approvalPolicy = mode === 'bypassPermissions' ? 'never' : 'on-request'
  }

  private async nextTurn(): Promise<PendingTurn | null> {
    while (!this.closed) {
      const turn = this.queue.shift()
      if (turn) return turn
      await new Promise<void>((resolve) => this.waitingResolvers.push(resolve))
    }
    return null
  }

  private wakeStreamWaiters(): void {
    const resolvers = this.waitingResolvers.splice(0)
    for (const resolve of resolvers) resolve()
  }
}

function normalizeMessageInput(message: any, systemPrompt: string | undefined): string | Array<{ type: string; path?: string; text?: string }> {
  const prefix = systemPrompt ? `${systemPrompt}\n\n` : ''
  if (typeof message === 'string') return prefix + message

  const content = message?.message?.content
  if (Array.isArray(content)) {
    const output: Array<{ type: string; path?: string; text?: string }> = []
    const textParts: string[] = []
    for (const block of content) {
      if (block?.type === 'text') textParts.push(block.text || '')
      if (block?.type === 'image' && block.source?.type === 'base64') {
        const path = block.source.path || block.path
        if (path) output.push({ type: 'local_image', path })
      }
    }
    output.unshift({ type: 'text', text: prefix + textParts.join('\n\n') })
    return output
  }

  return prefix + JSON.stringify(message)
}

function previewInput(input: unknown): string {
  if (typeof input === 'string') return truncate(input, 120)
  try {
    return truncate(JSON.stringify(input), 120)
  } catch {
    return '[unserializable]'
  }
}

function truncate(text: string, max: number): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…(+${text.length - max})` : text
}
