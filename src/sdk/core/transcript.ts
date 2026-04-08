/**
 * @module core/transcript
 * Session transcript persistence — read/write JSONL files in CC-compatible format.
 *
 * Transcript file path:
 *   $CLAUDE_CONFIG_DIR/projects/<project-dir>/<session-id>.jsonl
 *
 * where:
 *   - CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
 *   - project-dir = cwd.replace(/[^a-zA-Z0-9]/g, '-')
 *
 * @license MIT
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Message } from '../types/provider.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Get the Claude Code config directory (same logic as CC CLI).
 * Checks CLAUDE_CONFIG_DIR env var first, then falls back to ~/.claude.
 */
function getClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
}

/**
 * Convert a working directory path to the project directory name
 * using the same rule as Claude Code CLI:
 *   Replace all non-alphanumeric characters with '-'
 *
 * e.g., /Users/fly/Desktop/myproject → -Users-fly-Desktop-myproject
 */
function getProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Compute the full path to a session's transcript JSONL file.
 *
 * @param sessionId - The session UUID
 * @param cwd - The working directory for this session
 */
export function getTranscriptPath(sessionId: string, cwd: string): string {
  const configDir = getClaudeConfigDir();
  const projectDir = getProjectDir(cwd);
  return path.join(configDir, 'projects', projectDir, `${sessionId}.jsonl`);
}

// ---------------------------------------------------------------------------
// JSONL entry types
// ---------------------------------------------------------------------------

interface TranscriptUserEntry {
  type: 'user';
  message: Message;
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  isSidechain: boolean;
}

interface TranscriptAssistantEntry {
  type: 'assistant';
  message: Message;
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  isSidechain: boolean;
}

type TranscriptEntry = TranscriptUserEntry | TranscriptAssistantEntry;

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Append a single transcript entry to the JSONL file.
 * Creates the file and parent directories if they don't exist.
 *
 * @param transcriptPath - Full path to the .jsonl file
 * @param entry - Entry to append
 */
export async function appendToTranscript(
  transcriptPath: string,
  entry: TranscriptEntry,
): Promise<void> {
  try {
    const dir = path.dirname(transcriptPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    await fs.promises.appendFile(transcriptPath, line, 'utf8');
  } catch {
    // Transcript writes are advisory — never break the session
  }
}

// ---------------------------------------------------------------------------
// Session transcript writer
// ---------------------------------------------------------------------------

/**
 * A stateful writer that appends messages to the session transcript.
 * Tracks parent UUIDs to maintain the message chain.
 */
export class TranscriptWriter {
  private readonly transcriptPath: string;
  private readonly sessionId: string;
  private lastUuid: string | null = null;
  private enabled: boolean;

  constructor(sessionId: string, cwd: string) {
    this.sessionId = sessionId;
    this.transcriptPath = getTranscriptPath(sessionId, cwd);
    // Only write if we have a valid cwd
    this.enabled = cwd.length > 0;
  }

  /** Append a user message to the transcript. */
  async writeUserMessage(message: Message): Promise<string> {
    const uuid = randomUUID();
    if (!this.enabled) {
      this.lastUuid = uuid;
      return uuid;
    }
    const entry: TranscriptUserEntry = {
      type: 'user',
      message,
      uuid,
      parentUuid: this.lastUuid,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      isSidechain: false,
    };
    await appendToTranscript(this.transcriptPath, entry);
    this.lastUuid = uuid;
    return uuid;
  }

  /** Append an assistant message to the transcript. */
  async writeAssistantMessage(message: Message): Promise<string> {
    const uuid = randomUUID();
    if (!this.enabled) {
      this.lastUuid = uuid;
      return uuid;
    }
    const entry: TranscriptAssistantEntry = {
      type: 'assistant',
      message,
      uuid,
      parentUuid: this.lastUuid,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      isSidechain: false,
    };
    await appendToTranscript(this.transcriptPath, entry);
    this.lastUuid = uuid;
    return uuid;
  }

  /** Get the path to the transcript file (for logging/debugging). */
  get path(): string {
    return this.transcriptPath;
  }
}

// ---------------------------------------------------------------------------
// Read (for resume)
// ---------------------------------------------------------------------------

/**
 * Read messages from a session transcript file for resumption.
 *
 * Parses the JSONL file, extracts user and assistant entries,
 * and returns them in order as Message objects.
 *
 * @param sessionId - The session ID to resume
 * @param cwd - The working directory (used to locate the transcript file)
 * @returns Array of messages in conversation order, or null if file not found
 */
export async function readTranscriptMessages(
  sessionId: string,
  cwd: string,
): Promise<Message[] | null> {
  const transcriptPath = getTranscriptPath(sessionId, cwd);

  let content: string;
  try {
    content = await fs.promises.readFile(transcriptPath, 'utf8');
  } catch {
    // File doesn't exist or can't be read
    return null;
  }

  const messages: Message[] = [];
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // Skip malformed lines
    }

    const type = entry.type as string | undefined;
    if (type !== 'user' && type !== 'assistant') {
      continue; // Skip non-message entries (queue-operation, etc.)
    }

    const message = entry.message as Message | undefined;
    if (!message || typeof message !== 'object') {
      continue;
    }

    // Normalize message role (some entries may have extra fields)
    if (message.role === 'user' || message.role === 'assistant') {
      messages.push({
        role: message.role,
        content: message.content,
      });
    }
  }

  return messages.length > 0 ? messages : null;
}

/**
 * Check if a transcript file exists for the given session.
 *
 * @param sessionId - The session ID to check
 * @param cwd - The working directory
 * @returns true if the transcript file exists and is readable
 */
export function transcriptExists(sessionId: string, cwd: string): boolean {
  const transcriptPath = getTranscriptPath(sessionId, cwd);
  try {
    fs.accessSync(transcriptPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
