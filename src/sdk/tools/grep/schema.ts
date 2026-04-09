/**
 * @module tools/grep/schema
 * Grep tool description and input schema.
 * @license MIT
 */

export const name = 'Grep';

export const description =
  'A powerful search tool built on regex. Supports full regex syntax. ' +
  'Filter files with the `glob` parameter or `type` parameter. Output ' +
  'modes: "content" shows matching lines, "files_with_matches" shows ' +
  'only file paths (default), "count" shows match counts.';

export const inputSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'The regular expression pattern to search for',
    },
    path: {
      type: 'string',
      description: 'File or directory to search in. Defaults to working directory.',
    },
    type: {
      type: 'string',
      description: 'File type to search (e.g. js, py, rust, go)',
    },
    glob: {
      type: 'string',
      description: 'Glob pattern to filter files (e.g. "*.js")',
    },
    output_mode: {
      type: 'string',
      enum: ['content', 'files_with_matches', 'count'],
      description: 'Output mode (default: files_with_matches)',
    },
    '-B': {
      type: 'number',
      description:
        'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
    },
    '-A': {
      type: 'number',
      description:
        'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
    },
    '-C': {
      type: 'number',
      description: 'Alias for context.',
    },
    context: {
      type: 'number',
      description:
        'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
    },
    '-n': {
      type: 'boolean',
      description:
        'Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true.',
    },
    '-i': {
      type: 'boolean',
      description: 'Case insensitive search (rg -i)',
    },
    head_limit: {
      type: 'number',
      description:
        'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: ' +
        'content (limits output lines), files_with_matches (limits file paths), count (limits count entries). ' +
        'Defaults to 250 when unspecified. Pass 0 for unlimited (use sparingly -- large result sets waste context).',
    },
    offset: {
      type: 'number',
      description:
        'Skip first N lines/entries before applying head_limit, equivalent to "| tail -n +N | head -N". ' +
        'Works across all output modes. Defaults to 0.',
    },
    multiline: {
      type: 'boolean',
      description:
        'Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.',
    },
  },
  required: ['pattern'],
} as const;
