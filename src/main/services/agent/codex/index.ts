/**
 * Codex SDK adapter public surface.
 *
 * The rest of Halo treats SDK engines as implementations of the Claude Code
 * session protocol. Codex has a different native API (JSON-RPC over stdio
 * to a long-running `codex app-server` child process), so this module
 * exposes a CC-compatible facade instead of leaking Codex specifics upward.
 */

export { createCodexSdkModule } from './module'
export type { CodexSdkModule } from './types'
export { CODEX_CAPABILITIES } from './capabilities'
export {
  resolveCodexPendingQuestion,
  rejectAllCodexPendingQuestions,
} from './session-adapter'
