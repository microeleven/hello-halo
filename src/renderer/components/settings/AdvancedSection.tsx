/**
 * Advanced Section Component
 * Developer-level settings: prompt profile, max turns, CLI integration
 */

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { api } from '../../api'
import type { HaloConfig } from '../../types'
import { CLIConfigSection } from './CLIConfigSection'

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
  const [enableTeams, setEnableTeamsState] = useState(config?.agent?.enableTeams ?? false)

  const handleMaxTurnsChange = async (value: number) => {
    const clamped = Math.max(10, Math.min(9999, value))
    setMaxTurnsState(clamped)
    try {
      const updatedConfig = {
        ...config,
        agent: { ...config?.agent, maxTurns: clamped }
      } as HaloConfig
      await api.setConfig({ agent: updatedConfig.agent })
      setConfig(updatedConfig)
    } catch (error) {
      console.error('[AdvancedSection] Failed to update maxTurns:', error)
      setMaxTurnsState(config?.agent?.maxTurns ?? 50)
    }
  }

  const handlePromptProfileChange = async (profile: 'official' | 'halo') => {
    setPromptProfileState(profile)
    try {
      const updatedConfig = {
        ...config,
        agent: { ...config?.agent, promptProfile: profile }
      } as HaloConfig
      await api.setConfig({ agent: updatedConfig.agent })
      setConfig(updatedConfig)
    } catch (error) {
      console.error('[AdvancedSection] Failed to update promptProfile:', error)
      setPromptProfileState(config?.agent?.promptProfile ?? 'halo')
    }
  }

  const handleEnableTeamsChange = async (enabled: boolean) => {
    setEnableTeamsState(enabled)
    try {
      const updatedConfig = {
        ...config,
        agent: { ...config?.agent, enableTeams: enabled }
      } as HaloConfig
      await api.setConfig({ agent: updatedConfig.agent })
      setConfig(updatedConfig)
    } catch (error) {
      console.error('[AdvancedSection] Failed to update enableTeams:', error)
      setEnableTeamsState(config?.agent?.enableTeams ?? false)
    }
  }

  return (
    <section id="advanced" className="bg-card rounded-xl border border-border p-6">
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

        {/* Agent Teams */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <div className="flex-1">
            <p className="font-medium">{t('Agent Teams')}</p>
            <p className="text-sm text-muted-foreground">
              {t('Enable multi-agent collaboration. When enabled, the AI can spawn teammate agents to work in parallel. Consumes additional tokens and context.')}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
            <input
              type="checkbox"
              checked={enableTeams}
              onChange={(e) => handleEnableTeamsChange(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-secondary rounded-full peer peer-checked:bg-primary transition-colors">
              <div
                className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${
                  enableTeams ? 'translate-x-5' : 'translate-x-0.5'
                } mt-0.5`}
              />
            </div>
          </label>
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

        {/* Claude CLI Integration */}
        <CLIConfigSection />
      </div>
    </section>
  )
}
