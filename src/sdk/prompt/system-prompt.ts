/**
 * @module prompt/system-prompt
 * System prompt assembly — combines cacheable and dynamic sections.
 * @license MIT
 */

import type { Tool } from '../types/tool.js';
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from './constants.js';
import {
  introSection,
  systemSection,
  coreIdentitySection,
  toolUseGuidelinesSection,
  actionsSection,
  safetyGuidelinesSection,
  doingTasksSection,
  toneAndStyleSection,
  outputEfficiencySection,
  environmentInfoSection,
} from './sections.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemPromptConfig {
  /** Available tools (used for identity, not injected as schema — that's in ProviderRequest.tools) */
  tools: Tool[];
  /** Current working directory */
  cwd: string;
  /** Platform string (e.g. 'darwin', 'linux', 'win32') */
  platform?: string;
  /** ISO date string (e.g. '2026-04-07') */
  date?: string;
  /** Model identifier */
  model: string;
  /** Pre-loaded memory / CLAUDE.md content */
  memoryContent?: string;
  /** MCP server instructions */
  mcpInstructions?: string;
  /** Custom text appended to the end of the prompt */
  customAppend?: string;
  /** Complete system prompt replacement (skips all default sections) */
  customReplace?: string;
  /** Whether this is an SDK / non-interactive session */
  isSDK?: boolean;
}

// ---------------------------------------------------------------------------
// Attribution prefixes
// ---------------------------------------------------------------------------

function getAttributionText(isSDK: boolean): string {
  if (isSDK) {
    return 'You are a Claude agent, built on Anthropic\'s Claude Agent SDK.';
  }
  return 'You are Claude, an AI assistant by Anthropic. You help users with software engineering tasks including writing code, debugging, refactoring, explaining code, running commands, and managing projects.';
}

// ---------------------------------------------------------------------------
// Main assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the complete system prompt string.
 *
 * Structure:
 * ```
 * [CACHEABLE SECTIONS — before dynamic boundary]
 * ├── Attribution
 * ├── Intro (identity, cyber-risk, URL policy)
 * ├── # System (permissions, reminders, hooks, context)
 * ├── Core Identity + Capabilities
 * ├── Tool Use Guidelines
 * ├── Actions Section
 * ├── Safety Guidelines
 * ├── Doing Tasks Section
 * ├── Tone & Style
 * └── Output Efficiency
 *
 * __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__
 *
 * [DYNAMIC SECTIONS — after boundary]
 * ├── Environment Info
 * ├── Memory Content (if any)
 * ├── MCP Instructions (if any)
 * └── Custom Append (if any)
 * ```
 */
export function assembleSystemPrompt(config: SystemPromptConfig): string {
  // Custom replacement mode — skip all defaults
  if (config.customReplace) {
    return `${config.customReplace}\n\n${SYSTEM_PROMPT_DYNAMIC_BOUNDARY}`;
  }

  const parts: string[] = [];

  // ────────────────────────────────────────────────────────────────────────
  // CACHEABLE sections (before the dynamic boundary)
  // ────────────────────────────────────────────────────────────────────────

  // 1. Attribution header
  parts.push(getAttributionText(config.isSDK ?? false));

  // 2. Intro (identity, cyber-risk, URL policy)
  parts.push(introSection());

  // 3. # System section (permissions, system reminders, hooks, context)
  parts.push(systemSection());

  // 4. Core capabilities
  parts.push(coreIdentitySection());

  // 5. Tool use guidelines
  parts.push(toolUseGuidelinesSection());

  // 6. Executing actions with care
  parts.push(actionsSection());

  // 7. Safety guidelines
  parts.push(safetyGuidelinesSection());

  // 8. Doing tasks
  parts.push(doingTasksSection());

  // 9. Tone & style
  parts.push(toneAndStyleSection());

  // 10. Output efficiency
  parts.push(outputEfficiencySection());

  // ────────────────────────────────────────────────────────────────────────
  // Dynamic boundary marker
  // ────────────────────────────────────────────────────────────────────────
  parts.push(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);

  // ────────────────────────────────────────────────────────────────────────
  // DYNAMIC sections (after the boundary — change every turn)
  // ────────────────────────────────────────────────────────────────────────

  // 9. Environment info
  parts.push(
    environmentInfoSection({
      cwd: config.cwd,
      platform: config.platform,
      date: config.date,
    }),
  );

  // 10. Memory content (CLAUDE.md, AGENTS.md, etc.)
  if (config.memoryContent) {
    parts.push(`<memory>\n${config.memoryContent}\n</memory>`);
  }

  // 11. MCP instructions
  if (config.mcpInstructions) {
    parts.push(config.mcpInstructions);
  }

  // 12. Custom append (host-provided system prompt addition)
  if (config.customAppend) {
    parts.push(config.customAppend);
  }

  return parts.join('\n\n');
}

/**
 * Split a system prompt string at the dynamic boundary for prompt caching.
 *
 * Returns `[cacheablePart, dynamicPart]`.
 * If the boundary is not found, the entire prompt is treated as cacheable.
 */
export function splitAtBoundary(
  prompt: string,
): [cacheable: string, dynamic: string] {
  const idx = prompt.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
  if (idx === -1) {
    return [prompt, ''];
  }
  const cacheable = prompt.slice(0, idx).trimEnd();
  const dynamic = prompt
    .slice(idx + SYSTEM_PROMPT_DYNAMIC_BOUNDARY.length)
    .trimStart();
  return [cacheable, dynamic];
}
