/**
 * Tlon ingest orchestration.
 *
 * Model: enqueue-ALL-then-process so the batch total is correct from the start
 * (never queue one-by-one with each item triggering processing).
 *
 * AI calls are direct, non-streaming HTTP requests via proxyFetch. They do NOT
 * go through the agent V2 SDK session machinery — ingest is a single
 * request/response per source file. `stream: false` is mandatory (DeepSeek and
 * other OpenAI-compatible gateways hang on body read otherwise).
 *
 * Learned status is persisted only on success (hashes.json), and index.md is
 * always rebuilt programmatically from the wiki directory — the model's own
 * index output is never trusted.
 *
 * No relative-path require(): all imports are static; the only dynamic import
 * is reserved for breaking a real module cycle.
 */

import { join, dirname, sep } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { getAISourceManager } from '../ai-sources'
import { proxyFetch } from '../proxy-fetch'
import { sendToRenderer } from '../../foundation/window.service'
import { broadcastToAll } from '../../http/websocket'
import type { DirectCallEndpoint } from '../../../shared/types/ai-sources'
import type {
  IngestJob,
  IngestProgressEvent,
  IngestHashesV1,
} from '../../../shared/types/tlon'
import {
  getKBSchemaPath,
  getKBLogPath,
  getKBWikiDir,
} from './paths'
import {
  getKB,
  readHashes,
  writeHashes,
  readIndexMd,
  listWikiPages,
  refreshStats,
  markIngestCompleted,
  setKBStatus,
  collectIngestCandidates,
  sha256,
} from './service'
import { extractText } from './extract'
import {
  buildIngestSystemPrompt,
  buildIngestUserMessage,
  DEFAULT_INDEX_MD,
} from './defaults'

// ============================================================================
// State
// ============================================================================

const queues = new Map<string, IngestJob[]>()
const processing = new Set<string>()
const progress = new Map<string, IngestProgressEvent>()

/**
 * How many source files have their model call in flight at once per KB. Model
 * calls are network-bound (seconds each); running a few concurrently is the
 * main speedup. Result application stays serialized (see processQueue), so this
 * cap never races hashes.json or index.md.
 */
const INGEST_CONCURRENCY = 4

function emitProgress(event: IngestProgressEvent): void {
  progress.set(event.kbId, event)
  sendToRenderer('tlon:ingest-progress', event as unknown as Record<string, unknown>)
  broadcastToAll('tlon:ingest-progress', event as unknown as Record<string, unknown>)
}

function emitStatsUpdated(kbId: string): void {
  const stats = refreshStats(kbId)
  const payload = { kbId, stats }
  sendToRenderer('tlon:stats-updated', payload as unknown as Record<string, unknown>)
  broadcastToAll('tlon:stats-updated', payload as unknown as Record<string, unknown>)
}

export function getIngestProgress(kbId: string): IngestProgressEvent {
  return (
    progress.get(kbId) || {
      kbId,
      total: 0,
      completed: 0,
      phase: 'idle',
    }
  )
}

// ============================================================================
// Public enqueue API
// ============================================================================

/**
 * Append jobs to a KB's queue. Does NOT start processing — callers that want
 * a correct batch total must enqueue everything first, then call processQueue.
 */
export function enqueueFiles(
  kbId: string,
  entries: Array<{ sourcePath: string; absolutePath: string; sourceType: 'raw' | 'linked' }>
): void {
  const queue = queues.get(kbId) || []
  for (const e of entries) {
    // De-dup against pending jobs for the same source path.
    if (queue.some(j => j.sourcePath === e.sourcePath)) continue
    queue.push({
      id: uuidv4(),
      kbId,
      sourcePath: e.sourcePath,
      absolutePath: e.absolutePath,
      sourceType: e.sourceType,
      status: 'pending',
    })
  }
  queues.set(kbId, queue)
}

/**
 * Enqueue ALL changed raw + linked files for a KB, set the batch total once,
 * then start processing. This is the user-triggered "Learn everything" path.
 */
