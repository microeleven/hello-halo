/**
 * Codex SDK adapter public surface.
 *
 * The rest of Halo treats SDK engines as implementations of the Claude Code
 * session protocol. Codex has a different native API, so this module exposes a
 * CC-compatible facade instead of leaking Codex-specific objects upward.
 */

export { createCodexSdkModule } from './module'
export type { CodexSdkModule } from './types'
