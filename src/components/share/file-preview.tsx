import type { ShareView } from '@shared/types'
import { File, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FileManagerSurface } from '@/components/files/file-manager'
import { FilePreviewContent, PreviewDownloadButton, type PreviewFile } from '@/components/preview/file-preview-content'
import { Button } from '@/components/ui/button'
import { buildShareObjectUrl } from '@/lib/api'
import { getPreviewType } from '@/lib/file-types'
import { formatSize } from '@/lib/format'

interface FilePreviewProps {
  token: string
  share: ShareView
  onSaveToDrive?: () => void
  isLoggedIn: boolean
}

export function FilePreview({ token, share, onSaveToDrive, isLoggedIn }: FilePreviewProps) {
  const { t } = useTranslation()
  const downloadUrl = buildShareObjectUrl(token, share.rootRef)
  const file: PreviewFile = {
    id: share.rootRef,
    name: share.matter.name,
    type: share.matter.type,
    size: share.matter.size,
    downloadUrl,
  }
  const previewType = getPreviewType(file.name, file.type)
  const headerItems = [
    {
      label: share.matter.name,
      icon: <File className="size-4 text-muted-foreground" />,
    },
  ]
  const headerActions = (
    <>
      {isLoggedIn && onSaveToDrive && (
        <Button variant="outline" size="sm" onClick={onSaveToDrive}>
          {t('share.saveToDrive')}
        </Button>
      )}
      <PreviewDownloadButton url={downloadUrl} filename={share.matter.name} />
    </>
  )

  return (
    <FileManagerSurface
      headerItems={headerItems}
      headerMeta={[
        {
          label: t('share.sharedBy', { name: share.creatorName }),
          icon: <UserRound className="size-3 text-primary" />,
        },
        { label: formatSize(share.matter.size) },
      ]}
      headerActions={headerActions}
    >
      <div className="h-[70dvh] min-h-80 overflow-auto bg-background">
        <FilePreviewContent file={file} previewType={previewType} />
      </div>
    </FileManagerSurface>
  )
}
