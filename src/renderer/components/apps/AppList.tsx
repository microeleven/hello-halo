/**
 * AppList
 *
 * Left sidebar of AppsPage. Lists installed apps for the current tab.
 *
 * Supports three modes via the `mode` prop — one per top-level tab:
 *   - 'automation': digital humans, grouped by runtime status
 *   - 'skill':      installed Skills (single group)
 *   - 'mcp':        installed MCP servers (single group)
 *
 * When the list is empty, a prominent empty state with a primary CTA is
 * shown inside the scroll area. The bottom bar always carries the
 * tab-specific add action (create digital human / manual add).
 */

import { useMemo } from 'react'
import { Plus, Store, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { InstalledApp } from '../../../shared/apps/app-types'
import type { AppType } from '../../../shared/apps/spec-types'
import { useAppsStore } from '../../stores/apps.store'
import { useAppsPageStore } from '../../stores/apps-page.store'
import { AppListItem } from './AppListItem'
import { useTranslation } from '../../i18n'

/** Which category of apps to display. One mode per top-level tab. */
export type AppListMode = 'automation' | 'skill' | 'mcp'

interface AppListProps {
  /** Primary action — for automation: create dialog; for skill/mcp: browse store */
  onInstall: () => void
  /** Secondary action — for skill/mcp tabs: open manual-add dialog */
  onManualAdd?: () => void
  /** Map from spaceId -> space name, for showing space labels on each app */
  spaceMap?: Record<string, string>
  /** Which app category to show. Defaults to 'automation'. */
  mode?: AppListMode
}

// ──────────────────────────────────────────────
// Grouping helpers
// ──────────────────────────────────────────────

type AppGroup = {
  label: string
  apps: InstalledApp[]
}

/** Group automation apps by runtime status */
function groupAutomationApps(apps: InstalledApp[]): AppGroup[] {
  const running: InstalledApp[] = []
  const waitingUser: InstalledApp[] = []
  const paused: InstalledApp[] = []
  const uninstalled: InstalledApp[] = []

  for (const app of apps) {
    if (app.status === 'uninstalled') {
      uninstalled.push(app)
    } else if (app.status === 'waiting_user') {
      waitingUser.push(app)
    } else if (app.status === 'paused') {
      paused.push(app)
    } else {
      running.push(app)
    }
  }

  const groups: AppGroup[] = []
  if (running.length > 0) groups.push({ label: 'Active', apps: running })
  if (waitingUser.length > 0) groups.push({ label: 'Waiting for you', apps: waitingUser })
  if (paused.length > 0) groups.push({ label: 'Paused', apps: paused })
  if (uninstalled.length > 0) groups.push({ label: 'Uninstalled', apps: uninstalled })
  return groups
}

/** Group single-type apps (skill or mcp) into Installed / Uninstalled */
function groupSingleType(apps: InstalledApp[], installedLabel: string): AppGroup[] {
  const installed: InstalledApp[] = []
  const uninstalled: InstalledApp[] = []
  for (const app of apps) {
    if (app.status === 'uninstalled') uninstalled.push(app)
    else installed.push(app)
  }
  const groups: AppGroup[] = []
  if (installed.length > 0) groups.push({ label: installedLabel, apps: installed })
  if (uninstalled.length > 0) groups.push({ label: 'Uninstalled', apps: uninstalled })
  return groups
}

// ──────────────────────────────────────────────
// Per-mode copy
// ──────────────────────────────────────────────

interface ModeCopy {
  /** Title shown in the empty state */
  emptyTitle: string
  /** Hint shown in the empty state */
  emptyHint: string
  /** Primary CTA label (also used in empty state) */
  primaryLabel: string
  /** Primary CTA icon */
  primaryIcon: LucideIcon
  /** Optional secondary CTA label (shown in empty state and bottom bar) */
  secondaryLabel?: string
  /** Optional secondary CTA icon */
  secondaryIcon?: LucideIcon
}

function useModeCopy(mode: AppListMode): ModeCopy {
  const { t } = useTranslation()
  switch (mode) {
    case 'skill':
      return {
        emptyTitle: t('No Skills installed yet'),
        emptyHint: t('Browse the marketplace for ready-made Skills, or add one manually'),
        primaryLabel: t('Browse Marketplace'),
        primaryIcon: Store,
        secondaryLabel: t('Manual Add Skill'),
        secondaryIcon: Upload,
      }
    case 'mcp':
      return {
        emptyTitle: t('No MCP servers connected yet'),
        emptyHint: t('Add an MCP server to extend the AI with tools and integrations'),
        primaryLabel: t('Browse Marketplace'),
        primaryIcon: Store,
        secondaryLabel: t('Manual Add MCP'),
        secondaryIcon: Upload,
      }
    case 'automation':
    default:
      return {
        emptyTitle: t('No digital humans yet'),
        emptyHint: t('Create your first digital human from a conversation'),
        primaryLabel: t('Create Digital Human'),
        primaryIcon: Plus,
      }
  }
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

const TYPE_BY_MODE: Record<Exclude<AppListMode, 'automation'>, AppType> = {
  skill: 'skill',
  mcp: 'mcp',
}

export function AppList({ onInstall, onManualAdd, spaceMap, mode = 'automation' }: AppListProps) {
  const { t } = useTranslation()
  const { apps } = useAppsStore()
  const { selectedAppId, selectApp } = useAppsPageStore()
  const copy = useModeCopy(mode)
  const PrimaryIcon = copy.primaryIcon
  const SecondaryIcon = copy.secondaryIcon

  /** Apps matching this mode (filtered by type) */
  const filteredApps = useMemo(() => {
    if (mode === 'automation') {
      return apps.filter(app => app.spec.type === 'automation')
    }
    const targetType = TYPE_BY_MODE[mode]
    return apps.filter(app => app.spec.type === targetType)
  }, [apps, mode])

  /** Groups for the current mode */
  const groups = useMemo(() => {
    if (mode === 'automation') return groupAutomationApps(filteredApps)
    const installedLabel = mode === 'skill' ? 'Skill' : 'MCP'
    return groupSingleType(filteredApps, installedLabel)
  }, [filteredApps, mode])

  const isEmpty = groups.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {isEmpty ? (
          /* Prominent empty state with CTAs */
          <div className="flex flex-col items-center justify-center gap-3 py-10 px-3 text-center">
            <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center">
              <PrimaryIcon className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{copy.emptyTitle}</p>
              <p className="text-xs text-muted-foreground mt-1">{copy.emptyHint}</p>
            </div>
            <div className="flex flex-col items-stretch gap-1.5 w-full mt-1">
              <button
                onClick={onInstall}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <PrimaryIcon className="w-4 h-4" />
                {copy.primaryLabel}
              </button>
              {copy.secondaryLabel && onManualAdd && SecondaryIcon && (
                <button
                  onClick={onManualAdd}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
                >
                  <SecondaryIcon className="w-4 h-4" />
                  {copy.secondaryLabel}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(group => (
              <div key={group.label}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
                  {t(group.label)}
                  <span className="ml-1 font-normal normal-case tracking-normal">({group.apps.length})</span>
                </p>
                <div className="space-y-0.5">
                  {group.apps.map(app => (
                    <AppListItem
                      key={app.id}
                      app={app}
                      isSelected={selectedAppId === app.id}
                      spaceName={app.spaceId ? spaceMap?.[app.spaceId] : t('Global')}
                      onClick={() => {
                        if (app.status === 'uninstalled') {
                          selectApp(app.id, 'uninstalled')
                        } else {
                          selectApp(app.id, app.spec.type, app.spaceId ?? undefined)
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom action — always present, tab-specific */}
      <div className="flex-shrink-0 border-t border-border p-2">
        {mode === 'automation' ? (
          <button
            onClick={onInstall}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            {copy.primaryLabel}
          </button>
        ) : onManualAdd && copy.secondaryLabel && SecondaryIcon ? (
          <button
            onClick={onManualAdd}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
          >
            <SecondaryIcon className="w-4 h-4" />
            {copy.secondaryLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
