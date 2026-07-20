/**
 * MemorySection — "What Halo knows about you".
 *
 * The transparent face of Halo's personal memory: shows the durable facts it has
 * quietly learned about the user from conversations, and lets them clear it. The
 * memory lives locally in user-memory.md; this is the window into it.
 */

import { useCallback, useEffect, useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { useTranslation } from '../../i18n'

export function MemorySection() {
  const { t } = useTranslation()
  const [atoms, setAtoms] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.halo?.memoryGetUser?.()
      setAtoms(res?.success && Array.isArray(res.data) ? (res.data as string[]) : [])
    } catch {
      setAtoms([])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const handleClear = useCallback(async () => {
    try {
      await window.halo?.memoryClearUser?.()
      await load()
    } catch {
      // best-effort
    }
  }, [load])

  return (
    <section id="personal-memory" className="bg-card rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-medium flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          {t('What Halo knows about you')}
        </h2>
        {atoms.length > 0 && (
          <button
            onClick={handleClear}
            className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('Clear all')}
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {t('Halo quietly learns durable things about you from your conversations, so it gets to know you over time. It all stays on this device — you can clear it anytime.')}
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
      ) : atoms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('Nothing learned yet. Keep chatting with Halo and it will start to know you.')}
        </p>
      ) : (
        <ul className="space-y-2">
          {atoms.map((atom, i) => (
            <li key={i} className="text-sm text-foreground flex gap-2 leading-relaxed">
              <span className="text-primary/60 flex-shrink-0 mt-0.5">•</span>
              <span>{atom}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
