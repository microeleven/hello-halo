import { useLayoutEffect, type RefObject } from 'react'

/**
 * Auto-resizes a textarea element to fit its content.
 *
 * Uses useLayoutEffect for synchronous DOM measurement before paint,
 * eliminating height-jump flicker on content changes.
 *
 * Strategy: reset height to 'auto' each cycle so scrollHeight reflects
 * true content size, then pin height to that value. CSS max-height + overflow
 * on the element controls the scroll-cap — this hook does not impose limits.
 *
 * @param ref   - Ref to the textarea element
 * @param value - Current value (used as dependency to trigger recalculation)
 */
export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string
): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Reset first so scrollHeight reflects content, not previous height
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}
