import { DirType } from '@zpan/shared/constants'
import { Upload } from 'lucide-react'
import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { confirmUpload, createObject, uploadToS3 } from '../../lib/api'

interface UploadDropzoneProps {
  parent: string
  onUploadComplete: () => void
  children: React.ReactNode
}

async function uploadFile(file: File, parent: string) {
  const matter = await createObject({
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    parent,
    dirtype: DirType.FILE,
  })

  if (!matter.uploadUrl) throw new Error('No upload URL returned')

  await uploadToS3(matter.uploadUrl, file)
  await confirmUpload(matter.id)
  return matter
}

export function UploadDropzone({ parent, onUploadComplete, children }: UploadDropzoneProps) {
  const { t } = useTranslation()

  const onDrop = useCallback(
    (files: File[]) => {
      const uploads = files.map((file) => {
        const p = uploadFile(file, parent)
        toast.promise(p, {
          loading: t('files.uploading', { name: file.name }),
          success: t('files.uploadSuccess', { name: file.name }),
          error: t('files.uploadFailed', { name: file.name }),
        })
        return p
      })

      Promise.allSettled(uploads).then((results) => {
        if (results.some((r) => r.status === 'fulfilled')) {
          onUploadComplete()
        }
      })
    },
    [parent, onUploadComplete, t],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
  })

  return (
    <div {...getRootProps()} className="relative h-full">
      <input {...getInputProps()} />
      {children}
      {isDragActive && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm">
          <Upload className="h-12 w-12 text-primary" />
          <p className="text-lg font-medium text-primary">{t('files.dropToUpload')}</p>
        </div>
      )}
    </div>
  )
}
