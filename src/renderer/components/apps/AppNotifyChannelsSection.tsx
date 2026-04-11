/**
 * AppNotifyChannelsSection (数字人通知方式)
 *
 * Visual channel selector for digital human configuration.
 * Shows all available message channels with their configuration status:
 *
 * - Configured channels: checkbox to enable/disable for this app
 * - Unconfigured channels: grayed out with "Go to Settings" link
 * - Bidirectional channels (e.g. WeCom Bot): expand to show IM sessions
 *   with proactive push toggles
 *
 * One-way channels write to `output.notify.channels` in the app spec.
 * Bidirectional channels use IM session proactive push (managed inline).
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Mail, MessageSquare, Bell, Webhook,
  ExternalLink, ChevronDown,
} from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useAppStore } from '../../stores/app.store'
import { useAppsStore } from '../../stores/apps.store'
import { api } from '../../api'
import { ImSessionsSection } from '../settings/ImSessionsSection'
import type { HaloConfig } from '../../types'
import type {
  NotificationChannelType,
  NotificationChannelsConfig,
} from '../../../shared/types/notification-channels'
import { NOTIFICATION_CHANNEL_META } from '../../../shared/types/notification-channels'
import type { ImChannelInstanceStatus } from '../../../shared/types/im-channel'

// ============================================
// Types
// ============================================

interface AppNotifyChannelsSectionProps {
  appId: string
  /** Current selected channels from app spec output.notify.channels */
  selectedChannels: NotificationChannelType[]
  /** App name for IM sessions display */
  appName?: string
}

/** Channel display definition */
interface ChannelInfo {
  id: string
  notifyType?: NotificationChannelType
  icon: typeof Mail
  labelKey: string
  direction: 'one-way' | 'bidirectional'
}

// ============================================
// Channel Registry
// ============================================

const ALL_CHANNELS: ChannelInfo[] = [
  {
    id: 'wecom-bot',
    icon: MessageSquare,
    labelKey: 'WeCom Intelligent Bot',
    direction: 'bidirectional',
  },
  {
    id: 'email',
    notifyType: 'email',
    icon: Mail,
    labelKey: NOTIFICATION_CHANNEL_META.email.labelKey,
    direction: 'one-way',
  },
  {
    id: 'wecom',
    notifyType: 'wecom',
    icon: MessageSquare,
    labelKey: NOTIFICATION_CHANNEL_META.wecom.labelKey,
    direction: 'one-way',
  },
  {
    id: 'dingtalk',
    notifyType: 'dingtalk',
    icon: Bell,
    labelKey: NOTIFICATION_CHANNEL_META.dingtalk.labelKey,
    direction: 'one-way',
  },
  {
    id: 'feishu',
    notifyType: 'feishu',
    icon: MessageSquare,
    labelKey: NOTIFICATION_CHANNEL_META.feishu.labelKey,
    direction: 'one-way',
  },
  {
    id: 'webhook',
    notifyType: 'webhook',
    icon: Webhook,
    labelKey: NOTIFICATION_CHANNEL_META.webhook.labelKey,
    direction: 'one-way',
  },
]

// ============================================
// Helpers
// ============================================

interface ChannelStatus {
  configured: boolean
  connected?: boolean // only for bidirectional
}

function getChannelStatuses(
  config: HaloConfig | null,
  imStatuses: ImChannelInstanceStatus[],
): Record<string, ChannelStatus> {
  const statuses: Record<string, ChannelStatus> = {}

  // Bidirectional IM channels — derive from runtime instance statuses
  // This supports multi-instance: configured = any enabled instance exists,
  // connected = any instance is connected.
  for (const ch of ALL_CHANNELS) {
    if (ch.direction === 'bidirectional') {
      const instances = imStatuses.filter(s => s.type === ch.id)
      const anyEnabled = instances.some(s => s.enabled)
      const anyConnected = instances.some(s => s.connected)
      statuses[ch.id] = {
        configured: anyEnabled,
        connected: anyEnabled ? anyConnected : undefined,
      }
    }
  }

  // One-way notification channels — from global config
  const channels = config?.notificationChannels as NotificationChannelsConfig | undefined
  for (const ch of ALL_CHANNELS) {
    if (ch.notifyType && channels) {
      const raw = channels[ch.notifyType] as { enabled?: boolean } | undefined
      statuses[ch.id] = { configured: Boolean(raw?.enabled) }
    }
  }

  return statuses
}

// ============================================
// Channel Row
// ============================================

interface ChannelRowProps {
  channel: ChannelInfo
  status: ChannelStatus
  checked: boolean
  onToggle: () => void
  onGoToSettings: () => void
  /** For bidirectional channels: whether IM sessions are expanded */
  expanded?: boolean
  onToggleExpand?: () => void
  children?: React.ReactNode
}

