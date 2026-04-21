import { DirType } from '@shared/constants'
import type { ShareView, StorageObject } from '@shared/types'
import { Folder, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileManager } from '@/components/files/file-manager'
import { Button } from '@/components/ui/button'
import { buildShareObjectUrl, listShareObjects } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { FilePreview } from './file-preview'
import { SaveToDriveDialog } from './save-to-drive-dialog'

interface ShareLandingProps {
  token: string
  share: ShareView
  onPasswordRequired?: () => void
}

function toStorageObject(item: {
  ref: string
  name: string
  type: string
  size: number
  isFolder: boolean
}): StorageObject {
  const now = new Date().toISOString()
  return {
    id: item.ref,
    orgId: '',
    alias: item.ref,
    name: item.name,
    type: item.type,
    size: item.size,
    dirtype: item.isFolder ? DirType.USER_FOLDER : DirType.FILE,
    parent: '',
    object: item.ref,
    storageId: '',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

export function ShareLanding({ token, share, onPasswordRequired }: ShareLandingProps) {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const isLoggedIn = !!session?.user
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [currentPath, setCurrentPath] = useState('')

  return (
    <>
      {share.matter.isFolder ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-sm">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Folder className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-2">
                <UserRound className="size-3.5" />
                <span>{t('share.readonlyHint')}</span>
              </div>
            </div>
            {isLoggedIn && (
              <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(true)}>
                {t('share.saveToDrive')}
              </Button>
            )}
          </div>

          <FileManager
            initialPath={currentPath}
            onNavigatePath={setCurrentPath}
            rootName={share.matter.name}
            dataSource={{
              queryKeyPrefix: ['share-objects', token],
              list: async (path) => {
                const response = await listShareObjects(token, path)
                return { items: response.items.map(toStorageObject) }
              },
              getPreviewFile: async (item) =>
                item.dirtype === DirType.FILE
                  ? {
                      id: item.id,
                      name: item.name,
                      type: item.type,
                      size: item.size,
                      downloadUrl: buildShareObjectUrl(token, item.id),
                    }
                  : null,
              download: async (item) => {
                window.open(buildShareObjectUrl(token, item.id), '_blank', 'noopener,noreferrer')
              },
            }}
            capabilities={{
              selection: false,
              dragAndDrop: false,
              upload: false,
              createFolder: false,
              rename: false,
              copy: false,
              move: false,
              trash: false,
              share: false,
            }}
            emptyStateLabel={t('share.folderEmpty')}
          />
        </div>
      ) : (
        <FilePreview
          token={token}
          share={share}
          isLoggedIn={isLoggedIn}
          onSaveToDrive={isLoggedIn ? () => setSaveDialogOpen(true) : undefined}
        />
      )}
      {isLoggedIn && (
        <SaveToDriveDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          token={token}
          onPasswordRequired={onPasswordRequired ?? (() => {})}
        />
      )}
    </>
  )
}
