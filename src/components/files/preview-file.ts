import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import type { PreviewFile } from '@/components/preview/file-preview-content'
import { getObject } from '@/lib/api'
import { getPreviewType } from '@/lib/file-types'
import type { SidecarSubtitle } from '@/lib/subtitles'
import { matchSidecarSubtitle } from '@/lib/subtitles/sidecar'

export type PreviewFileResolver = (item: StorageObject) => Promise<PreviewFile | null>

/** A previewable file with its download link; a data source (e.g. a share) may supply its own. */
export async function resolvePreviewFile(
  item: StorageObject,
  fromDataSource?: PreviewFileResolver,
): Promise<PreviewFile | null> {
  const provided = await fromDataSource?.(item)
  if (provided) return provided
  const obj = await getObject(item.id)
  return obj.downloadUrl
    ? { id: obj.id, name: obj.name, type: obj.type, size: obj.size, downloadUrl: obj.downloadUrl }
    : null
}

/**
 * Download links for the subtitle files listed next to a video. One that can't be resolved is
 * skipped so the video still opens.
 */
export async function resolveSidecarSubtitles(
  video: StorageObject,
  siblings: readonly StorageObject[],
  fromDataSource?: PreviewFileResolver,
): Promise<SidecarSubtitle[]> {
  if (getPreviewType(video.name, video.type) !== 'video') return []
  const candidates = siblings.filter(
    (item) => item.dirtype === DirType.FILE && matchSidecarSubtitle(video.name, item.name),
  )
  const results = await Promise.allSettled(candidates.map((item) => resolvePreviewFile(item, fromDataSource)))
  return results.flatMap((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Failed to resolve subtitle ${candidates[index].name}`, result.reason)
      return []
    }
    return result.value ? [{ name: result.value.name, url: result.value.downloadUrl }] : []
  })
}
