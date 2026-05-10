/**
 * Capacitor Mobile Shell — Status Bar & Safe Area
 *
 * Initializes edge-to-edge display and safe-area inset variables for the
 * Capacitor (Android) build. The page renders behind the status bar; the
 * `--safe-area-inset-top` CSS variable carries the real status bar height
 * so layouts using `var(--sat)` (see `globals.css`) push content below it.
 *
 * Source-of-truth strategy (single layer, no JS polling):
 *   1. Native `MainActivity` writes `--safe-area-inset-top` once on app
 *      start via `WebView.evaluateJavascript`. This is deterministic and
 *      runs before React mounts.
 *   2. Capacitor 8's built-in SystemBars plugin writes the same variable on
 *      Android 16+ (no-op on older versions). Either source is fine — both
 *      target the same custom property.
 *   3. A `visualViewport.resize` listener keeps the variable in sync when
 *      the keyboard opens / device rotates.
 *
 * No-ops in Electron/Web: Capacitor checks short-circuit before any work.
 */

import { isCapacitor } from './transport'

type StatusBarStyle = 'DARK' | 'LIGHT'

let _statusBarPlugin: typeof import('@capacitor/status-bar').StatusBar | null = null
let _statusBarLoadAttempted = false

async function loadStatusBar(): Promise<typeof import('@capacitor/status-bar').StatusBar | null> {
  if (_statusBarPlugin) return _statusBarPlugin
  if (_statusBarLoadAttempted) return null
  _statusBarLoadAttempted = true

  try {
    const mod = await import('@capacitor/status-bar')
    _statusBarPlugin = mod.StatusBar
    return _statusBarPlugin
  } catch (err) {
    console.warn('[SafeArea] @capacitor/status-bar unavailable:', err)
    return null
  }
}

/**
 * One-time mobile shell init. Safe to call before React mounts.
 * - Enables edge-to-edge (overlay WebView)
 * - Wires the `visualViewport.resize` listener that re-syncs `--safe-area-inset-top`
 *   when the keyboard opens or the device rotates.
 *
 * Status bar text style (DARK/LIGHT) is intentionally NOT set here — the
 * theme effect in `App.tsx` calls `syncStatusBarStyle()` once the theme
 * config has loaded. Setting an eager default here would cause a flicker
 * for users on a different theme.
 */
export async function initCapacitorMobileShell(): Promise<void> {
  if (!isCapacitor()) return

  const StatusBar = await loadStatusBar()
  if (!StatusBar) return

  try {
    await StatusBar.setOverlaysWebView({ overlay: true })
  } catch (err) {
    console.warn('[SafeArea] setOverlaysWebView failed:', err)
  }

  installViewportResizeListener()
}

/**
 * Sync status bar text style (DARK = dark text on light bg, LIGHT = light
 * text on dark bg) with the app theme. Call from the App's theme effect.
 */
export async function syncStatusBarStyle(isDark: boolean): Promise<void> {
  if (!isCapacitor()) return

  const StatusBar = await loadStatusBar()
  if (!StatusBar) return

  const style: StatusBarStyle = isDark ? 'DARK' : 'LIGHT'
  try {
    await StatusBar.setStyle({ style: style as never })
  } catch (err) {
    console.warn('[SafeArea] setStyle failed:', err)
  }
}

let _viewportListenerInstalled = false

function installViewportResizeListener(): void {
  if (_viewportListenerInstalled) return
  if (typeof window === 'undefined' || !window.visualViewport) return
  _viewportListenerInstalled = true

  const sync = () => {
    const offsetTop = window.visualViewport?.offsetTop ?? 0
    if (offsetTop > 0) {
      document.documentElement.style.setProperty(
        '--safe-area-inset-top',
        offsetTop + 'px'
      )
    }
  }

  window.visualViewport.addEventListener('resize', sync)
}
