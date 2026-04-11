/**
 * ImChatView
 *
 * Read-only viewer for IM session conversations. Displays persisted
 * message history and real-time streaming state (thoughts, browser tasks,
 * streaming text) for the selected IM session.
 *
 * No input area — IM interactions happen in the external IM channel.
 * Reuses the same atomic chat components as AppChatView for consistency.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, AlertCircle, Radio, Eraser } from 'lucide-react'
import { api } from '../../api'
import { useChatStore } from '../../stores/chat.store'
import { useSmartScroll } from '../../hooks/useSmartScroll'
import { MessageRow } from '../chat/MessageRow'
import { StreamingSection } from '../chat/StreamingSection'
import { useBrowserToolCalls } from '../chat/useBrowserToolCalls'
import { InterruptedBubble } from '../chat/InterruptedBubble'
import { CompactNotice } from '../chat/CompactNotice'
import { useTranslation } from '../../i18n'
import type { Message } from '../../types'
import type { ImSessionRecord } from '../../../shared/types/im-channel'
import { buildImSessionKey } from '../../../shared/apps/im-keys'
import { CHANNEL_LABELS } from './im-channel-labels'

interface ImChatViewProps {
  appId: string
  spaceId: string
  session: ImSessionRecord
  /** Incrementing key to trigger message reload after external clear (e.g., from ImSessionPanel) */
  clearKey?: number
}

type LoadState = 'loading' | 'loaded' | 'error' | 'empty'

