/**
 * @module tools/read/schema
 * File Read tool description and input schema.
 * @license MIT
 */

export const name = 'Read';

export const description =
  'Reads a file from the local filesystem. You can access any file directly. ' +
  'By default reads up to 2000 lines from the beginning. Results are returned ' +
  'with line numbers starting at 1. This tool can read images (PNG, JPG) and ' +
  'PDF files.';

export const inputSchema = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'The absolute path to the file to read',
    },
    offset: {
      type: 'number',
      description:
        'The line number to start reading from (1-based). Only provide if the file is too large to read at once.',
    },
    limit: {
      type: 'number',
      description:
        'The number of lines to read. Only provide if the file is too large to read at once.',
    },
    pages: {
      type: 'string',
      description:
        'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.',
    },
  },
  required: ['file_path'],
} as const;
