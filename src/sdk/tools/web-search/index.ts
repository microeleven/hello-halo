/**
 * @module tools/web-search
 * WebSearchTool — Search the web using Brave Search API or DuckDuckGo fallback.
 *
 * Uses Brave Search API when BRAVE_SEARCH_API_KEY is set in the environment.
 * Falls back to DuckDuckGo Instant Answer API otherwise (limited coverage).
 *
 * @license MIT
 */

import type { Tool, ToolContext, ToolResult } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { WEB_SEARCH_TOOL_NAME, WEB_SEARCH_TOOL_DESCRIPTION, WEB_SEARCH_INPUT_SCHEMA } from './schema.js';

/** Default fetch timeout in ms. */
const FETCH_TIMEOUT_MS = 15_000;
/** Default number of results to request. */
const DEFAULT_NUM_RESULTS = 8;
/** Maximum allowed results. */
const MAX_NUM_RESULTS = 10;

// ---------------------------------------------------------------------------
// URL encoding (minimal, avoids dependency on node:querystring)
// ---------------------------------------------------------------------------

function encodeQueryParam(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, '+');
}

// ---------------------------------------------------------------------------
// Brave Search API
// ---------------------------------------------------------------------------

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

async function searchBrave(
  query: string,
  numResults: number,
  apiKey: string,
  signal: AbortSignal | undefined,
  allowedDomains?: string[],
  blockedDomains?: string[],
): Promise<{ results: BraveSearchResult[] } | { error: string }> {
  // Build the Brave Search API URL
  const params = new URLSearchParams({
    q: query,
    count: String(numResults),
  });
  const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // Combine with parent abort signal
  if (signal?.aborted) {
    clearTimeout(timer);
    return { error: 'Request aborted' };
  }
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const resp = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);

    if (!resp.ok) {
      return { error: `Brave Search API returned status ${resp.status}` };
    }

    const data = await resp.json() as Record<string, unknown>;
    const webObj = data.web as Record<string, unknown> | undefined;
    const rawResults = (webObj?.results as Array<Record<string, unknown>>) ?? [];

    // Apply domain filtering (allowed/blocked) client-side since
    // the Brave API doesn't natively support domain filters.
    let results: BraveSearchResult[] = rawResults.map((item) => ({
      title: String(item.title ?? '(No title)'),
      url: String(item.url ?? ''),
      description: String(item.description ?? ''),
    }));

    if (allowedDomains && allowedDomains.length > 0) {
      const allowed = new Set(allowedDomains.map((d) => d.toLowerCase()));
      results = results.filter((r) => {
        try {
          return allowed.has(new URL(r.url).hostname.toLowerCase());
        } catch {
          return false;
        }
      });
    }

    if (blockedDomains && blockedDomains.length > 0) {
      const blocked = new Set(blockedDomains.map((d) => d.toLowerCase()));
      results = results.filter((r) => {
        try {
          return !blocked.has(new URL(r.url).hostname.toLowerCase());
        } catch {
          return true;
        }
      });
    }

    return { results };
  } catch (err: unknown) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);

    if (err instanceof Error && err.name === 'AbortError') {
      if (signal?.aborted) {
        return { error: 'Request aborted' };
      }
      return { error: `Search request timed out after ${FETCH_TIMEOUT_MS}ms` };
    }
    return { error: `Search request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// DuckDuckGo Instant Answer API (fallback)
// ---------------------------------------------------------------------------

interface DdgResult {
  text: string;
  url: string;
}

async function searchDuckDuckGo(
  query: string,
  numResults: number,
  signal: AbortSignal | undefined,
): Promise<{ results: DdgResult[] } | { error: string }> {
  const url = `https://api.duckduckgo.com/?q=${encodeQueryParam(query)}&format=json&no_html=1&skip_disambig=1`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  if (signal?.aborted) {
    clearTimeout(timer);
    return { error: 'Request aborted' };
  }
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'AgentCoreSDK/1.0',
      },
      signal: controller.signal,
    });

    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);

    if (!resp.ok) {
      return { error: `DuckDuckGo API returned status ${resp.status}` };
    }

    const data = await resp.json() as Record<string, unknown>;
    const results: DdgResult[] = [];

    // Abstract (main answer)
    const abstractText = data.Abstract as string | undefined;
    if (abstractText) {
      const source = (data.AbstractSource as string) ?? '';
      const abstractUrl = (data.AbstractURL as string) ?? '';
      results.push({
        text: source ? `${source}: ${abstractText}` : abstractText,
        url: abstractUrl,
      });
    }

    // Related topics
    const topics = data.RelatedTopics as Array<Record<string, unknown>> | undefined;
    if (topics) {
      for (const topic of topics) {
        if (results.length >= numResults) break;
        const text = topic.Text as string | undefined;
        const firstUrl = topic.FirstURL as string | undefined;
        if (text) {
          results.push({ text, url: firstUrl ?? '' });
        }
      }
    }

    return { results };
  } catch (err: unknown) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);

    if (err instanceof Error && err.name === 'AbortError') {
      if (signal?.aborted) {
        return { error: 'Request aborted' };
      }
      return { error: `Search request timed out after ${FETCH_TIMEOUT_MS}ms` };
    }
    return { error: `Search request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Format results
// ---------------------------------------------------------------------------

function formatBraveResults(results: BraveSearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. **${r.title}**`);
    lines.push(`   URL: ${r.url}`);
    if (r.description) {
      lines.push(`   ${r.description}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatDdgResults(results: DdgResult[], query: string): string {
  if (results.length === 0) {
    return (
      `No instant answer found for '${query}'. For full web search results, ` +
      `set the BRAVE_SEARCH_API_KEY environment variable.`
    );
  }

  const lines: string[] = [];
  for (const r of results) {
    lines.push(`- ${r.text}`);
    if (r.url) {
      lines.push(`  ${r.url}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// WebSearchTool
// ---------------------------------------------------------------------------

export const WebSearchTool: Tool = {
  name: WEB_SEARCH_TOOL_NAME,
  description: WEB_SEARCH_TOOL_DESCRIPTION,
  inputSchema: WEB_SEARCH_INPUT_SCHEMA,
  permissionLevel: 'readonly',

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const query = input.query as string | undefined;
    if (!query || typeof query !== 'string') {
      return toolError('Missing required parameter: query');
    }

    const allowedDomains = input.allowed_domains as string[] | undefined;
    const blockedDomains = input.blocked_domains as string[] | undefined;

    // Determine result count from input or default
    const numResults = Math.min(
      Math.max(1, Number(input.num_results) || DEFAULT_NUM_RESULTS),
      MAX_NUM_RESULTS,
    );

    // Resolve API key from tool context env or process env
    const braveApiKey =
      ctx.env?.BRAVE_SEARCH_API_KEY ??
      process.env.BRAVE_SEARCH_API_KEY ??
      '';

    const startTime = Date.now();

    if (braveApiKey) {
      // Use Brave Search API
      const result = await searchBrave(
        query,
        numResults,
        braveApiKey,
        ctx.abortSignal,
        allowedDomains,
        blockedDomains,
      );

      if ('error' in result) {
        return toolError(result.error);
      }

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const header = `Search results for "${query}" (${result.results.length} results, ${durationSec}s):\n\n`;
      return toolSuccess(header + formatBraveResults(result.results));
    }

    // Fallback: DuckDuckGo
    const result = await searchDuckDuckGo(query, numResults, ctx.abortSignal);

    if ('error' in result) {
      return toolError(result.error);
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const header = `Search results for "${query}" (DuckDuckGo instant answers, ${durationSec}s):\n\n`;
    return toolSuccess(header + formatDdgResults(result.results, query));
  },
};
