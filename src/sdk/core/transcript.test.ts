/**
 * Unit tests for transcript read/write utilities.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getTranscriptPath,
  appendToTranscript,
  readTranscriptMessages,
  transcriptExists,
  TranscriptWriter,
} from './transcript.js';
import type { Message } from '../types/provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CWD = '/test/project/dir';

let tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs = [];
  delete process.env.CLAUDE_CONFIG_DIR;
});

function withTempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-transcript-test-'));
  tempDirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// getTranscriptPath
// ---------------------------------------------------------------------------

describe('getTranscriptPath', () => {
  it('encodes non-alphanumeric chars in cwd as dashes', () => {
    const p = getTranscriptPath('sess-id', '/Users/fly/my-project');
    expect(p).toContain('-Users-fly-my-project');
    expect(p).toMatch(/sess-id\.jsonl$/);
  });

  it('produces path under projects/<projectDir>', () => {
    const p = getTranscriptPath('sess', '/cwd');
    expect(p).toContain(path.join('projects'));
    expect(p).toMatch(/\.jsonl$/);
  });
});

// ---------------------------------------------------------------------------
// appendToTranscript + readTranscriptMessages round-trip
// ---------------------------------------------------------------------------

describe('appendToTranscript / readTranscriptMessages', () => {
  it('round-trips user and assistant messages via TranscriptWriter', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();

    const writer = new TranscriptWriter(sessionId, TEST_CWD);
    await writer.writeUserMessage({ role: 'user', content: 'Hello' });
    await writer.writeAssistantMessage({ role: 'assistant', content: 'World' });

    const messages = await readTranscriptMessages(sessionId, TEST_CWD);
    expect(messages).not.toBeNull();
    expect(messages).toHaveLength(2);
    expect(messages![0].role).toBe('user');
    expect(messages![0].content).toBe('Hello');
    expect(messages![1].role).toBe('assistant');
    expect(messages![1].content).toBe('World');
  });

  it('returns null when transcript does not exist', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const result = await readTranscriptMessages(randomUUID(), TEST_CWD);
    expect(result).toBeNull();
  });

  it('skips malformed JSON lines gracefully', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const transcriptPath = getTranscriptPath(sessionId, TEST_CWD);

    await fs.promises.mkdir(path.dirname(transcriptPath), { recursive: true });
    const validEntry = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'valid' },
      uuid: randomUUID(),
      parentUuid: null,
      sessionId,
      timestamp: new Date().toISOString(),
      isSidechain: false,
    });
    await fs.promises.writeFile(transcriptPath, validEntry + '\n{malformed}\n', 'utf8');

    const messages = await readTranscriptMessages(sessionId, TEST_CWD);
    expect(messages).toHaveLength(1);
    expect(messages![0].content).toBe('valid');
  });

  it('appendToTranscript creates parent directories automatically', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const transcriptPath = getTranscriptPath(sessionId, TEST_CWD);

    // Directory should not exist yet
    expect(fs.existsSync(path.dirname(transcriptPath))).toBe(false);

    await appendToTranscript(transcriptPath, {
      type: 'user',
      message: { role: 'user', content: 'test' } as Message,
      uuid: randomUUID(),
      parentUuid: null,
      sessionId,
      timestamp: new Date().toISOString(),
      isSidechain: false,
    } as Parameters<typeof appendToTranscript>[1]);

    expect(fs.existsSync(transcriptPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// transcriptExists
// ---------------------------------------------------------------------------

describe('transcriptExists', () => {
  it('returns false when no transcript file', () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    expect(transcriptExists(randomUUID(), TEST_CWD)).toBe(false);
  });

  it('returns true after transcript is written', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const transcriptPath = getTranscriptPath(sessionId, TEST_CWD);
    await fs.promises.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.promises.writeFile(transcriptPath, '{}', 'utf8');
    expect(transcriptExists(sessionId, TEST_CWD)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TranscriptWriter
// ---------------------------------------------------------------------------

describe('TranscriptWriter', () => {
  it('writes messages in order', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const writer = new TranscriptWriter(sessionId, TEST_CWD);

    await writer.writeUserMessage({ role: 'user', content: 'ping' });
    await writer.writeAssistantMessage({ role: 'assistant', content: 'pong' });

    const messages = await readTranscriptMessages(sessionId, TEST_CWD);
    expect(messages).toHaveLength(2);
    expect(messages![0].content).toBe('ping');
    expect(messages![1].content).toBe('pong');
  });

  it('exposes the transcript path', () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const writer = new TranscriptWriter(sessionId, TEST_CWD);
    expect(writer.path).toContain(sessionId);
    expect(writer.path).toMatch(/\.jsonl$/);
  });

  it('is a no-op when cwd is empty string', async () => {
    const dir = withTempDir();
    process.env.CLAUDE_CONFIG_DIR = dir;
    const sessionId = randomUUID();
    const writer = new TranscriptWriter(sessionId, '');
    await writer.writeUserMessage({ role: 'user', content: 'test' });
    // No file should be created since enabled=false for empty cwd
    expect(transcriptExists(sessionId, '')).toBe(false);
  });
});
