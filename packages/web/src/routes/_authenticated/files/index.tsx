import type { IApi, IEntity } from '@svar-ui/react-filemanager'
import { Filemanager, Willow } from '@svar-ui/react-filemanager'
import '@svar-ui/react-filemanager/all.css'

// Hide SVAR's built-in sidebar tree and breadcrumb — we use our own App Sidebar
const svarOverrides = `
  .wx-sidebar { display: none !important; }
  .wx-left .wx-name { display: none !important; }
  .wx-breadcrumbs { display: none !important; }
`

import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FilePreviewDialog, type PreviewFile } from '../../../components/preview/file-preview-dialog'
import { UploadDropzone, type UploadDropzoneHandle } from '../../../components/upload/upload-dropzone'
import { confirmUpload, createObject, getObject, uploadToS3 } from '../../../lib/api'
import { connectAdapter, loadFolder, pathToDbId, refreshFolder } from '../../../lib/file-manager-adapter'

interface FilesSearch {
  folder?: string
}

export const Route = createFileRoute('/_authenticated/files/')({
  validateSearch: (search: Record<string, unknown>): FilesSearch => ({
    folder: (search.folder as string) || undefined,
  }),
  component: FilesPage,
})

function FilesPage() {
  const { t } = useTranslation()
  const { folder } = useSearch({ from: '/_authenticated/files/' })
  const navigate = useNavigate()

  const apiRef = useRef<IApi>(null)
  const dropzoneRef = useRef<UploadDropzoneHandle>(null)
  const currentPathRef = useRef('/')
  const [data, setData] = useState<IEntity[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentPath, setCurrentPath] = useState('/')
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    currentPathRef.current = currentPath
  }, [currentPath])

  useEffect(() => {
    setLoading(true)
    loadFolder('', '/')
      .then(setData)
      .catch(() => toast.error(t('common.error')))
      .finally(() => setLoading(false))
  }, [t])

  const handleInit = useCallback(
    (api: IApi) => {
      connectAdapter(api)

      // SVAR's built-in uploader bypasses the event bus entirely.
      // Hijack its hidden file input to run our presigned URL upload.
      const observer = new MutationObserver(() => {
        const allInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]')
        const svarInput = Array.from(allInputs).find((el) => el.closest('[class*="wx-"]'))
        if (svarInput && !svarInput.dataset.hijacked) {
          svarInput.dataset.hijacked = 'true'
          svarInput.addEventListener('change', async () => {
            const files = svarInput.files
            if (!files?.length) return
            const parentPath = currentPathRef.current || '/'
            const parentDbId = pathToDbId(parentPath)
            for (const file of Array.from(files)) {
              try {
                const matter = await createObject({
                  name: file.name,
                  type: file.type || 'application/octet-stream',
                  size: file.size,
                  parent: parentDbId,
                  dirtype: 0,
                })
                if (matter.uploadUrl) {
                  await uploadToS3(matter.uploadUrl, file)
                  await confirmUpload(matter.id)
                }
                toast.success(t('files.uploadSuccess', { name: file.name }))
              } catch {
                toast.error(t('files.uploadFailed', { name: file.name }))
              }
            }
            refreshFolder(api, pathToDbId(parentPath), parentPath).catch(() => {})
            svarInput.value = ''
          })
          observer.disconnect()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })

      api.on('open-file', async ({ id }: { id: string }) => {
        try {
          const dbId = pathToDbId(id)
          const obj = await getObject(dbId)
          if (!obj.downloadUrl) return

          setPreviewFile({
            id: dbId,
            name: obj.name,
            type: obj.type,
            size: obj.size,
            downloadUrl: obj.downloadUrl,
          })
          setPreviewOpen(true)
        } catch {
          toast.error(t('common.error'))
        }
      })
    },
    [t],
  )

  const handleSetPath = useCallback(
    ({ id }: { id: string }) => {
      setCurrentPath(id || '/')
      navigate({ to: '/files', search: { folder: id || undefined } })
    },
    [navigate],
  )

  const handleUploadComplete = useCallback(() => {
    if (apiRef.current) {
      const cp = currentPathRef.current || '/'
      const dbId = pathToDbId(cp)
      refreshFolder(apiRef.current, dbId, cp).catch(() => toast.error(t('common.error')))
    }
  }, [t])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <UploadDropzone ref={dropzoneRef} parent={pathToDbId(currentPath)} onUploadComplete={handleUploadComplete}>
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
          <FolderOpen className="h-16 w-16" />
          <h2 className="text-xl font-medium">{t('files.title')}</h2>
          <p className="text-sm">{t('files.emptyState')}</p>
        </div>
      </UploadDropzone>
    )
  }

  return (
    <UploadDropzone ref={dropzoneRef} parent={pathToDbId(currentPath)} onUploadComplete={handleUploadComplete}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static CSS overrides for SVAR */}
      <style dangerouslySetInnerHTML={{ __html: svarOverrides }} />
      <div className="h-[calc(100vh-4rem)]">
        <Willow>
          <Filemanager ref={apiRef} data={data} init={handleInit} onsetpath={handleSetPath} />
        </Willow>
      </div>
      <FilePreviewDialog file={previewFile} open={previewOpen} onOpenChange={setPreviewOpen} />
    </UploadDropzone>
  )
}
