import type { ConflictStrategy } from '@shared/schemas'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

export interface ConflictRequest {
  kind: 'file' | 'folder'
  name: string
  showApplyToAll?: boolean
}

export interface ConflictChoice {
  strategy: ConflictStrategy
  applyToAll: boolean
}

interface Props {
  request: ConflictRequest | null
  applyToAll: boolean
  onApplyToAllChange: (v: boolean) => void
  onChoose: (strategy: ConflictStrategy) => void
  onCancel: () => void
}

/**
 * Finder-style conflict dialog. Folder conflicts cannot be resolved by 'replace'
 * in v1 — only 'rename' (Keep Both) and Cancel are offered. The "Apply to all"
 * checkbox is shown only when the caller passes showApplyToAll.
 */
export function NameConflictDialog({ request, applyToAll, onApplyToAllChange, onChoose, onCancel }: Props) {
  const { t } = useTranslation()

  if (!request) return null
  const isFolder = request.kind === 'folder'

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('files.conflictTitle')}</DialogTitle>
          <DialogDescription>
            {isFolder
              ? t('files.conflictFolderMessage', { name: request.name })
              : t('files.conflictFileMessage', { name: request.name })}
          </DialogDescription>
        </DialogHeader>

        {request.showApplyToAll && (
          <div className="flex items-center gap-2 py-2">
            <Checkbox
              id="conflict-apply-all"
              checked={applyToAll}
              onCheckedChange={(v) => onApplyToAllChange(v === true)}
            />
            <Label htmlFor="conflict-apply-all" className="text-sm font-normal">
              {t('files.conflictApplyToAll')}
            </Label>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" type="button" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="outline" type="button" onClick={() => onChoose('rename')}>
            {t('files.conflictKeepBoth')}
          </Button>
          {!isFolder && (
            <Button
              variant="destructive"
              type="button"
              onClick={() => onChoose('replace')}
              title={t('files.conflictReplaceHint')}
            >
              {t('files.conflictReplace')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
