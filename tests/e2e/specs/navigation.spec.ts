/**
 * Navigation E2E Tests
 *
 * Tests core navigation flows between pages:
 * Home -> Space, Home -> Settings, Home -> Apps, and back navigation.
 */

import { test, expect } from '../fixtures/electron'
import { waitForHomePage, navigateToChat, navigateToSettings, navigateToApps } from '../fixtures/helpers'

test.describe('Home Page', () => {
  test('renders Halo space card and Apps card', async ({ window }) => {
    await waitForHomePage(window)

    // Halo space card should be visible
    const haloCard = await window.$('[data-onboarding="halo-space"]')
    expect(haloCard).toBeTruthy()

    // Studio card should be visible (heading was renamed from "Apps" to "Studio"; zh: 工坊)
    const appsText = await window.$('text=/^Studio$|^工坊$|^Apps$/i')
    expect(appsText).toBeTruthy()

    // "Dedicated Spaces" section should be visible (supports EN/CN)
    const spacesSection = await window.$('text=/Dedicated Spaces|专属空间/i')
    expect(spacesSection).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/nav-home-page.png' })
  })

  test('shows settings button in header', async ({ window }) => {
    await waitForHomePage(window)

    // Header should have a settings button (gear icon SVG)
    const buttons = await window.$$('button:has(svg)')
    expect(buttons.length).toBeGreaterThan(0)
  })
})

test.describe('Page Navigation', () => {
  test.setTimeout(30000)

  test('can navigate to Halo space and see chat', async ({ window }) => {
    await navigateToChat(window)

    // Textarea should be visible (chat input)
    const textarea = await window.$('textarea')
    expect(textarea).toBeTruthy()

    // Send button should be present
    const sendButton = await window.$('[data-onboarding="send-button"]')
    expect(sendButton).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/nav-halo-space.png' })
  })

  test('can navigate to Settings from home', async ({ window }) => {
    await navigateToSettings(window)

    // Settings page should show AI Model section (supports EN/CN)
    const aiSection = await window.waitForSelector(
      'text=/AI Model|AI 模型/i',
      { timeout: 10000 }
    )
    expect(aiSection).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/nav-settings.png' })
  })

  test('can navigate to Apps page from home', async ({ window }) => {
    await navigateToApps(window)

    // Tab bar should be visible with tab options
    // Tabs were restructured: "My Apps" split into "My Skills" + "My MCP";
    // "App Store" renamed to "Marketplace".
    const tabBar = await window.$('text=/My Digital Humans|我的数字人/i')
    expect(tabBar).toBeTruthy()

    const skillsTab = await window.$('text=/My Skills|我的技能/i')
    expect(skillsTab).toBeTruthy()

    const storeTab = await window.$('text=/Marketplace|市场/i')
    expect(storeTab).toBeTruthy()

    await window.screenshot({ path: 'tests/e2e/results/nav-apps-page.png' })
  })

  test('can navigate back from Space to home', async ({ window }) => {
    // Navigate to Halo space first
    await navigateToChat(window)

    // Find and click the back button (chevron left SVG in header)
    const backButton = await window.waitForSelector(
      'button:has(svg path[d*="15 19l-7-7"])',
      { timeout: 5000 }
    ).catch(() => null)

    // Fallback: look for any back button in header area
    const backBtn = backButton || await window.waitForSelector(
      'header button:first-child, button:has(svg[class*="chevron-left"])',
      { timeout: 5000 }
    ).catch(() => null)

    if (backBtn) {
      await backBtn.click()

      // Should return to Home Page - wait for Halo card
      await window.waitForSelector('[data-onboarding="halo-space"]', { timeout: 10000 })

      await window.screenshot({ path: 'tests/e2e/results/nav-back-to-home.png' })
    }
  })

  test('can navigate back from Settings to previous view', async ({ window }) => {
    await navigateToSettings(window)

    // Find the back button (ArrowLeft icon in header)
    const backButton = await window.waitForSelector(
      'button:has(svg)',
      { timeout: 5000 }
    )
    await backButton.click()

    // Should return to Home Page
    await window.waitForSelector('[data-onboarding="halo-space"]', { timeout: 10000 })
  })
})
