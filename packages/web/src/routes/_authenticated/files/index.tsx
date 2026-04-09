import type { IApi, IEntity } from '@svar-ui/react-filemanager'
import { Filemanager, Willow } from '@svar-ui/react-filemanager'
import '@svar-ui/react-filemanager/all.css'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { UploadDropzone } from '../../../components/upload/upload-dropzone'
import { connectAdapter, loadFolder, refreshFolder } from '../../../lib/file-manager-adapter'

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
  const [data, setData] = useState<IEntity[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentParent, setCurrentParent] = useState('')

  useEffect(() => {
    setLoading(true)
    loadFolder('')
      .then(setData)
      .catch(() => toast.error(t('common.error')))
      .finally(() => setLoading(false))
  }, [t])

  const handleInit = useCallback((api: IApi) => {
    connectAdapter(api)
  }, [])

  const handleSetPath = useCallback(
    ({ id }: { id: string }) => {
      setCurrentParent(id ?? '')
      navigate({ to: '/files', search: { folder: id || undefined } })
    },
    [navigate],
  )

  const handleUploadComplete = useCallback(() => {
    if (apiRef.current) {
      refreshFolder(apiRef.current, currentParent).catch(() => toast.error(t('common.error')))
    }
  }, [currentParent, t])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <UploadDropzone parent={currentParent} onUploadComplete={handleUploadComplete}>
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
          <FolderOpen className="h-16 w-16" />
          <h2 className="text-xl font-medium">{t('files.title')}</h2>
          <p className="text-sm">{t('files.emptyState')}</p>
        </div>
      </UploadDropzone>
    )
  }

  return (
    <UploadDropzone parent={currentParent} onUploadComplete={handleUploadComplete}>
      <div className="h-[calc(100vh-4rem)]">
        <Willow>
          <Filemanager ref={apiRef} data={data} init={handleInit} onsetpath={handleSetPath} />
        </Willow>
      </div>
    </UploadDropzone>
  )
}
