/**
 * Tlon ingest defaults — seed file contents and the proven ingest prompt
 * format.
 *
 * The ingest prompt asks the model to emit wiki pages as fenced blocks
 * delimited by `<!-- file: <wiki-relative-path> -->` markers. ingest.ts parses
 * these markers; index.md is rebuilt programmatically afterwards (the model's
 * index output is never trusted — it tends to wrap content in ```markdown
 * fences).
 */

import type { IngestJob } from '../../../shared/types/tlon'

export const DEFAULT_SCHEMA_MD = `# Wiki Schema

This knowledge base is a structured wiki built from source documents.

## Page conventions
- One topic per page. Keep page names short and stable (kebab-case).
- Use \`[[page-name]]\` to cross-link related pages.
- Preserve exact quotes, numbers, dates, and proper nouns from sources.
- Prefer updating an existing page over creating a near-duplicate.

## Suggested structure
- Place pages directly under \`wiki/\` unless a clear sub-topic grouping exists.
- Each page should start with an H1 title, followed by a short summary.
`

export const DEFAULT_INDEX_MD = `# Index

_No wiki pages yet. Add source files and run learning to populate this knowledge base._
`

export const DEFAULT_LOG_MD = `# Ingest Log
`

/**
 * Build the ingest system prompt: built-in curator instructions merged with
 * the KB's editable schema.md.
 */
export function buildIngestSystemPrompt(schema: string): string {
  return `You are a wiki curator. Your job is to ingest a single source document into a structured wiki by emitting wiki pages.

## Wiki Schema
${schema.trim()}

## Output format (STRICT)
For every wiki page you create or update, output a block in EXACTLY this form:

<!-- file: <wiki-relative-path>.md -->
<full markdown content of the page>
<!-- endfile -->

Rules for the output:
- The path is relative to the wiki/ directory (e.g. \`topics/foo.md\`). Do NOT include \`wiki/\` or absolute paths.
- Emit the COMPLETE final content of each page between the markers — not a diff.
- Do NOT wrap page content in triple-backtick code fences.
- Do NOT emit an index page; the index is generated automatically.
- Output ONLY file blocks. No commentary before, between, or after them.

## Curation rules
- Prefer updating an existing page over creating a near-duplicate one.
- Use \`[[page-name]]\` for cross-links between pages.
- Preserve exact quotes, numbers, dates, and proper nouns.
- Keep page names short and stable (kebab-case).`
}

/**
 * Build the ingest user message for a single source file.
 *
 * @param job          the ingest job (carries the source path label)
 * @param indexContent current index.md content (navigation map for context)
 * @param fileContent  the raw text of the source file to ingest
 */
export function buildIngestUserMessage(
  job: IngestJob,
  indexContent: string,
  fileContent: string
): string {
  return `Ingest the following source document into the wiki.

Source path: ${job.sourcePath}

## Current wiki index (for context — pages that already exist)
${indexContent.trim() || '(empty)'}

## Source document content
${fileContent}

Emit the wiki page file blocks now, following the strict output format.`
}
