/**
 * apps/runtime/prompt -- System Prompt Assembler
 *
 * Channel-agnostic three-layer assembler:
 *   Identity layer  — who am I, what do I do
 *   Entry layer     — where am I, how do I reply
 *   Constraint layer — what I must not do
 *
 * This module only joins pre-rendered string fragments. It does not
 * know about IM, native UI, App spec, or any other channel concept.
 * To add a new entry channel, build its fragment elsewhere and pass
 * the string in. The assembler should never grow channel branches.
 */

export interface AppChatPromptFragments {
  /** Identity layer fragments, in render order. */
  identity: string[]
  /** Entry layer fragment. Caller selects IM, native, or future channels. */
  entry: string
  /** Constraint layer fragments, in render order. */
  constraints: string[]
}

const SECTION_SEPARATOR = '\n\n---\n\n'

/**
 * Join the three layers into a single system prompt string.
 * Empty fragments are skipped so callers can pass conditionals freely.
 */
export function assembleAppChatPrompt(fragments: AppChatPromptFragments): string {
  return [
    ...fragments.identity,
    fragments.entry,
    ...fragments.constraints,
  ]
    .filter((section) => section && section.length > 0)
    .join(SECTION_SEPARATOR)
}
