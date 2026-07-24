import { DirType } from '@shared/constants'
import type { ShareObjectItem } from '@shared/schemas'
import type { ShareView, StorageObject } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Download, File, Folder, HardDriveDownload } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownContent } from '@/components/announcements/markdown-content'
import { FileManager } from '@/components/files/file-manager'
import { Button } from '@/components/ui/button'
import { ApiError, buildShareObjectUrl, getShareReadme, listShareObjects } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { formatSize } from '@/lib/format'
import { FilePreview } from './file-preview'
import { SaveToDriveDialog } from './save-to-drive-dialog'

interface ShareLandingProps {
  token: string
  share: ShareView
  onPasswordRequired?: () => void
}

function toStorageObject(item: ShareObjectItem): StorageObject {
  const now = new Date().toISOString()
  return {
    id: item.ref,
    orgId: '',
    alias: item.ref,
    name: item.name,
    type: item.type,
    size: item.size ?? 0,
    dirtype: item.isFolder ? DirType.USER_FOLDER : DirType.FILE,
    parent: '',
    object: item.ref,
    storageId: '',
    status: 'active',
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function CreatorLink({ share, compact = false }: { share: ShareView; compact?: boolean }) {
  const { t } = useTranslation()
  if (!share.creatorUsername) return <span className="font-medium text-foreground">{share.creatorName}</span>

  return (
    <Link
      to="/u/$username"
      params={{ username: share.creatorUsername }}
      className={`${compact ? '-my-3 min-h-11' : 'min-h-11'} inline-flex items-center font-medium text-foreground transition-colors hover:text-primary hover:underline hover:underline-offset-4`}
    >
      {compact ? t('share.creatorLink', { name: share.creatorName }) : share.creatorName}
    </Link>
  )
}

function expiryText(expiresAt: string | null, noExpiry: string) {
  return expiresAt ? new Date(expiresAt).toLocaleDateString() : noExpiry
}

function ShareSummary({
  token,
  share,
  canSave,
  onSave,
}: {
  token: string
  share: ShareView
  canSave: boolean
  onSave: () => void
}) {
  const { t } = useTranslation()
  const Icon = share.matter.isFolder ? Folder : File
  const expiry = expiryText(share.expiresAt, t('share.noExpiry'))
  const downloadUrl = buildShareObjectUrl(token, share.rootRef)

  return (
    <section
      className="flex min-h-24 flex-col justify-between gap-5 pb-6 sm:flex-row sm:items-center"
      aria-labelledby="share-title"
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h1 id="share-title" className="truncate text-lg font-semibold tracking-tight sm:text-xl">
            {share.matter.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{t('share.sharedByPrefix')}</span>
            <CreatorLink share={share} />
            {!share.matter.isFolder && (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatSize(share.matter.size)}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{t('share.expiresValue', { date: expiry })}</span>
          </p>
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-col-reverse gap-2 sm:w-auto sm:flex-row">
        {canSave && (
          <Button variant="outline" className="h-11" onClick={onSave}>
            <HardDriveDownload className="size-4" />
            {t('share.saveToDrive')}
          </Button>
        )}
        {!share.matter.isFolder && (
          <Button asChild className="h-11">
            <a href={downloadUrl} download={share.matter.name}>
              <Download className="size-4" />
              {t('share.downloadFile')}
            </a>
          </Button>
        )}
      </div>
    </section>
  )
}

function ShareInformation({ share }: { share: ShareView }) {
  const { t } = useTranslation()
  const type = share.matter.isFolder ? t('share.folderType') : share.matter.type
  const size = share.matter.isFolder ? '—' : formatSize(share.matter.size)
  const expiry = expiryText(share.expiresAt, t('share.noExpiry'))

  return (
    <section className="mt-4 overflow-hidden rounded-xl border bg-background p-5" aria-labelledby="share-info-title">
      <h2 id="share-info-title" className="text-sm font-semibold">
        {t('share.information')}
      </h2>
      <dl className="mt-3 grid grid-cols-2 border-t sm:grid-cols-5">
        <ShareInfoItem label={t('share.creator')}>
          <CreatorLink share={share} compact />
        </ShareInfoItem>
        <ShareInfoItem label={t('share.fileType')}>{type}</ShareInfoItem>
        <ShareInfoItem label={t('share.fileSize')}>{size}</ShareInfoItem>
        <ShareInfoItem label={t('share.downloadCount')}>
          {t('share.downloadCountValue', { count: share.downloads })}
        </ShareInfoItem>
        <ShareInfoItem label={t('share.expiry')}>{expiry}</ShareInfoItem>
      </dl>
    </section>
  )
}

function FolderReadme({ token, isCreator }: { token: string; isCreator: boolean }) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['share-readme', token],
    queryFn: () => getShareReadme(token),
    retry: false,
  })

  if (!isCreator && (query.isPending || query.isError)) return null

  let content: ReactNode
  if (query.isPending) {
    content = <p className="py-6 text-sm text-muted-foreground">{t('common.loading')}</p>
  } else if (query.isError) {
    content = (
      <p className="py-6 text-sm text-muted-foreground">
        {query.error instanceof ApiError && query.error.status === 404
          ? t('share.readmeOwnerHint')
          : t('share.readmeLoadError')}
      </p>
    )
  } else {
    content = <MarkdownContent content={query.data.content} />
  }

  return (
    <section className="mt-4 overflow-hidden rounded-xl border bg-background p-5" aria-labelledby="readme-title">
      <h2 id="readme-title" className="border-b pb-4 text-sm font-semibold">
        README.md
      </h2>
      <div className="pt-2">{content}</div>
    </section>
  )
}

function ShareInfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-b py-4 pr-4 odd:border-r odd:pl-0 even:pl-4 sm:border-b-0 sm:border-r sm:pl-4 sm:first:pl-0 sm:last:border-r-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 truncate text-sm">{children}</dd>
    </div>
  )
}

export function ShareLanding({ token, share, onPasswordRequired }: ShareLandingProps) {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const isLoggedIn = !!session?.user
  const isCreator = !!share.creatorId && session?.user?.id === share.creatorId
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [currentPath, setCurrentPath] = useState('')
  const canSave = isLoggedIn && share.kind === 'landing'

  return (
    <>
      <ShareSummary token={token} share={share} canSave={canSave} onSave={() => setSaveDialogOpen(true)} />
      {share.matter.isFolder ? (
        <>
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
          <FolderReadme token={token} isCreator={isCreator} />
        </>
      ) : (
        <>
          <FilePreview token={token} share={share} />
          <ShareInformation share={share} />
        </>
      )}
      {canSave && (
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
