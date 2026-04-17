/**
 * useDataContent - Load activity entry data from inline content or file path
 *
 * When an activity entry has `dataPath`, reads the file via the artifact API
 * and returns its content. Falls back to inline `data` string if no path or
 * if the file read fails. Supports both Electron (IPC) and remote (HTTP) modes.
 *
 * Usage:
 *   const renderedData = useDataContent(entry.content)
 *   // renderedData is the markdown string to render, or undefined
 */

import { useState, useEffect } from 'react'
import { api } from '../api'
import type { ActivityEntryContent } from '../../shared/apps/app-types'

/**
 * Resolve the renderable markdown content from an activity entry.
 *
 * Priority: dataPath (file) > data (inline string) > undefined
 *
 * @param content - The activity entry content
 * @returns The markdown string to render, or undefined if no content
 */
export function useDataContent(content: ActivityEntryContent): string | undefined {
  const inlineData = typeof content.data === 'string' ? content.data : undefined
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!content.dataPath) return

    let cancelled = false
    setLoadFailed(false)

    api.readArtifactContent(content.dataPath)
      .then((res: any) => {
        if (cancelled) return
        if (res?.success && res.data?.content) {
          setFileContent(res.data.content)
        } else {
          console.warn('[useDataContent] Unexpected response shape:', res)
          setLoadFailed(true)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[useDataContent] Failed to read file:', content.dataPath, err)
        setLoadFailed(true)
      })

    return () => { cancelled = true }
  }, [content.dataPath])

  // File content takes priority; fall back to inline data on failure or absence
  if (content.dataPath && !loadFailed && fileContent !== null) {
    return fileContent
  }
  return inlineData
}
