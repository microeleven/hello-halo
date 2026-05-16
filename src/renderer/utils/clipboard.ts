/**
 * Copies text to clipboard with fallback for non-secure contexts (HTTP remote access).
 *
 * navigator.clipboard requires a secure context (HTTPS or localhost).
 * In web remote mode over HTTP, we fall back to the legacy execCommand approach.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text)
    return
  }

  // Fallback: create a temporary textarea and use execCommand
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.top = '0'
  el.style.left = '0'
  el.style.opacity = '0'
  el.style.pointerEvents = 'none'
  document.body.appendChild(el)
  el.focus()
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
}