function ChannelRow({
  channel,
  status,
  checked,
  onToggle,
  onGoToSettings,
  expanded,
  onToggleExpand,
  children,
}: ChannelRowProps) {
  const { t } = useTranslation()
  const Icon = channel.icon
  const isBidirectional = channel.direction === 'bidirectional'

  if (!status.configured) {
    // Unconfigured: grayed out with "Go to Settings" link
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg opacity-50">
        <div className="w-5 h-5 rounded border border-border bg-muted flex-shrink-0" />
        <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">{t(channel.labelKey)}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              isBidirectional
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}>
              {isBidirectional ? t('Bidirectional') : t('One-way')}
            </span>
          </div>
          <p className="text-xs text-muted-foreground/60 mt-0.5">{t('Not configured')}</p>
        </div>
        <button
          type="button"
          onClick={onGoToSettings}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors flex-shrink-0"
        >
          {t('Go to Settings')}
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    )
  }

  // Configured channel
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors">
        {/* Checkbox */}
        <label className="relative flex-shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="sr-only peer"
          />
          <div className="w-5 h-5 rounded border border-border bg-muted peer-checked:bg-primary peer-checked:border-primary transition-colors flex items-center justify-center">
            {checked && (
              <svg className="w-3 h-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </label>

        {/* Channel info */}
        <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-foreground">{t(channel.labelKey)}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              isBidirectional
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}>
              {isBidirectional ? t('Bidirectional') : t('One-way')}
            </span>
          </div>
        </div>

        {/* Status + expand toggle for bidirectional */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isBidirectional && status.connected !== undefined && (
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${status.connected ? 'bg-green-500' : 'bg-amber-500'}`} />
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {status.connected ? t('Connected') : t('Disconnected')}
              </span>
            </div>
          )}
          {!isBidirectional && (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-xs text-muted-foreground hidden sm:inline">{t('Configured')}</span>
            </div>
          )}
          {isBidirectional && onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
            >
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded content (IM sessions for bidirectional channels) */}
      {isBidirectional && expanded && children && (
        <div className="px-3 pb-3 border-t border-border pt-2 animate-in slide-in-from-top-1 duration-150">
          {children}
        </div>
      )}
    </div>
  )
}

// ============================================
// Main Component
// ============================================

export function AppNotifyChannelsSection({ appId, selectedChannels, appName }: AppNotifyChannelsSectionProps) {
  const { t } = useTranslation()
  const { setView } = useAppStore()
  const { updateAppSpec } = useAppsStore()

  const [globalConfig, setGlobalConfig] = useState<HaloConfig | null>(null)
  const [imStatuses, setImStatuses] = useState<ImChannelInstanceStatus[]>([])
  const [expandedBidirectional, setExpandedBidirectional] = useState<Set<string>>(new Set(['wecom-bot']))

  // Fetch global config to determine one-way channel statuses
  useEffect(() => {
    let cancelled = false
    async function fetch() {
      try {
        const res = await api.getConfig() as { success: boolean; data?: HaloConfig }
        if (!cancelled && res.success && res.data) {
          setGlobalConfig(res.data)
        }
      } catch {
        // Ignore
      }
    }
    fetch()
    return () => { cancelled = true }
  }, [])

  // Poll IM channel instance statuses (covers all bidirectional channels)
  useEffect(() => {
    let cancelled = false
    async function fetchStatuses() {
      try {
        const res = await api.imChannelsStatus() as { success: boolean; data?: ImChannelInstanceStatus[] }
        if (!cancelled && res.success && res.data) {
          setImStatuses(res.data)
        }
      } catch {
        // Ignore
      }
    }
    fetchStatuses()
    const interval = setInterval(fetchStatuses, 15_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const channelStatuses = getChannelStatuses(globalConfig, imStatuses)

  // Toggle a one-way notification channel
  const handleToggleChannel = useCallback(async (notifyType: NotificationChannelType) => {
    const current = new Set(selectedChannels)
    if (current.has(notifyType)) {
      current.delete(notifyType)
    } else {
      current.add(notifyType)
    }
    const channels = [...current]
    await updateAppSpec(appId, {
      output: {
        notify: {
          channels: channels.length > 0 ? channels : undefined,
        },
      },
    })
  }, [appId, selectedChannels, updateAppSpec])

  const handleGoToSettings = useCallback(() => {
    setView('settings')
    // Scroll to message-channels section after navigation
    setTimeout(() => {
      const el = document.getElementById('message-channels')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [setView])

  const toggleBidirectionalExpand = useCallback((channelId: string) => {
    setExpandedBidirectional(prev => {
      const next = new Set(prev)
      if (next.has(channelId)) {
        next.delete(channelId)
      } else {
        next.add(channelId)
      }
      return next
    })
  }, [])

  return (
    <div className="space-y-2">
      {ALL_CHANNELS.map((channel) => {
        const status = channelStatuses[channel.id] ?? { configured: false }
        const isBidirectional = channel.direction === 'bidirectional'

        // For one-way channels, "checked" means it's in output.notify.channels
        // For bidirectional channels, "checked" means it's configured (IM sessions handle the rest)
        const checked = isBidirectional
          ? status.configured
          : Boolean(channel.notifyType && selectedChannels.includes(channel.notifyType))

        return (
          <ChannelRow
            key={channel.id}
            channel={channel}
            status={status}
            checked={checked}
            onToggle={() => {
              if (channel.notifyType) {
                handleToggleChannel(channel.notifyType)
              }
            }}
            onGoToSettings={handleGoToSettings}
            expanded={isBidirectional ? expandedBidirectional.has(channel.id) : undefined}
            onToggleExpand={isBidirectional ? () => toggleBidirectionalExpand(channel.id) : undefined}
          >
            {/* IM Sessions for bidirectional channels */}
            {isBidirectional && (
              <ImSessionsSection appId={appId} appName={appName} compact />
            )}
          </ChannelRow>
        )
      })}
    </div>
  )
}
