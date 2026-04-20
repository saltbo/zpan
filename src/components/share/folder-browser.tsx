import type { ShareView } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Download, File, Folder, Home } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ShareChildItem } from '@/lib/api'
import { buildShareObjectUrl, listShareObjects } from '@/lib/api'
import { formatSize } from '@/lib/format'

interface FolderBrowserProps {
  token: string
  share: ShareView
  onSaveToDrive?: () => void
  isLoggedIn: boolean
}

export function FolderBrowser({ token, share, onSaveToDrive, isLoggedIn }: FolderBrowserProps) {
  const { t } = useTranslation()
  const [currentPath, setCurrentPath] = useState('')

  const query = useQuery({
    queryKey: ['share-objects', token, currentPath],
    queryFn: () => listShareObjects(token, currentPath),
  })

  const breadcrumb = query.data?.breadcrumb ?? []

  function navigateInto(path: string) {
    setCurrentPath(path)
  }

  function navigateToIndex(index: number) {
    if (index < 0) {
      setCurrentPath('')
    } else {
      const parts = currentPath.split('/').filter(Boolean)
      setCurrentPath(parts.slice(0, index + 1).join('/'))
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
            <Folder className="h-6 w-6 text-blue-500" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{share.matter.name}</h1>
            <p className="text-sm text-muted-foreground">{t('share.folderTitle')}</p>
          </div>
        </div>
        {isLoggedIn && onSaveToDrive && (
          <Button variant="outline" onClick={onSaveToDrive}>
            {t('share.saveToDrive')}
          </Button>
        )}
      </div>

      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1 text-sm">
        <button
          type="button"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => navigateToIndex(-1)}
        >
          <Home className="h-3.5 w-3.5" />
          <span>{share.matter.name}</span>
        </button>
        {breadcrumb.map((crumb, idx) => (
          <span key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            {idx === breadcrumb.length - 1 ? (
              <span className="font-medium">{crumb.name}</span>
            ) : (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => navigateToIndex(idx)}
              >
                {crumb.name}
              </button>
            )}
          </span>
        ))}
      </nav>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('share.colName')}</TableHead>
              <TableHead className="w-24">{t('share.colSize')}</TableHead>
              <TableHead className="w-24 text-right">{t('share.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading && (
              <>
                {[1, 2, 3].map((n) => (
                  <TableRow key={n}>
                    <TableCell>
                      <Skeleton className="h-4 w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                ))}
              </>
            )}
            {!query.isLoading &&
              (query.data?.items ?? []).map((item) => (
                <FolderRow
                  key={item.ref}
                  token={token}
                  item={item}
                  currentPath={currentPath}
                  onNavigate={navigateInto}
                />
              ))}
            {!query.isLoading && (query.data?.items ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {t('share.folderEmpty')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

interface FolderRowProps {
  token: string
  item: ShareChildItem
  currentPath: string
  onNavigate: (path: string) => void
}

function FolderRow({ token, item, currentPath, onNavigate }: FolderRowProps) {
  const { t } = useTranslation()
  const childPath = currentPath ? `${currentPath}/${item.name}` : item.name
  const downloadUrl = buildShareObjectUrl(token, item.ref)

  return (
    <TableRow className={item.isFolder ? 'cursor-pointer' : ''}>
      <TableCell>
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left"
          onClick={() => item.isFolder && onNavigate(childPath)}
          disabled={!item.isFolder}
        >
          {item.isFolder ? (
            <Folder className="h-4 w-4 flex-shrink-0 text-blue-500" />
          ) : (
            <File className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          )}
          <span className={item.isFolder ? 'font-medium hover:underline' : ''}>{item.name}</span>
        </button>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{item.isFolder ? '—' : formatSize(item.size)}</TableCell>
      <TableCell className="text-right">
        {!item.isFolder && (
          <Button asChild variant="ghost" size="sm">
            <a href={downloadUrl} download title={t('share.download')}>
              <Download className="h-4 w-4" />
            </a>
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