export async function triggerFullIngest(kbId: string): Promise<void> {
  const kb = getKB(kbId)
  if (!kb) return

  const candidates = collectIngestCandidates(kbId)
  enqueueFiles(kbId, candidates)

  const queue = queues.get(kbId) || []
  emitProgress({
    kbId,
    total: queue.length,
    completed: 0,
    phase: queue.length > 0 ? 'running' : 'done',
  })

  if (queue.length === 0) {
    emitStatsUpdated(kbId)
    return
  }

  await processQueue(kbId)
}

/**
 * Process the queue from a watcher-driven enqueue. Sets total to the current
 * queue length when starting a fresh batch.
 *
 * Model calls run with bounded concurrency; each result is applied through a
 * single serialized chain so hashes.json read-modify-write and the index.md
 * rebuild never overlap.
 */
export async function processQueue(kbId: string): Promise<void> {
  if (processing.has(kbId)) return
  const queue = queues.get(kbId)
  if (!queue || queue.length === 0) return

  processing.add(kbId)
  const total = queue.length
  let completed = 0

  // Resolve the call endpoint once for the whole batch (the active source does
  // not change mid-batch). Owned by the AI-sources manager so URL/headers/wire
  // format stay consistent with the agent path. `responses` / `kiro` need the
  // router's translation layer and cannot be called directly.
  const manager = getAISourceManager()
  await manager.ensureInitialized()
  const endpoint = manager.getDirectCallEndpoint()
  const unsupported =
    endpoint && (endpoint.apiType === 'responses' || endpoint.apiType === 'kiro')
      ? `API type '${endpoint.apiType}' is not supported for ingest`
      : null
  if (!endpoint || unsupported) {
    const message = unsupported || 'No AI source configured'
    console.error(`[Tlon] Cannot ingest for ${kbId}: ${message}`)
    setKBStatus(kbId, 'error')
    emitProgress({ kbId, total, completed: 0, phase: 'error', error: message })
    processing.delete(kbId)
    queues.delete(kbId)
    return
  }

  // Ensure a running phase with the full total is published before work starts.
  const existing = progress.get(kbId)
  if (!existing || existing.phase !== 'running' || existing.total < total) {
    emitProgress({ kbId, total, completed: 0, phase: 'running' })
  }

  let applyChain: Promise<void> = Promise.resolve()

  const worker = async (): Promise<void> => {
    for (;;) {
      const job = queue.shift()
      if (!job) break
      emitProgress({
        kbId,
        total,
        completed,
        current: job.sourcePath.split(sep).pop() || job.sourcePath,
        phase: 'running',
      })
      try {
        const fetched = await fetchIngest(job, endpoint)
        applyChain = applyChain.then(() => applyIngest(fetched))
        await applyChain
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[Tlon] Ingest failed for ${job.sourcePath}:`, message)
        setKBStatus(kbId, 'error')
        emitProgress({ kbId, total, completed, phase: 'error', error: message })
      }
      completed++
      emitProgress({ kbId, total, completed, phase: 'running' })
    }
  }

  try {
    const pool = Array.from({ length: Math.min(INGEST_CONCURRENCY, total) }, () => worker())
    await Promise.all(pool)
  } finally {
    processing.delete(kbId)
    queues.delete(kbId)
  }

  markIngestCompleted(kbId)
  emitProgress({ kbId, total, completed, phase: 'done' })
  emitStatsUpdated(kbId)
}

// ============================================================================
// Model call
// ============================================================================
//
// Endpoint resolution (URL normalization, wire format, auth headers) is owned
// by the AI-sources manager (getDirectCallEndpoint) so it stays consistent with
// the agent/router path. Here we only shape the request/parse the response for
// the two wire formats a direct, non-streaming caller can speak.

async function callModel(
  endpoint: DirectCallEndpoint,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const isAnthropic = endpoint.wireFormat === 'anthropic'
  const body = isAnthropic
    ? {
        model: endpoint.model,
        max_tokens: 8192,
        stream: false,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }
    : {
        model: endpoint.model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }

  const res = await proxyFetch(endpoint.url, {
    method: 'POST',
    headers: endpoint.headers,
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${text.slice(0, 500)}`)
  }

  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`)
  }

  if (isAnthropic) {
    const content = json?.content
    if (Array.isArray(content)) {
      return content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('')
    }
    throw new Error('Unexpected Anthropic response shape')
  }

  const out = json?.choices?.[0]?.message?.content
  if (typeof out === 'string') return out
  throw new Error('Unexpected OpenAI-compatible response shape')
}

// ============================================================================
// Single-file ingest
// ============================================================================

interface ParsedWikiPage {
  path: string
  body: string
}

/** Parse `<!-- file: path -->` ... `<!-- endfile -->` blocks from model output. */
function parseWikiBlocks(output: string): ParsedWikiPage[] {
  const pages: ParsedWikiPage[] = []
  const re = /<!--\s*file:\s*(.+?)\s*-->\s*\n([\s\S]*?)(?=\n<!--\s*endfile\s*-->|\n<!--\s*file:|$)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(output)) !== null) {
    const rawPath = match[1].trim()
    let body = match[2]
    // Strip a wrapping ```markdown fence if the model added one anyway.
    const fence = body.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/)
    if (fence) body = fence[1]
    // A real wiki page begins with an H1 title. Drop any leading model chatter
    // (e.g. "I'll create the following pages…") before it, and reject the block
    // entirely if it has no heading at all — that is pure commentary, not a page.
    const h1 = body.search(/^#\s/m)
    if (h1 < 0) continue
    body = body.slice(h1)
    // Remove any stray HTML-comment markers the model embedded mid-page.
    body = body.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*$/gm, '').trim()
    // Normalize the path: drop leading wiki/ and any absolute prefix.
    let rel = rawPath.replace(/^\/+/, '').replace(/^wiki\//, '')
    if (!rel.toLowerCase().endsWith('.md')) rel += '.md'
    // Reject path traversal.
    if (rel.includes('..')) continue
    pages.push({ path: rel, body: body.replace(/\s+$/, '') + '\n' })
  }
  return pages
}

