/**
 * Shared E2E Test Helpers
 *
 * Common navigation and interaction utilities for all E2E test specs.
 * Centralized to avoid duplication and ensure consistency.
 */

import type { Page } from '@playwright/test'

/**
 * Wait for the app to finish loading and show the Home Page.
 * The Home Page has the Halo space card and Apps card.
 */
export async function waitForHomePage(window: Page) {
  await window.waitForSelector('#root', { timeout: 15000 })
  await window.waitForLoadState('networkidle')
  // Wait for the Halo space card to appear (data-onboarding="halo-space")
  await window.waitForSelector('[data-onboarding="halo-space"]', { timeout: 15000 })
}

/**
 * Navigate from Home Page to Chat Interface (SpacePage) by clicking the Halo space card.
 * Waits for the textarea input to appear, indicating the chat is ready.
 */
export async function navigateToChat(window: Page) {
  await waitForHomePage(window)

  // Click the Halo space card
  const haloCard = await window.waitForSelector('[data-onboarding="halo-space"]', { timeout: 10000 })
  await haloCard.click()

  // Wait for chat interface to load (textarea should appear)
  await window.waitForSelector('textarea', { timeout: 15000 })
}

/**
 * Navigate from Home Page to Settings Page.
 * Settings button is in the header (gear icon).
 */
export async function navigateToSettings(window: Page) {
  await waitForHomePage(window)

  // Find settings button in header - it's the button with a gear/settings SVG
  // The header uses a Settings icon from lucide-react
  const settingsButton = await window.waitForSelector(
    'button:has(svg)',
    { timeout: 10000 }
  )
  await settingsButton.click()

  // Wait for Settings page to render
  await window.waitForSelector('text=/Settings|设置/i', { timeout: 10000 })
}

/**
 * Navigate from Home Page to Apps Page by clicking the Studio card.
 * Card heading was renamed from "Apps" to "Studio" (zh: 工坊).
 */
export async function navigateToApps(window: Page) {
  await waitForHomePage(window)

  // Click the Studio/Apps card heading (supports EN/CN, legacy "Apps")
  const appsCard = await window.waitForSelector(
    'text=/^Studio$|^工坊$|^Apps$/i',
    { timeout: 10000 }
  )
  await appsCard.click()

  // Wait for Apps page tab bar to render
  await window.waitForSelector(
    'text=/My Digital Humans|我的数字人/i',
    { timeout: 10000 }
  )
}

/**
 * Navigate to Remote Access settings section.
 * Goes through Settings page and scrolls to find Remote Access.
 */
export async function navigateToRemoteSettings(window: Page) {
  await waitForHomePage(window)

  // Navigate to Settings
  const settingsButton = await window.waitForSelector(
    'button:has(svg)',
    { timeout: 10000 }
  )
  await settingsButton.click()
  await window.waitForTimeout(500)

  // Scroll to bottom to find remote access section
  await window.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await window.waitForTimeout(500)

  // Wait for remote access section (supports both EN and CN)
  await window.waitForSelector('text=/Remote Access|远程访问/i', { timeout: 10000 })
}

/**
 * Click the remote access toggle.
 * Finds the toggle near the "Enable Remote Access" text.
 */
export async function clickRemoteToggle(window: Page) {
  await window.evaluate(() => {
    const labels = document.querySelectorAll('label')
    for (const label of labels) {
      const checkbox = label.querySelector('input[type="checkbox"]')
      if (checkbox) {
        const parent = label.closest('div')
        if (parent && (
          parent.textContent?.includes('启用远程访问') ||
          parent.textContent?.includes('Enable Remote Access')
        )) {
          label.click()
          break
        }
      }
    }
  })
}

/**
 * Send a message in the chat interface.
 * Assumes we're already on the SpacePage with textarea visible.
 */
export async function sendMessage(window: Page, message: string) {
  const chatInput = await window.waitForSelector('textarea', { timeout: 5000 })
  await chatInput.fill(message)

  const sendButton = await window.waitForSelector(
    '[data-onboarding="send-button"]',
    { timeout: 5000 }
  )
  await sendButton.click({ force: true })
}

/**
 * Wait for AI response to complete.
 * Waits for assistant message to appear and working indicator to disappear.
 */
export async function waitForAIResponse(window: Page, timeout = 45000) {
  // Wait for user message to appear
  await window.waitForSelector('.message-user', { timeout: 15000 })

  // Wait for AI response to start
  await window.waitForSelector('.message-assistant', { timeout: 30000 })

  // Wait for AI to finish working (supports both EN and CN)
  await window.waitForSelector(
    'text=/Halo 工作中|Halo is working/i',
    { state: 'hidden', timeout }
  ).catch(() => {
    // Indicator might have already disappeared
  })
}