export function ImChatView({ appId, spaceId, session, clearKey }: ImChatViewProps) {
  const { t } = useTranslation()

  const conversationId = buildImSessionKey(appId, session.channel, session.chatType, session.chatId)

  // Persisted messages
  const [messages, setMessages] = useState<Message[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Streaming state from chat store
  const chatSession = useChatStore(s => s.getSession(conversationId))
  const {
    isGenerating,
    streamingContent,
    isStreaming,
    thoughts,
    isThinking,
    error,
    errorType,
    compactInfo,
    textBlockVersion,
  } = chatSession

  // ── Smart scroll: auto-follow during streaming, snap after message load ──
  const { scrollToBottom, handleScroll } = useSmartScroll({
    containerRef: scrollRef,
    deps: [streamingContent, thoughts.length, isStreaming, isThinking, messages],
    behavior: 'auto',
  })

  // Browser tool calls from streaming thoughts
  const streamingBrowserToolCalls = useBrowserToolCalls(thoughts)

  // Load persisted messages
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadState('loading')
      try {
        const res = await api.appImChatMessages(appId, spaceId, session.channel, session.chatType, session.chatId)
        if (cancelled) return
        if (res.success && res.data) {
          const msgs = (res.data as Message[]) ?? []
          setMessages(msgs)
          setLoadState(msgs.length > 0 ? 'loaded' : 'empty')
        } else {
          setLoadState('empty')
        }
      } catch (err) {
        if (cancelled) return
        console.error('[ImChatView] Failed to load messages:', err)
        setLoadState('error')
      }
    }
    load()
    return () => { cancelled = true }
  }, [appId, spaceId, session.channel, session.chatType, session.chatId, clearKey])

  // Reload messages when generation starts (to show the incoming user IM message before
  // thinking begins) and when generation completes (to show the assistant response).
  const prevIsGeneratingRef = useRef(isGenerating)
  useEffect(() => {
    let cancelled = false
    const wasGenerating = prevIsGeneratingRef.current
    prevIsGeneratingRef.current = isGenerating

    if (wasGenerating !== isGenerating) {
      api.appImChatMessages(appId, spaceId, session.channel, session.chatType, session.chatId)
        .then(res => {
          if (cancelled) return
          if (res.success && res.data) {
            const msgs = (res.data as Message[]) ?? []
            setMessages(msgs)
            setLoadState(msgs.length > 0 ? 'loaded' : 'empty')
          }
        })
        .catch(err => { if (!cancelled) console.error('[ImChatView] Reload error:', err) })
    }
    return () => { cancelled = true }
  }, [isGenerating, appId, spaceId, session.channel, session.chatType, session.chatId])

  // ── Clear session (with confirmation) ──
  const resetSession = useChatStore(s => s.resetSession)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const handleClearSession = useCallback(async () => {
    try {
      const res = await api.appImChatClear(appId, spaceId, session.channel, session.chatType, session.chatId)
      if (res.success) {
        setMessages([])
        setLoadState('empty')
        resetSession(conversationId)
      }
    } catch (err) {
      console.error('[ImChatView] Clear session error:', err)
    } finally {
      setShowClearConfirm(false)
    }
  }, [appId, spaceId, session.channel, session.chatType, session.chatId, conversationId, resetSession])

  const displayName = session.customName || session.displayName || session.chatId
  const channelLabel = CHANNEL_LABELS[session.channel] ?? session.channel
  const chatTypeLabel = session.chatType === 'group' ? t('Group') : t('Direct')
  const hasStreamingContent = isGenerating && (streamingContent || thoughts.length > 0 || isThinking)

  // Loading state
  if (loadState === 'loading') {
    return (
      <div className="flex flex-col h-full">
        <ImChatInfoBar name={displayName} channel={channelLabel} chatType={chatTypeLabel} isGenerating={false} hasMessages={false} showClearConfirm={false} onClearClick={() => {}} onClearConfirm={() => {}} onClearCancel={() => {}} t={t} />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{t('Loading chat...')}</span>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (loadState === 'error') {
    return (
      <div className="flex flex-col h-full">
        <ImChatInfoBar name={displayName} channel={channelLabel} chatType={chatTypeLabel} isGenerating={false} hasMessages={false} showClearConfirm={false} onClearClick={() => {}} onClearConfirm={() => {}} onClearCancel={() => {}} t={t} />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <AlertCircle className="w-5 h-5 text-destructive" />
            <p className="text-sm">{t('Failed to load chat')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <ImChatInfoBar
        name={displayName}
        channel={channelLabel}
        chatType={chatTypeLabel}
        isGenerating={isGenerating}
        hasMessages={messages.length > 0}
        showClearConfirm={showClearConfirm}
        onClearClick={() => setShowClearConfirm(true)}
        onClearConfirm={handleClearSession}
        onClearCancel={() => setShowClearConfirm(false)}
        t={t}
      />

      {/* Message area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
        <div className="max-w-3xl mx-auto py-6 px-4">
          {/* Empty state */}
          {loadState === 'empty' && !hasStreamingContent && (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">{t('No messages yet')}</p>
            </div>
          )}

          {/* Persisted messages */}
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              hideBrowserViewButton
            />
          ))}

          {/* Live streaming content */}
          {hasStreamingContent && (
            <StreamingSection
              streamingContent={streamingContent}
              isStreaming={isStreaming}
              thoughts={thoughts}
              isThinking={isThinking}
              textBlockVersion={textBlockVersion}
              browserToolCalls={streamingBrowserToolCalls}
              showBrowserViewButton={false}
            />
          )}

          {/* Interrupted error */}
          {!isGenerating && error && errorType === 'interrupted' && (
            <div className="pb-4">
              <InterruptedBubble error={error} />
            </div>
          )}

          {/* Generic error */}
          {!isGenerating && error && errorType !== 'interrupted' && (
            <div className="flex justify-start animate-fade-in pb-4">
              <div className="w-[85%]">
                <div className="rounded-2xl px-4 py-3 bg-destructive/10 border border-destructive/30">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">{t('Something went wrong')}</span>
                  </div>
                  <p className="mt-2 text-sm text-destructive/80">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Compact notice */}
          {compactInfo && (
            <div className="pb-4">
              <CompactNotice trigger={compactInfo.trigger} preTokens={compactInfo.preTokens} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Info bar sub-component ──

interface ImChatInfoBarProps {
  name: string
  channel: string
  chatType: string
  isGenerating: boolean
  hasMessages: boolean
  showClearConfirm: boolean
  onClearClick: () => void
  onClearConfirm: () => void
  onClearCancel: () => void
  t: (key: string) => string
}

function ImChatInfoBar({ name, channel, chatType, isGenerating, hasMessages, showClearConfirm, onClearClick, onClearConfirm, onClearCancel, t }: ImChatInfoBarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30 flex-shrink-0">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-sm font-medium truncate">{name}</span>
        <span className="text-[11px] text-muted-foreground">
          {channel} · {chatType}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {isGenerating && <Radio className="w-3 h-3 text-primary animate-pulse" />}
        {showClearConfirm ? (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground/80">{t('Clear?')}</span>
            <button
              onClick={onClearConfirm}
              className="px-1.5 py-0.5 text-destructive hover:bg-destructive/10 rounded transition-colors"
            >
              {t('Confirm')}
            </button>
            <button
              onClick={onClearCancel}
              className="px-1.5 py-0.5 text-muted-foreground hover:bg-secondary rounded transition-colors"
            >
              {t('Cancel')}
            </button>
          </div>
        ) : (
          <>
            {hasMessages && !isGenerating && (
              <button
                onClick={onClearClick}
                className="p-1 rounded hover:bg-secondary transition-colors"
                title={t('Clear session')}
              >
                <Eraser className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-muted-foreground" />
              </button>
            )}
            <span>{t('Read-only · Interact via IM channel')}</span>
          </>
        )}
      </div>
    </div>
  )
}