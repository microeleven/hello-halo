/**
 * Advanced Section Component
 * Developer-level settings: prompt profile, extended capabilities, max turns, CLI integration
 */

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Puzzle, Terminal } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { api } from '../../api'
import type { HaloConfig } from '../../types'
import { CLIConfigSection } from './CLIConfigSection'
import { Switch } from '../ui/Switch'

// ─── Extended Capabilities ──────────────────────────────────────────────────────

/**
 * Capability groups shown in the Extended Capabilities panel.
 * Each group maps a user-facing feature toggle to the underlying CC tools it controls.
 *
 * When a capability is disabled, its tools are added to `config.agent.disabledTools`,
 * which flows to the SDK's `disallowedTools` option — completely hiding them from
 * the model (saving tokens).
 */
const CAPABILITY_GROUPS = [
  {
    id: 'teams',
    labelKey: 'Agent Teams',
    descKey: 'Multi-agent collaboration. Agents can spawn teammates to work in parallel.',
    tools: ['TeamCreate', 'TeamDelete', 'SendMessage'],
  },
  {
    id: 'planMode',
    labelKey: 'Plan Mode',
    descKey: 'Step-by-step planning workflow with approval gates.',
    tools: ['EnterPlanMode', 'ExitPlanMode'],
  },
  {
    id: 'worktree',
    labelKey: 'Git Worktree',
    descKey: 'Isolated git worktree for parallel branch work.',
    tools: ['EnterWorktree', 'ExitWorktree'],
  },
  {
    id: 'cron',
    labelKey: 'Scheduled Tasks',
    descKey: 'Built-in cron job scheduling. Halo has its own automation system.',
    tools: ['CronCreate', 'CronDelete', 'CronList'],
  },
  {
    id: 'notebook',
    labelKey: 'Notebook Editing',
    descKey: 'Jupyter notebook (.ipynb) cell editing.',
    tools: ['NotebookEdit'],
  },
] as const

import { DEFAULT_DISABLED_TOOLS } from '../../../shared/constants/disabled-tools'

// ─── Component ──────────────────────────────────────────────────────────────────

interface AdvancedSectionProps {
  config: HaloConfig | null
  setConfig: (config: HaloConfig) => void
}

