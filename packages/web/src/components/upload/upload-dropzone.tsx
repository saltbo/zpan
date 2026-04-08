import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { invalidateObjects, uploadFile } from '@/lib/file-manager-adapter'
import { cn } from '@/lib/utils'

interface UploadDropzoneProps {
  parent: string
  className?: string
}

export function UploadDropzone({ parent, className }: UploadDropzoneProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      for (const file of acceptedFiles) {
        const toastId = toast.loading(t('files.uploading', { name: file.name }))

        uploadFile(file, parent, (percent) => {
          toast.loading(t('files.uploadProgress', { name: file.name, percent }), { id: toastId })
        })
          .then(() => {
            toast.success(t('files.uploadSuccess', { name: file.name }), { id: toastId })
            invalidateObjects(queryClient, parent)
          })
          .catch((err) => {
            toast.error(t('files.uploadFailed', { name: file.name, error: err.message }), {
              id: toastId,
            })
          })
      }
    },
    [parent, queryClient, t],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
  })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'relative rounded-lg border-2 border-dashed border-transparent transition-colors',
        isDragActive && 'border-primary bg-primary/5',
        className,
      )}
    >
      <input {...getInputProps()} />
      {isDragActive && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-primary/5">
          <Upload className="h-10 w-10 text-primary" />
          <p className="text-sm font-medium text-primary">{t('files.dropToUpload')}</p>
        </div>
      )}
    </div>
  )
}
