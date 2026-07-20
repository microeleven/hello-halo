/**
 * Settings Navigation Configuration
 * Data-driven navigation items for the settings page
 */

import { Bot, Palette, Settings, Globe, Info, Bell, Store, Code, Heart, Sparkles } from 'lucide-react'
import type { SettingsNavItem } from './types'

/**
 * Navigation items for settings sidebar
 * Order determines display order in the navigation
 */
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    id: 'ai-model',
    labelKey: 'AI Model',
    icon: Bot
  },
  {
    id: 'message-channels',
    labelKey: 'Message Channels',
    icon: Bell
  },
  {
    id: 'app-store',
    labelKey: 'App Store',
    icon: Store
  },
  {
    id: 'appearance',
    labelKey: 'Appearance',
    icon: Palette
  },
  {
    id: 'personal-memory',
    labelKey: 'What Halo knows about you',
    icon: Sparkles,
    desktopOnly: true
  },
  {
    id: 'system',
    labelKey: 'System',
    icon: Settings,
    desktopOnly: true
  },
  {
    id: 'advanced',
    labelKey: 'Advanced',
    icon: Code,
    desktopOnly: true
  },
  {
    id: 'remote',
    labelKey: 'Remote Access',
    icon: Globe,
    desktopOnly: true
  },
  {
    id: 'recommend',
    labelKey: 'Recommend Halo',
    icon: Heart
  },
  {
    id: 'about',
    labelKey: 'About',
    icon: Info
  }
]

/**
 * Get filtered navigation items based on mode
 * @param isRemoteMode - Whether running in remote/web mode
 */
export function getFilteredNavItems(isRemoteMode: boolean): SettingsNavItem[] {
  return SETTINGS_NAV_ITEMS.filter(item => !item.desktopOnly || !isRemoteMode)
}