export function AdvancedSection({ config, setConfig }: AdvancedSectionProps) {
  const { t } = useTranslation()

  const [maxTurns, setMaxTurnsState] = useState(config?.agent?.maxTurns ?? 50)
  const [promptProfile, setPromptProfileState] = useState<'official' | 'halo'>(
    config?.agent?.promptProfile ?? 'halo'
  )
  const [disabledTools, setDisabledToolsState] = useState<string[]>(
    config?.agent?.disabledTools ?? DEFAULT_DISABLED_TOOLS
  )
  const [developerMode, setDeveloperModeState] = useState(config?.agent?.developerMode ?? false)
  const [capsPanelOpen, setCapsPanelOpen] = useState(false)

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const isCapabilityEnabled = (group: typeof CAPABILITY_GROUPS[number]) =>
    group.tools.every(tool => !disabledTools.includes(tool))

  const saveAgentConfig = async (patch: Partial<NonNullable<HaloConfig['agent']>>) => {
    const updatedConfig = {
      ...config,
      agent: { ...config?.agent, ...patch }
    } as HaloConfig
    await api.setConfig({ agent: updatedConfig.agent })
    setConfig(updatedConfig)
    return updatedConfig
  }

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleMaxTurnsChange = async (value: number) => {
    const clamped = Math.max(10, Math.min(9999, value))
    setMaxTurnsState(clamped)
    try {
      await saveAgentConfig({ maxTurns: clamped })
    } catch (error) {
      console.error('[AdvancedSection] Failed to update maxTurns:', error)
      setMaxTurnsState(config?.agent?.maxTurns ?? 50)
    }
  }

  const handlePromptProfileChange = async (profile: 'official' | 'halo') => {
    setPromptProfileState(profile)
    try {
      await saveAgentConfig({ promptProfile: profile })
    } catch (error) {
      console.error('[AdvancedSection] Failed to update promptProfile:', error)
      setPromptProfileState(config?.agent?.promptProfile ?? 'halo')
    }
  }

  const handleCapabilityToggle = async (group: typeof CAPABILITY_GROUPS[number], enabled: boolean) => {
    const currentEnabled = isCapabilityEnabled(group)
    if (currentEnabled === enabled) return

    let newDisabled: string[]
    if (enabled) {
      // Remove this group's tools from disabled list
      newDisabled = disabledTools.filter(t => !(group.tools as readonly string[]).includes(t))
    } else {
      // Add this group's tools to disabled list (dedup)
      const set = new Set(disabledTools)
      for (const tool of group.tools) set.add(tool)
      newDisabled = Array.from(set)
    }
    setDisabledToolsState(newDisabled)

    try {
      // Agent Teams needs the dedicated enableTeams flag for env var
      const extraPatch: Partial<NonNullable<HaloConfig['agent']>> = {}
      if (group.id === 'teams') {
        extraPatch.enableTeams = enabled
      }
      await saveAgentConfig({ disabledTools: newDisabled, ...extraPatch })
    } catch (error) {
      console.error('[AdvancedSection] Failed to update capability:', error)
      setDisabledToolsState(config?.agent?.disabledTools ?? DEFAULT_DISABLED_TOOLS)
    }
  }

  const handleDeveloperModeChange = async (enabled: boolean) => {
    setDeveloperModeState(enabled)
    try {
      await saveAgentConfig({ developerMode: enabled })
    } catch (error) {
      console.error('[AdvancedSection] Failed to update developerMode:', error)
      setDeveloperModeState(config?.agent?.developerMode ?? false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <section id="advanced" className="bg-card rounded-xl border border-border p-4 sm:p-6">
      <h2 className="text-lg font-medium mb-4">{t('Advanced')}</h2>

      {/* Warning banner */}
      <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-5 text-sm text-amber-600 dark:text-amber-400">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{t('Changes here affect all AI agent behavior. New settings take effect on the next conversation.')}</span>
      </div>

      <div className="space-y-4">
        {/* System Prompt Profile */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="font-medium">{t('System Prompt Profile')}</p>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            {t('Choose the system prompt template used by the claude code agent')}
          </p>

          <div className="space-y-2">
            {/* Official */}
            <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="promptProfile"
                value="official"
                checked={promptProfile === 'official'}
                onChange={() => handlePromptProfileChange('official')}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="font-medium text-sm">{t('Official')}</p>
                <p className="text-xs text-muted-foreground">{t('Base prompt without Halo-specific optimizations')}</p>
              </div>
            </label>

            {/* Halo Optimized */}
            <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/50 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="promptProfile"
                value="halo"
                checked={promptProfile === 'halo'}
                onChange={() => handlePromptProfileChange('halo')}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="font-medium text-sm">{t('Halo Optimized')}</p>
                <p className="text-xs text-muted-foreground">{t('Includes Halo-specific improvements (Web Research strategy, etc.)')}</p>
              </div>
            </label>
          </div>
        </div>

        {/* Extended Capabilities */}
        <div className="pt-4 border-t border-border">
          <div className="border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setCapsPanelOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                <Puzzle className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">{t('Extended Capabilities')}</span>
              </div>
              {capsPanelOpen
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />
              }
            </button>

            {capsPanelOpen && (
              <div className="border-t border-border">
                {/* Hint */}
                <p className="px-4 pt-3 pb-2 text-xs text-muted-foreground">
                  {t('Extra tools consume additional tokens per message. Enable only what you need.')}
                </p>

                {/* Capability toggles */}
                <div className="px-4 pb-4 space-y-0">
                  {CAPABILITY_GROUPS.map((group, idx) => {
                    const enabled = isCapabilityEnabled(group)
                    return (
                      <div
                        key={group.id}
                        className={`flex items-center justify-between py-3 ${
                          idx > 0 ? 'border-t border-border' : ''
                        }`}
                      >
                        <div className="flex-1 min-w-0 mr-3">
                          <p className="font-medium text-sm">{t(group.labelKey)}</p>
                          <p className="text-xs text-muted-foreground">{t(group.descKey)}</p>
                        </div>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) => handleCapabilityToggle(group, checked)}
                          size="sm"
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Max Turns per Message */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">{t('Max Turns per Message')}</p>
              <span
                className="inline-flex items-center justify-center w-4 h-4 text-xs rounded-full bg-muted text-muted-foreground cursor-help"
                title={t('Maximum number of tool call rounds the AI agent can execute per message')}
              >
                ?
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('Maximum number of tool call rounds the AI agent can execute per message')}
            </p>
          </div>
          <input
            type="number"
            min={10}
            max={9999}
            value={maxTurns}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val)) {
                setMaxTurnsState(val)
              }
            }}
            onBlur={(e) => {
              const val = parseInt(e.target.value, 10)
              if (!isNaN(val)) {
                handleMaxTurnsChange(val)
              }
            }}
            className="w-24 px-3 py-1.5 text-sm bg-secondary border border-border rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Developer Mode */}
        <div className="flex items-start justify-between pt-4 border-t border-border">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Terminal className="w-4 h-4 text-muted-foreground shrink-0" />
              <p className="font-medium">{t('Developer Mode')}</p>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                {t('Dev')}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('Enable verbose logging for troubleshooting: HTTP request payloads, session lifecycle, stream events, and scheduler diagnostics.')}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              {t('Generates large log files and may affect performance. Disable after troubleshooting.')}
            </p>
          </div>
          <Switch
            checked={developerMode}
            onCheckedChange={handleDeveloperModeChange}
            size="sm"
            className="ml-4 mt-0.5"
          />
        </div>

        {/* Claude CLI Integration */}
        <CLIConfigSection />
      </div>
    </section>
  )
}