interface FetchedIngest {
  job: IngestJob
  pages: ParsedWikiPage[]
  contentHash: string
  skipped: boolean
}

/**
 * Read a source file and run its model call against the pre-resolved endpoint.
 * Safe to run concurrently: touches only per-job state and read-only KB files
 * (schema/index for context). All shared-state writes happen later in
 * applyIngest.
 */
async function fetchIngest(job: IngestJob, endpoint: DirectCallEndpoint): Promise<FetchedIngest> {
  job.status = 'running'
  job.startedAt = new Date().toISOString()

  // Read raw bytes (hashed for learned-status), then extract ingestible text.
  // Text files decode as UTF-8; PDF/Office documents go through a parser.
  let buf: Buffer
  try {
    buf = readFileSync(job.absolutePath)
  } catch {
    job.status = 'skipped'
    console.warn(`[Tlon] Cannot read ${job.absolutePath}, skipping`)
    return { job, pages: [], contentHash: '', skipped: true }
  }
  const contentHash = sha256(buf)

  let fileContent: string
  try {
    fileContent = await extractText(job.absolutePath, buf)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Tlon] Failed to extract text from ${job.sourcePath}: ${message}`)
    job.status = 'skipped'
    return { job, pages: [], contentHash: '', skipped: true }
  }
  if (!fileContent.trim()) {
    console.warn(`[Tlon] No text extracted from ${job.sourcePath}, skipping`)
    job.status = 'skipped'
    return { job, pages: [], contentHash: '', skipped: true }
  }

  // Build prompts.
  const schema = existsSync(getKBSchemaPath(job.kbId))
    ? readFileSync(getKBSchemaPath(job.kbId), 'utf-8')
    : ''
  const indexContent = readIndexMd(job.kbId) || ''
  const systemPrompt = buildIngestSystemPrompt(schema)
  const userMessage = buildIngestUserMessage(job, indexContent, fileContent)

  // Call model.
  const output = await callModel(endpoint, systemPrompt, userMessage)
  return { job, pages: parseWikiBlocks(output), contentHash, skipped: false }
}

/**
 * Write a fetched result to disk. MUST run serialized per KB: it does the
 * hashes.json read-modify-write and the programmatic index.md rebuild, both of
 * which would corrupt under concurrent execution.
 */
function applyIngest(fetched: FetchedIngest): void {
  const { job, pages, contentHash, skipped } = fetched
  if (skipped) return

  // Write wiki pages.
  const wikiDir = getKBWikiDir(job.kbId)
  const written: string[] = []
  for (const page of pages) {
    const abs = join(wikiDir, page.path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, page.body, 'utf-8')
    written.push(page.path)
  }

  // Rebuild index.md programmatically.
  rebuildIndexMd(job.kbId)

  // Append a one-line log entry.
  appendLog(job, written)

  // Persist learned status (only on success).
  const hashes: IngestHashesV1 = readHashes(job.kbId)
  hashes.files[job.sourcePath] = {
    hash: contentHash,
    ingestedAt: new Date().toISOString(),
    wikiPages: written,
  }
  writeHashes(job.kbId, hashes)

  job.status = 'completed'
  job.completedAt = new Date().toISOString()
  job.contentHash = contentHash
  job.wikiPagesAffected = written
}

/**
 * Rebuild index.md from the wiki directory. Each line carries the topic title,
 * a one-line synopsis (so the agent has ambient awareness without reading), the
 * original source document, and the absolute path to Read for detail.
 *
 * Exported so the bootstrap can refresh existing KBs into this richer format
 * without re-ingesting.
 */
export function rebuildIndexMd(kbId: string): void {
  const kb = getKB(kbId)
  if (!kb) return
  const pages = listWikiPages(kbId)
  const wikiDir = getKBWikiDir(kbId)

  if (pages.length === 0) {
    writeFileSync(join(kb.path, 'index.md'), DEFAULT_INDEX_MD, 'utf-8')
    return
  }

  let md = `# ${kb.name}\n\n`
  md += `Topics you know — each has a one-line synopsis and its source. `
  md += `Read a topic's file only for exact detail.\n\n`
  for (const page of pages) {
    const absPath = join(wikiDir, ...page.path.split('/'))
    let synopsis = ''
    try {
      synopsis = pageSynopsis(readFileSync(absPath, 'utf-8'))
    } catch { /* ignore */ }
    const sources = page.sources.map(s => s.split(/[\\/]/).pop() || s)
    const from = sources.length ? ` _(from ${sources.join(', ')})_` : ''
    md += `- **${page.title}**${synopsis ? ` — ${synopsis}` : ''}${from} — \`${absPath}\`\n`
  }
  md += '\n'
  writeFileSync(join(kb.path, 'index.md'), md, 'utf-8')
}

