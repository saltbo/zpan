import type { StorageObject } from '@shared/types'
import { getPreviewType } from '@/lib/file-types'
import type { MusicTrack } from './music-player-provider'

export function isMusicPreviewFile(file: MusicTrack): boolean {
  return getPreviewType(file.name, file.type) === 'audio'
}

export function toPreviewFile(item: StorageObject & { downloadUrl?: string }): MusicTrack {
  if (!item.downloadUrl) throw new Error('Audio download URL is missing')
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    size: item.size,
    downloadUrl: item.downloadUrl,
  }
}
