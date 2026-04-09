/**
 * @module tools/read
 * ReadTool — reads files from the local filesystem.
 * @license MIT
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Tool, ToolContext, ToolResult, PermissionLevel } from '../../types/tool.js';
import { toolSuccess, toolError } from '../../types/tool.js';
import { name, description, inputSchema } from './schema.js';
import { readPdf } from './pdf.js';
import { readNotebook } from './notebook.js';
import { readImage } from './image.js';

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico',
]);

export class ReadTool implements Tool {
  readonly name = name;
  readonly description = description;
  readonly inputSchema: Record<string, unknown> = inputSchema;
  readonly permissionLevel: PermissionLevel = 'readonly';

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const filePath = input.file_path as string | undefined;
    if (!filePath) {
      return toolError('file_path is required');
    }

    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath);

    // Check existence
    let stat;
    try {
      stat = await fs.stat(resolvedPath);
    } catch {
      return toolError(`File not found: ${resolvedPath}`);
    }

    // Reject directories
    if (stat.isDirectory()) {
      return toolError(
        `${resolvedPath} is a directory, not a file. Use Bash with \`ls\` to list directory contents.`,
      );
    }

    // Detect file type by extension
    const ext = path.extname(resolvedPath).toLowerCase().slice(1);

    // Image files
    if (IMAGE_EXTENSIONS.has(ext)) {
      try {
        const result = await readImage(resolvedPath);
        return toolSuccess(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }

    // PDF files
    if (ext === 'pdf') {
      try {
        const pages = input.pages as string | undefined;
        const result = await readPdf(resolvedPath, pages);
        return toolSuccess(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    }

    // Jupyter notebooks
    if (ext === 'ipynb') {
      try {
        const result = await readNotebook(resolvedPath);
        return toolSuccess(result);
      } catch (e) {
        return toolError(`Failed to parse notebook: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Read as text
    let content: string;
    try {
      content = await fs.readFile(resolvedPath, 'utf-8');
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'EISDIR') {
        return toolError(
          `${resolvedPath} is a directory, not a file. Use Bash with \`ls\` to list directory contents.`,
        );
      }
      // Likely binary file
      return toolError(
        `File appears to be binary and cannot be displayed as text: ${resolvedPath}`,
      );
    }

    // Empty file
    if (content.length === 0) {
      return toolSuccess(`[File ${resolvedPath} exists but is empty]`);
    }

    const lines = content.split('\n');
    // If file ends with newline, the split produces an extra empty string — keep it for accuracy
    const totalLines = lines.length;

    const offset = (input.offset as number | undefined) ?? 0;
    const limit = (input.limit as number | undefined) ?? 2000;

    // Convert 1-based offset to 0-based index
    const start = offset > 0 ? offset - 1 : 0;
    const end = Math.min(start + limit, totalLines);

    if (start >= totalLines) {
      return toolError(
        `Offset ${offset} exceeds total line count ${totalLines} in ${resolvedPath}`,
      );
    }

    // Format with line numbers (cat -n style)
    const width = String(end).length;
    let output = '';
    for (let i = start; i < end; i++) {
      const lineNum = String(i + 1).padStart(width, ' ');
      output += `${lineNum}\t${lines[i]}\n`;
    }

    if (end < totalLines) {
      output += `\n... (${totalLines - end} more lines, ${totalLines} total. Use offset/limit to read more.)\n`;
    }

    return toolSuccess(output);
  }
}
