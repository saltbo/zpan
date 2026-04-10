import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { File, FileCode, FileText, Folder, Image, Music, Video } from 'lucide-react'
import { getPreviewType } from '@/lib/file-types'

const sizeMap = {
  sm: 'h-4 w-4',
  lg: 'h-12 w-12',
} as const

interface FileIconProps {
  item: StorageObject
  size?: 'sm' | 'lg'
}

export function FileIcon({ item, size = 'sm' }: FileIconProps) {
  const cls = sizeMap[size]

  if (item.dirtype !== DirType.FILE) {
    return <Folder className={`${cls} text-blue-500`} />
  }

  const previewType = getPreviewType(item.name, item.type)
  switch (previewType) {
    case 'image':
      return <Image className={`${cls} text-green-500`} />
    case 'video':
      return <Video className={`${cls} text-purple-500`} />
    case 'audio':
      return <Music className={`${cls} text-pink-500`} />
    case 'pdf':
    case 'text':
    case 'markdown':
      return <FileText className={`${cls} text-red-500`} />
    case 'code':
      return <FileCode className={`${cls} text-yellow-600`} />
    default:
      return <File className={`${cls} text-muted-foreground`} />
  }
}
