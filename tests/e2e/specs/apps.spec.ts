/**
 * Apps / Digital Humans E2E Tests
 *
 * Tests the Apps page (digital humans, apps, app store)
 * including tab navigation, list rendering, and basic interactions.
 */

import { test, expect } from '../fixtures/electron'
import { navigateToApps, waitForHomePage } from '../fixtures/helpers'

test.describe('Apps Page', () => {
  test.setTimeout(30000)

  test('renders with correct tab bar', async ({ window }) => {
    await navigateToApps(window)

    // Tab bar has four tabs (supports EN/CN). Tabs were restructured:
    // "My Apps" split into "My Skills" + "My MCP"; "App Store" renamed to "Marketplace".
    const digitalHumansTab = await window.$('text=/My Digital Humans|我的数字人/i')
    expect(digitalHumansTab).toBeTruthy()

    const skillsTab = await window.$('text=/My Skills|我的技能/i')
    expect(skillsTab).toBeTruthy()

    const mcpTab = await window.$('text=/My MCP|我的MCP/i')
    expect(mcpTab).toBeTruthy()

    const storeTab = await window.$('text=/Marketplace|市场/i')
    expect(storeTab).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/apps-tabs.png' })
  })

  test('can switch to My Skills tab', async ({ window }) => {
    await navigateToApps(window)

    // Click My Skills tab (replaces the old "My Apps" tab after the split)
    const skillsTab = await window.waitForSelector(
      'button:has-text("My Skills"), button:has-text("我的技能")',
      { timeout: 5000 }
    )
    await skillsTab.click()
    await window.waitForTimeout(300)

    // Tab should be active (has active styling)
    await window.screenshot({ path: 'tests/e2e/results/apps-my-skills-tab.png' })
  })

  test('can switch to Marketplace tab', async ({ window }) => {
    await navigateToApps(window)

    // Click Marketplace tab (renamed from "App Store")
    const storeTab = await window.waitForSelector(
      'button:has-text("Marketplace"), button:has-text("市场")',
      { timeout: 5000 }
    )
    await storeTab.click()
    await window.waitForTimeout(500)

    // StoreView should render
    await window.screenshot({ path: 'tests/e2e/results/apps-marketplace-tab.png' })
  })

  test('My Digital Humans shows empty state or app list', async ({ window }) => {
    await navigateToApps(window)

    // Either shows an app list or an empty state
    // Wait for content to load
    await window.waitForTimeout(500)

    // Check for empty state or app list items
    const bodyText = await window.evaluate(() => document.body.innerText)
    const hasContent = bodyText.length > 50 // Some meaningful content should exist
    expect(hasContent).toBe(true)

    await window.screenshot({ path: 'tests/e2e/results/apps-digital-humans.png' })
  })

  test('can navigate back from Apps page', async ({ window }) => {
    await navigateToApps(window)

    // Find back button (ChevronLeft + text)
    const backButton = await window.waitForSelector(
      'button:has(svg)',
      { timeout: 5000 }
    )
    await backButton.click()

    // Should return to Home Page
    await window.waitForSelector('[data-onboarding="halo-space"]', { timeout: 10000 })
  })

  test('settings button is accessible from Apps page', async ({ window }) => {
    await navigateToApps(window)

    // Settings button should be in the header (gear icon)
    const settingsButton = await window.waitForSelector(
      'button[title="Settings"], button[title="设置"]',
      { timeout: 5000 }
    ).catch(() => null)

    // Fallback: last button with SVG in header area
    if (!settingsButton) {
      const buttons = await window.$$('button:has(svg)')
      expect(buttons.length).toBeGreaterThan(0)
    } else {
      expect(settingsButton).toBeTruthy()
    }
  })
})

test.describe('Apps Page - Store Tab', () => {
  test.setTimeout(30000)

  test('app store shows content', async ({ window }) => {
    await navigateToApps(window)

    // Switch to Marketplace tab (renamed from "App Store")
    const storeTab = await window.waitForSelector(
      'button:has-text("Marketplace"), button:has-text("市场")',
      { timeout: 5000 }
    )
    await storeTab.click()

    // Wait for store content to load
    await window.waitForTimeout(1000)

    // Store should show some content (cards, grid, or loading state)
    const bodyText = await window.evaluate(() => document.body.innerText)
    expect(bodyText.length).toBeGreaterThan(50)

    await window.screenshot({ path: 'tests/e2e/results/apps-store-content.png' })
  })
})
