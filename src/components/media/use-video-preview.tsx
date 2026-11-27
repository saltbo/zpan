import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { PreviewFile } from '@/components/preview/file-preview-content'
import { FilePreviewDialog } from '@/components/preview/file-preview-dialog'
import { getObject } from '@/lib/api'

// Plays a video in the file preview: fetches its download URL when asked and
// renders the preview dialog. `opening` holds the id being fetched.
export function useVideoPreview() {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<PreviewFile | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  async function play(id: string) {
    setOpening(id)
    try {
      const video = await getObject(id)
      if (!video.downloadUrl) throw new Error(t('common.error'))
      setPreview({
        id: video.id,
        name: video.name,
        type: video.type,
        size: video.size ?? 0,
        downloadUrl: video.downloadUrl,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setOpening(null)
    }
  }

  const dialog = (
    <FilePreviewDialog
      file={preview}
      open={preview !== null}
      onOpenChange={(open) => {
        if (!open) setPreview(null)
      }}
    />
  )
  return { play, opening, dialog }
}
