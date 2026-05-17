/**
 * Model Runtime Limits — Single Source of Truth
 *
 * Shared between:
 *   - Renderer Settings UI (`ModelConfigPanel`) for input bounds and warning UI
 *   - Main process agent SDK config for env-var clamping and WARN logging
 *
 * Why split "hard cap" vs "recommended floor":
 *   We used to silently clamp `maxOutputTokens` up to 20_000 in the agent
 *   layer, which made the UI lie to the user (input said 300, runtime used
 *   20_000). The 20_000 number itself mirrors CC's internal
 *   `COMPACT_MAX_OUTPUT_TOKENS` in `utils/context.ts` and the summary call
 *   reservation in `services/compact/compact.ts:1317-1320`, but CC does not
 *   enforce a floor — it is a quality recommendation, not a wire constraint.
 *
 *   So we now treat it as a recommendation: pass the user's value through
 *   to the env var, warn loudly when it falls below the recommended floor,
 *   and surface the same warning in the UI. The user stays in control.
 *
 * Why `contextWindow` keeps a HARD floor:
 *   Below ~33K the CC autoCompactThreshold goes negative (20K summary
 *   reserve + 13K compact buffer), causing compaction to fire on every
 *   turn — the agent is effectively unusable. This is a correctness floor,
 *   not a quality one, so we still clamp.
 */

// ── maxOutputTokens ────────────────────────────────────────────────────────

/** Lower bound the agent layer will not go below (rejects 0, negative, NaN). */
export const MAX_OUTPUT_TOKENS_HARD_MIN = 1

/** Upper sanity cap for the env value. CC further caps to the model's own upper limit. */
export const MAX_OUTPUT_TOKENS_HARD_CAP = 1_000_000

/**
 * Quality recommendation — mirrors CC's `COMPACT_MAX_OUTPUT_TOKENS` (20_000).
 * Values below this may cause CC's auto-compact summary to truncate
 * mid-generation (summary p99.99 ≈ 17_387 tokens per CC source). Not enforced.
 */
export const RECOMMENDED_MIN_MAX_OUTPUT_TOKENS = 20_000

// ── contextWindow ──────────────────────────────────────────────────────────

/** Hard floor — below this, auto-compact fires every turn (see file header). */
export const CONTEXT_WINDOW_HARD_MIN = 40_000

/** Upper sanity cap — future-proof for >1M models. */
export const CONTEXT_WINDOW_HARD_CAP = 2_000_000
