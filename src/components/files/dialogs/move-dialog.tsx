import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { ChevronRight, Folder, Home } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useFilesQuery } from '../hooks/use-files-query'

interface MoveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (targetPath: string) => void
  isPending: boolean
  excludeIds: string[]
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

export function MoveDialog({ open, onOpenChange, onConfirm, isPending, excludeIds }: MoveDialogProps) {
  const { t } = useTranslation()
  const [browsingPath, setBrowsingPath] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const query = useFilesQuery(browsingPath)

  const folders = (query.data?.items ?? []).filter(
    (item) => item.dirtype !== DirType.FILE && !excludeIds.includes(item.id),
  )

  const breadcrumb = browsingPath ? browsingPath.split('/') : []

  function navigateInto(folder: StorageObject) {
    setBrowsingPath(buildPath(browsingPath, folder.name))
    setSelectedPath(null)
  }

  function navigateToIndex(index: number) {
    if (index < 0) {
      setBrowsingPath('')
    } else {
      setBrowsingPath(breadcrumb.slice(0, index + 1).join('/'))
    }
    setSelectedPath(null)
  }

  function resetState() {
    setBrowsingPath('')
    setSelectedPath(null)
  }

  function handleConfirm() {
    onConfirm(selectedPath ?? browsingPath)
    resetState()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetState()
        onOpenChange(v)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('files.moveTo')}</DialogTitle>
        </DialogHeader>

        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <button type="button" className="hover:text-foreground" onClick={() => navigateToIndex(-1)}>
            <Home className="h-4 w-4" />
          </button>
          {breadcrumb.map((name, i) => (
            <span key={breadcrumb.slice(0, i + 1).join('/')} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <button
                type="button"
                className={i === breadcrumb.length - 1 ? 'font-medium text-foreground' : 'hover:text-foreground'}
                onClick={() => navigateToIndex(i)}
              >
                {name}
              </button>
            </span>
          ))}
        </nav>

        <div className="max-h-60 overflow-y-auto rounded-md border">
          {query.isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">{t('common.loading')}</div>
          )}
          {!query.isLoading && folders.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">{t('files.noFolders')}</div>
          )}
          {folders.map((folder) => {
            const folderPath = buildPath(browsingPath, folder.name)
            return (
              <button
                key={folder.id}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 ${selectedPath === folderPath ? 'bg-primary/10' : ''}`}
                onClick={() => setSelectedPath(folderPath)}
                onDoubleClick={() => navigateInto(folder)}
              >
                <Folder className="h-4 w-4 text-blue-500" />
                <span>{folder.name}</span>
                <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
              </button>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? t('common.loading') : t('files.moveHere')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
