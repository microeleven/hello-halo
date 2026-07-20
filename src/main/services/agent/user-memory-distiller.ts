/**
 * User-memory distiller — the seed of Halo's personal memory.
 *
 * After an interactive chat turn, a headless model reads the exchange and
 * extracts durable facts/preferences/goals about the USER (not task state, not
 * the assistant) and appends them to the global user-memory.md, so future turns
 * "remember" the person. Runs fire-and-forget off the turn's hot path; any
 * failure only skips learning and never affects the turn.
 *
 * This is the first slice of a larger loop (build → use → update); reconciliation
 * and decay are deliberately left for later. It may graduate into its own module
 * as that loop grows.
 */

import { getAISourceManager } from '../ai-sources'
import { getMemoryService } from '../../platform/memory'
import { getSpace } from '../space.service'

const DISTILL_SYSTEM = `You maintain an AI assistant's long-term memory of a specific USER. Given one chat exchange, extract only DURABLE facts worth remembering across future conversations — things that make the assistant genuinely know this person better.

Extract (0-3 items, fewer is better):
- Stable facts: name, role/job, location, key people/relationships, tools or setup they use
- Preferences: how they like to work or be answered, likes/dislikes, style
- Goals, ongoing projects, or important decisions they have made

Do NOT extract:
- One-off task details, transient questions, or general knowledge
- Anything about the assistant itself
- Speculation — only what the user actually stated or clearly implied

Return STRICT JSON: {"atoms": ["The user ...", ...]}. Each atom is one concise, self-contained, third-person sentence. If nothing durable is present, return {"atoms": []}.`

interface DirectEndpoint {
  url: string
  headers: Record<string, string>
  wireFormat: 'anthropic' | 'openai'
  model: string
}

async function completeOnce(system: string, user: string): Promise<string | null> {
  const manager = getAISourceManager()
  await manager.ensureInitialized()
  const ep = manager.getDirectCallEndpoint() as DirectEndpoint | null
  if (!ep) return null

  const body =
    ep.wireFormat === 'anthropic'
      ? { model: ep.model, max_tokens: 512, system, messages: [{ role: 'user', content: user }] }
      : { model: ep.model, max_tokens: 512, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }

  const resp = await fetch(ep.url, { method: 'POST', headers: ep.headers, body: JSON.stringify(body) })
  if (!resp.ok) {
    console.warn(`[UserMemory] distill LLM returned ${resp.status}`)
    return null
  }
  const data = (await resp.json()) as {
    content?: Array<{ type?: string; text?: string }>
    choices?: Array<{ message?: { content?: string } }>
  }
  // Anthropic-format replies may lead with a `thinking` block; take the text one.
  return ep.wireFormat === 'anthropic'
    ? data?.content?.find(b => b.type === 'text')?.text ?? null
    : data?.choices?.[0]?.message?.content ?? null
}

function parseAtoms(raw: string): string[] {
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return []
    const obj = JSON.parse(m[0]) as { atoms?: unknown }
    const atoms = Array.isArray(obj.atoms) ? obj.atoms : []
    return atoms
      .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
      .map(a => a.trim())
      .slice(0, 3)
  } catch {
    return []
  }
}

/**
 * Learn durable facts about the user from one interactive-chat exchange and
 * append them to user-memory.md. Best-effort: never throws.
 */
export async function distillUserMemory(params: {
  spaceId: string
  userText: string
  assistantText: string
}): Promise<void> {
  try {
    const { spaceId, userText, assistantText } = params
    if (!userText.trim()) return
    const memory = getMemoryService()
    if (!memory) return

    const exchange =
      `USER said:\n${userText.trim().slice(0, 4000)}\n\n` +
      `ASSISTANT replied:\n${assistantText.trim().slice(0, 2000)}`

    const raw = await completeOnce(DISTILL_SYSTEM, exchange)
    if (!raw) return
    const atoms = parseAtoms(raw)
    if (atoms.length === 0) return

    const content = atoms.map(a => `- ${a}`).join('\n')
    await memory.write(
      { type: 'user', spaceId, spacePath: getSpace(spaceId)?.path ?? '' },
      { scope: 'user', mode: 'append', content }
    )
    console.log(`[UserMemory] learned ${atoms.length} atom(s) about the user`)
  } catch (err) {
    console.warn('[UserMemory] distill failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}
