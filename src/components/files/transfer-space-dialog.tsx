import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError, listObjectsByPath, transferObject } from '@/lib/api'
import { useActiveOrganization, useListOrganizations } from '@/lib/auth-client'

interface TransferSpaceDialogProps {
  item: StorageObject | null
  onOpenChange: (open: boolean) => void
  onCompleted: () => void
}

type Organization = {
  id: string
  name: string
  slug: string
}

// Radix Select forbids empty-string values, so use a sentinel to represent
// "root folder" in the UI and convert to '' in the request payload.
const ROOT_PATH_SENTINEL = '__root__'

export function TransferSpaceDialog({ item, onOpenChange, onCompleted }: TransferSpaceDialogProps) {
  const { t } = useTranslation()
  const { data: orgs } = useListOrganizations()
  const { data: activeOrg } = useActiveOrganization()
  const [mode, setMode] = useState<'copy' | 'move'>('copy')
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [selectedPath, setSelectedPath] = useState(ROOT_PATH_SENTINEL)
  const [pending, setPending] = useState(false)

  const targetOrgs = ((orgs ?? []) as Organization[]).filter((org) => org.id !== activeOrg?.id)

  const foldersQuery = useQuery({
    queryKey: ['folders-for-transfer', selectedOrgId],
    queryFn: () => listObjectsByPath('', 1, 200, { type: 'folder', orgId: selectedOrgId }),
    enabled: !!selectedOrgId,
  })
  const folders = (foldersQuery.data?.items ?? []).filter((entry) => entry.dirtype !== DirType.FILE)

  function reset() {
    setMode('copy')
    setSelectedOrgId('')
    setSelectedPath(ROOT_PATH_SENTINEL)
  }

  async function handleConfirm() {
    if (!item || !selectedOrgId) return
    setPending(true)
    try {
      const result = await transferObject(item.id, {
        targetOrgId: selectedOrgId,
        targetParent: selectedPath === ROOT_PATH_SENTINEL ? '' : selectedPath,
        mode,
      })
      if (result.skipped.length > 0) {
        toast.warning(t('files.transferSkipped', { count: result.skipped.length }))
      } else {
        toast.success(mode === 'move' ? t('files.transferSuccessMove') : t('files.transferSuccessCopy'))
      }
      onCompleted()
      onOpenChange(false)
      reset()
    } catch (err) {
      if (err instanceof ApiError && err.reason === 'QUOTA_EXCEEDED') {
        toast.error(t('files.transferQuotaExceeded'))
      } else {
        toast.error(err instanceof Error ? err.message : t('common.error'))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => {
        onOpenChange(open)
        if (!open) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('files.transferTitle', { name: item?.name ?? '' })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>{t('files.transferModeLabel')}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'copy' | 'move')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="copy">{t('files.transferModeCopy')}</SelectItem>
                <SelectItem value="move">{t('files.transferModeMove')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t('files.transferSpaceLabel')}</Label>
            <Select
              value={selectedOrgId}
              onValueChange={(v) => {
                setSelectedOrgId(v)
                setSelectedPath(ROOT_PATH_SENTINEL)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('files.transferSpacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {targetOrgs.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedOrgId && (
            <div className="space-y-1">
              <Label>{t('files.transferFolderLabel')}</Label>
              <Select value={selectedPath} onValueChange={setSelectedPath}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_PATH_SENTINEL}>{t('share.folderRoot')}</SelectItem>
                  {folders.map((folder) => {
                    const fullPath = folder.parent ? `${folder.parent}/${folder.name}` : folder.name
                    return (
                      <SelectItem key={folder.id} value={fullPath}>
                        {fullPath}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {mode === 'move' ? t('files.transferMoveHint') : t('files.transferCopyHint')}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={pending || !selectedOrgId}>
            {pending ? t('common.loading') : t('files.transferConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
