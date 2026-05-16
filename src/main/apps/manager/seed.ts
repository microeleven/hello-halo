/**
 * apps/manager -- Default App Seed
 *
 * Seeds a "Halo AI 默认数字人' default automation app when no automation-type apps
 * exist. Runs as a Tier 3 idle task so it never blocks startup. Failures
 * are logged as warnings and do not affect any functionality.
 *
 * Idempotency: subsequent launches skip seeding because an automation app
 * already exists. Skill/MCP apps are ignored — only automation apps count.
 */

import type { AppManagerService } from './types'
import type { AutomationSpec } from '../spec'

/** Space ID for the default temporary space */
const SEED_SPACE_ID = 'halo-temp'

/** Default app spec — no subscriptions (IM / manual-trigger only) */
const DEFAULT_APP_SPEC: AutomationSpec = {
  spec_version: '1',
  name: 'Halo AI 默认数字人',
  version: '1.0',
  author: 'Halo',
  description: '默认数字人，可绑定 IM 机器人或手动对话',
  type: 'automation',
  system_prompt: [
    '你是 AI 数字人，一个有用的 AI 助手。',
    '准确、简洁地回答用户的问题。',
    '如果不确定，请诚实告知。',
  ].join('\n'),
  // No subscriptions — pure IM/manual mode
}

/**
 * Seed the default app if no automation apps exist.
 *
 * Only checks automation-type apps — skill/mcp apps do not count.
 * This ensures the seed fires even when the user has installed
 * non-automation apps but has never created a digital human.
 *
 * @param appManager - The initialized AppManagerService
 */
export async function seedDefaultAppIfNeeded(appManager: AppManagerService): Promise<void> {
  const automationApps = appManager.listApps({ type: 'automation' })
  if (automationApps.length > 0) {
    console.log(`[Seed] Skipped — ${automationApps.length} automation app(s) already exist`)
    return
  }

  console.log('[Seed] No automation apps found — seeding default "AI 数字人" app')

  try {
    const appId = await appManager.install(SEED_SPACE_ID, DEFAULT_APP_SPEC)
    console.log(`[Seed] Default app installed: id=${appId}, space=${SEED_SPACE_ID}`)
  } catch (err) {
    console.warn('[Seed] Failed to seed default app (non-critical):', err)
  }
}
