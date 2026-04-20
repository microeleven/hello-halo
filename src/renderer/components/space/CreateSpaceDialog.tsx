/**
 * CreateSpaceDialog
 *
 * Modal shell for creating a new dedicated space.
 * Wraps CreateSpaceForm in a centered overlay — use this when you need
 * a standalone popup (e.g. HomePage).
 *
 * For inline / accordion usage embed CreateSpaceForm directly.
 */

import { useTranslation } from '../../i18n'
import { CreateSpaceForm } from './CreateSpaceForm'
import type { Space } from '../../types'

interface CreateSpaceDialogProps {
  onClose: () => void
  onCreated: (space: Space) => void
}

export function CreateSpaceDialog({ onClose, onCreated }: CreateSpaceDialogProps) {
  const { t } = useTranslation()

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]"
      onMouseDown={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl p-6 w-full max-w-md animate-fade-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-medium mb-4">{t('Create Dedicated Space')}</h2>
        <CreateSpaceForm onCreated={onCreated} onCancel={onClose} />
      </div>
    </div>
  )
}
