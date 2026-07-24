import type { ShareView } from '@shared/types'
import { File } from 'lucide-react'
import { FilePreviewContent, type PreviewFile } from '@/components/preview/file-preview-content'
import { buildShareObjectUrl } from '@/lib/api'
import { getPreviewType } from '@/lib/file-types'

interface FilePreviewProps {
  token: string
  share: ShareView
}

export function FilePreview({ token, share }: FilePreviewProps) {
  const downloadUrl = buildShareObjectUrl(token, share.rootRef)
  const file: PreviewFile = {
    id: share.rootRef,
    name: share.matter.name,
    type: share.matter.type,
    size: share.matter.size,
    downloadUrl,
  }
  const previewType = getPreviewType(file.name, file.type)

  return (
    <section className="overflow-hidden rounded-xl border bg-background" aria-label={share.matter.name}>
      <header className="flex min-h-14 items-center border-b px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
            <File className="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
          <strong className="truncate text-sm font-medium">{share.matter.name}</strong>
        </div>
      </header>
      <div className="h-[70dvh] min-h-[420px] overflow-auto bg-canvas">
        <FilePreviewContent file={file} previewType={previewType} />
      </div>
    </section>
  )
}
