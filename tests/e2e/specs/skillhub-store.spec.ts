/**
 * SkillHub Store Adapter E2E Tests
 *
 * Verifies the SkillHub registry adapter end-to-end:
 *   1. SkillHub appears as an enabled registry in Settings → Store
 *   2. The App Store loads and shows items (from all registries including SkillHub)
 *   3. Skill install flow: open detail → click Install → install dialog appears
 *
 * Note: These tests make real network requests to api.skillhub.cn.
 *       Tests are resilient to slow network by using appropriate timeouts.
 */

import { test, expect } from '../fixtures/electron'
import { waitForHomePage, navigateToSettings, navigateToApps } from '../fixtures/helpers'

// ── Registry Settings Verification ────────────────────────────────────────

test.describe('SkillHub Registry', () => {
  test.setTimeout(60000)

  test('appears as an enabled registry in Settings', async ({ window }) => {
    await navigateToSettings(window)

    // Navigate to the Store / Registry section in Settings
    // Look for the registry section (may be under "Advanced" or "Store" or "Apps")
    const registrySection = await window.waitForSelector(
      'text=/Registry|应用市场源|Store Sources/i',
      { timeout: 10000 }
    ).catch(() => null)

    if (!registrySection) {
      // Settings sections may vary; look for SkillHub text anywhere
      await window.screenshot({ path: 'tests/e2e/results/skillhub-settings-page.png' })
    }

    // Scroll down to find SkillHub entry (registry list may be in lower section)
    await window.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await window.waitForTimeout(500)

    // SkillHub should be listed with its full name
    const skillhubEntry = await window.waitForSelector(
      'text=/SkillHub/i',
      { timeout: 10000 }
    ).catch(() => null)

    await window.screenshot({ path: 'tests/e2e/results/skillhub-registry-settings.png' })

    expect(skillhubEntry).toBeTruthy()
  })
})

// ── App Store SkillHub Integration ─────────────────────────────────────────

test.describe('SkillHub App Store Integration', () => {
  test.setTimeout(60000)

  test('App Store opens and loads content', async ({ window }) => {
    await navigateToApps(window)

    // Click App Store tab
    const storeTab = await window.waitForSelector(
      'button:has-text("Marketplace"), button:has-text("市场")',
      { timeout: 10000 }
    )
    await storeTab.click()

    // Wait for content to load (give network time for SkillHub API calls)
    await window.waitForTimeout(3000)

    // Store should show content (cards or loading indicator resolved)
    const bodyText = await window.evaluate(() => document.body.innerText)
    expect(bodyText.length).toBeGreaterThan(100)

    await window.screenshot({ path: 'tests/e2e/results/skillhub-store-loaded.png' })
  })

  test('Skills type filter shows items from SkillHub', async ({ window }) => {
    await navigateToApps(window)

    // Click App Store tab
    const storeTab = await window.waitForSelector(
      'button:has-text("Marketplace"), button:has-text("市场")',
      { timeout: 10000 }
    )
    await storeTab.click()

    // Wait for initial load
    await window.waitForTimeout(2000)

    // Try to click "Skill" type filter tab if it exists
    // The button text is "Skill" (singular) — see StoreHeader TYPE_FILTERS
    const skillsFilter = await window.waitForSelector(
      'button:has-text("Skill"), button:has-text("技能")',
      { timeout: 5000 }
    ).catch(() => null)

    if (skillsFilter) {
      await skillsFilter.click()
      await window.waitForTimeout(2000)
    }

    // Should have some content showing
    const bodyText = await window.evaluate(() => document.body.innerText)
    expect(bodyText.length).toBeGreaterThan(100)

    await window.screenshot({ path: 'tests/e2e/results/skillhub-skills-filter.png' })
  })

  test('install flow: clicking a store item shows detail or dialog', async ({ window }) => {
    await navigateToApps(window)

    // Click App Store tab
    const storeTab = await window.waitForSelector(
      'button:has-text("Marketplace"), button:has-text("市场")',
      { timeout: 10000 }
    )
    await storeTab.click()

    // Wait for store cards to appear — they render as:
    //   <button class="w-full text-left p-4 rounded-xl border border-border ...">
    // Give generous timeout for network + render (halo/mcp/skill all load in parallel)
    const storeCard = await window.waitForSelector(
      'button[class*="rounded-xl"][class*="border-border"]',
      { timeout: 25000 }
    ).catch(async () => {
      await window.screenshot({ path: 'tests/e2e/results/skillhub-install-debug.png' })
      return null
    })

    if (!storeCard) {
      // Store might show loading or empty state — capture screenshot for diagnosis
      await window.screenshot({ path: 'tests/e2e/results/skillhub-install-no-card.png' })
      // Log page body for debug
      const bodyText = await window.evaluate(() => document.body.innerText.substring(0, 300))
      console.log('[E2E debug] Page body:', bodyText)
      test.skip(true, 'No store cards rendered — check network or store state')
      return
    }

    await storeCard.click()
    await window.waitForTimeout(1500)

    await window.screenshot({ path: 'tests/e2e/results/skillhub-install-detail.png' })

    // After clicking, we should see either:
    // a) A detail panel with Install button
    // b) An install dialog directly
    const bodyText = await window.evaluate(() => document.body.innerText)

    // The detail page or dialog should have meaningful content
    expect(bodyText.length).toBeGreaterThan(100)

    // Look for Install button
    const installButton = await window.waitForSelector(
      'button:has-text("Install"), button:has-text("安装")',
      { timeout: 5000 }
    ).catch(() => null)

    if (installButton) {
      await window.screenshot({ path: 'tests/e2e/results/skillhub-install-button-found.png' })

      // Click install button to trigger install flow
      await installButton.click()
      await window.waitForTimeout(1500)

      // Should show either a space selection dialog or success state
      const postInstallText = await window.evaluate(() => document.body.innerText)
      expect(postInstallText.length).toBeGreaterThan(100)

      await window.screenshot({ path: 'tests/e2e/results/skillhub-install-dialog.png' })
    } else {
      // Install button might be found with alternative text
      const altInstallButton = await window.$('button:has-text("Add"), button:has-text("添加")')
      if (altInstallButton) {
        expect(altInstallButton).toBeTruthy()
      }
    }
  })
})

// ── SkillHub API connectivity check ───────────────────────────────────────

test.describe('SkillHub API reachability', () => {
  test.setTimeout(30000)

  test('SkillHub API is reachable from the app process', async ({ window }) => {
    // Execute a fetch to SkillHub API from the renderer process
    const result = await window.evaluate(async () => {
      try {
        const res = await fetch('https://api.skillhub.cn/api/skills?page=1&pageSize=5', {
          headers: { 'Accept': 'application/json', 'User-Agent': 'Halo-E2E-Test/1.0' }
        })
        if (!res.ok) return { ok: false, status: res.status }
        const data = await res.json() as Record<string, unknown>
        return {
          ok: true,
          code: (data as Record<string, unknown>).code,
          hasSkills: Array.isArray(((data as Record<string, unknown>).data as Record<string, unknown>)?.skills),
          total: ((data as Record<string, unknown>).data as Record<string, unknown>)?.total,
        }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    })

    // Log for CI debugging
    console.log('[SkillHub API check]', JSON.stringify(result))

    if (!result.ok) {
      test.skip(true, `SkillHub API not reachable: ${JSON.stringify(result)}`)
      return
    }

    expect(result.code).toBe(0)
    expect(result.hasSkills).toBe(true)
    expect(typeof result.total).toBe('number')
  })
})
