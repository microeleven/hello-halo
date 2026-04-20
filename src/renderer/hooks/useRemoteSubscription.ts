/**
 * useRemoteSubscription
 *
 * Manages WebSocket conversation subscription lifecycle for remote/Capacitor
 * clients. In Electron mode this is a no-op (events reach the renderer via IPC
 * without subscription).
 *
 * Subscribes on mount, unsubscribes on unmount, and re-subscribes when the
 * conversationId changes. Safe to call multiple times with the same id
 * (subscribeToConversation is idempotent).
 */

import { useEffect } from 'react'
import {
  isElectron,
  subscribeToConversation,
  unsubscribeFromConversation,
} from '../api/transport'

export function useRemoteSubscription(conversationId: string): void {
  useEffect(() => {
    if (isElectron()) return
    subscribeToConversation(conversationId)
    return () => { unsubscribeFromConversation(conversationId) }
  }, [conversationId])
}
