/**
 * @module tools/read/pdf
 * Basic PDF text extraction with size pre-validation.
 * @license MIT
 */

import * as fs from 'node:fs/promises';

/**
 * Maximum PDF file size in bytes for extraction.
 * Matches the CC official PDF_MAX_EXTRACT_SIZE limit.
 */
const PDF_MAX_EXTRACT_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Maximum number of pages per Read request.
 * Matches the CC official PDF_MAX_PAGES_PER_READ limit.
 */
export const PDF_MAX_PAGES_PER_READ = 20;

/**
 * Read a PDF file and extract text content.
 * Validates file size and page range before processing.
 * Full PDF support requires an external library (e.g. pdf-parse).
 * This is a placeholder that returns a helpful message.
 */
export async function readPdf(filePath: string, pages?: string): Promise<string> {
  // Pre-validate file size to avoid wasting API round-trips on oversized PDFs
  const stat = await fs.stat(filePath);
  if (stat.size > PDF_MAX_EXTRACT_SIZE) {
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `PDF file is too large (${sizeMB} MB). Maximum supported size is ${PDF_MAX_EXTRACT_SIZE / (1024 * 1024)} MB.`,
    );
  }

  // Validate page range if provided
  if (pages !== undefined) {
    const parsed = parsePdfPageRange(pages);
    if (!parsed) {
      throw new Error(
        `Invalid pages parameter: "${pages}". Use formats like "1-5", "3", or "10-20". Pages are 1-indexed.`,
      );
    }
    const rangeSize = parsed.end - parsed.start + 1;
    if (rangeSize > PDF_MAX_PAGES_PER_READ) {
      throw new Error(
        `Page range "${pages}" exceeds maximum of ${PDF_MAX_PAGES_PER_READ} pages per request. Please use a smaller range.`,
      );
    }
  }

  // Full PDF text extraction requires an external library.
  // The host application can provide a real implementation via ToolContext.
  return (
    `[PDF file: ${filePath}. ` +
    (pages ? `Requested pages: ${pages}. ` : '') +
    'Use the `pages` parameter to read specific page ranges.]'
  );
}

/**
 * Parse a page range string like "1-5", "3", or "10-20".
 * Returns start and end page numbers (1-indexed), or null if invalid.
 */
function parsePdfPageRange(pages: string): { start: number; end: number } | null {
  const trimmed = pages.trim();
  if (!trimmed) return null;

  // Single page: "3"
  const singleMatch = trimmed.match(/^(\d+)$/);
  if (singleMatch) {
    const page = parseInt(singleMatch[1], 10);
    if (page < 1) return null;
    return { start: page, end: page };
  }

  // Range: "1-5"
  const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (start < 1 || end < start) return null;
    return { start, end };
  }

  return null;
}
