import type { StorageObject } from '@zpan/shared'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download, FileIcon } from 'lucide-react'
import { useObjectDetail } from '../api'
import { formatFileSize, mimeCategory } from '../utils'
import { Skeleton } from '@/components/ui/skeleton'

interface FilePreviewProps {
  item: StorageObject | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FilePreview({ item, open, onOpenChange }: FilePreviewProps) {
  const { data: detail, isLoading } = useObjectDetail(item?.id ?? null)
  const url = detail?.downloadUrl

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate">{item?.name}</DialogTitle>
        </DialogHeader>

        {isLoading && <Skeleton className="h-64 w-full rounded-lg" />}

        {!isLoading && url && item && <PreviewContent url={url} item={item} />}

        {!isLoading && !url && item && <UnsupportedPreview item={item} />}

        {url && (
          <div className="flex justify-end pt-2">
            <Button variant="outline" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer" download={item?.name}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PreviewContent({ url, item }: { url: string; item: StorageObject }) {
  const cat = mimeCategory(item.type)

  switch (cat) {
    case 'image':
      return (
        <img
          src={url}
          alt={item.name}
          className="max-h-[60vh] w-auto mx-auto rounded-lg object-contain"
        />
      )
    case 'video':
      return <video src={url} controls className="max-h-[60vh] w-full rounded-lg" />
    case 'audio':
      return <audio src={url} controls className="w-full mt-4" />
    case 'pdf':
      return <iframe src={url} title={item.name} className="h-[60vh] w-full rounded-lg border" />
    case 'text':
      return <TextPreview url={url} />
    default:
      return <UnsupportedPreview item={item} />
  }
}

function TextPreview({ url }: { url: string }) {
  const { data: text, isLoading } = useTextContent(url)
  if (isLoading) return <Skeleton className="h-40 w-full" />
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-4 text-sm font-mono whitespace-pre-wrap">
      {text}
    </pre>
  )
}

function useTextContent(url: string) {
  return useQuery({
    queryKey: ['text-preview', url],
    queryFn: () => fetch(url).then((r) => r.text()),
    staleTime: 5 * 60 * 1000,
  })
}

function UnsupportedPreview({ item }: { item: StorageObject }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
      <FileIcon className="h-16 w-16" />
      <p className="text-sm">Preview not available for this file type</p>
      <p className="text-xs">
        {item.type || 'Unknown type'} &middot; {formatFileSize(item.size)}
      </p>
    </div>
  )
}
