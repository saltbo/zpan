import { useCallback, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useCreateObject, useConfirmUpload, uploadToPresignedUrl } from '../api'

interface UploadItem {
  file: File
  progress: number
  status: 'uploading' | 'done' | 'error'
}

interface FileUploadProps {
  parent: string
  inputRef: React.RefObject<HTMLInputElement | null>
}

export function FileUpload({ parent, inputRef }: FileUploadProps) {
  const [dragOver, setDragOver] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const createObject = useCreateObject()
  const confirmUpload = useConfirmUpload()

  const updateUpload = useCallback((index: number, patch: Partial<UploadItem>) => {
    setUploads((prev) => prev.map((u, i) => (i === index ? { ...u, ...patch } : u)))
  }, [])

  const processFile = useCallback(
    async (file: File, index: number) => {
      try {
        const res = await createObject.mutateAsync({
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          parent,
        })

        if (!res.uploadUrl || !res.matter) {
          throw new Error('Missing upload URL from server')
        }

        await uploadToPresignedUrl(res.uploadUrl, file, (pct) =>
          updateUpload(index, { progress: pct }),
        )
        await confirmUpload.mutateAsync(res.matter.id)
        updateUpload(index, { status: 'done', progress: 100 })
        toast.success(`Uploaded ${file.name}`)
      } catch {
        updateUpload(index, { status: 'error' })
        toast.error(`Failed to upload ${file.name}`)
      }
    },
    [parent, createObject, confirmUpload, updateUpload],
  )

  const startUpload = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      const baseIndex = uploads.length
      const newItems: UploadItem[] = fileArray.map((f) => ({
        file: f,
        progress: 0,
        status: 'uploading',
      }))
      setUploads((prev) => [...prev, ...newItems])
      fileArray.forEach((file, i) => processFile(file, baseIndex + i))
    },
    [uploads.length, processFile],
  )

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length) startUpload(e.dataTransfer.files)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      startUpload(e.target.files)
      e.target.value = ''
    }
  }

  const activeUploads = uploads.filter((u) => u.status === 'uploading')

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'rounded-lg border-2 border-dashed p-8 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-transparent',
        )}
      >
        {dragOver && (
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="h-8 w-8" />
            <p className="text-sm font-medium">Drop files here to upload</p>
          </div>
        )}
      </div>

      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleInputChange} />

      {activeUploads.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2 rounded-lg border bg-background p-3 shadow-lg">
          <p className="text-sm font-medium">Uploading {activeUploads.length} file(s)</p>
          {activeUploads.map((u, i) => (
            <div key={i} className="space-y-1">
              <p className="truncate text-xs text-muted-foreground">{u.file.name}</p>
              <Progress value={u.progress} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