/**
 * First prose line of a wiki page (preferring its Summary section), stripped of
 * markdown and capped — used as the index synopsis. Skips headings, source
 * blockquotes, lists, tables, and markers so model chatter does not leak in.
 */
function pageSynopsis(content: string): string {
  const lines = content.split('\n')
  const summaryIdx = lines.findIndex(l => /^#{1,6}\s+summary\b/i.test(l.trim()))
  const scan = summaryIdx >= 0 ? lines.slice(summaryIdx + 1) : lines
  for (const raw of scan) {
    const line = raw.trim()
    if (!line) continue
    if (/^#{1,6}\s/.test(line)) continue
    if (line.startsWith('>') || line.startsWith('<!--') || line.startsWith('```') || line.startsWith('|')) continue
    if (/^[-*+]\s/.test(line)) continue
    const s = line
      .replace(/`/g, '')
      .replace(/\*\*?/g, '')
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
      .trim()
    if (!s) continue
    return s.length > 160 ? s.slice(0, 157).trimEnd() + '…' : s
  }
  return ''
}

function appendLog(job: IngestJob, wikiPages: string[]): void {
  const date = new Date().toISOString().slice(0, 10)
  const summary = wikiPages.length > 0 ? wikiPages.join(', ') : '(no pages)'
  const line = `## [${date}] ingest | ${job.sourcePath} — ${summary}\n`
  try {
    appendFileSync(getKBLogPath(job.kbId), line, 'utf-8')
  } catch (error) {
    console.error(`[Tlon] Failed to append log for ${job.kbId}:`, error)
  }
}
