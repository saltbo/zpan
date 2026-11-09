import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import type { PreviewFile } from '@/components/preview/file-preview-content'
import { getObject } from '@/lib/api'
import { getPreviewType } from '@/lib/file-types'
import type { SidecarSubtitle } from '@/lib/subtitles'
import { baseName, matchSidecarSubtitle, matchSubtitleFile, type SidecarMatch } from '@/lib/subtitles/sidecar'

export type PreviewFileResolver = (item: StorageObject) => Promise<PreviewFile | null>
export type FolderLister = (path: string) => Promise<readonly StorageObject[]>

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

interface SidecarSearch {
  video: StorageObject
  /** Path of the folder the video is listed in ("" for the root). */
  folderPath: string
  siblings: readonly StorageObject[]
  listFolder: FolderLister
  fromDataSource?: PreviewFileResolver
}

interface Candidate extends SidecarMatch {
  item: StorageObject
  /** Relative to the video's folder. */
  name: string
}

const SUBTITLE_FOLDER = /^(subs|subtitles?)$/i

const isFile = (item: StorageObject) => item.dirtype === DirType.FILE
const isVideo = (item: StorageObject) => isFile(item) && getPreviewType(item.name, item.type) === 'video'
const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)
const byName = (a: StorageObject, b: StorageObject) => a.name.localeCompare(b.name, undefined, { numeric: true })

/**
 * Subtitle files for a video, with download links. Looks where release groups put them:
 * `Movie.chs.srt` next to the video, `Subs/*.srt` when the folder holds a single video, and
 * `Subs/<video name>/*.srt` for a season. A file or folder that can't be read is skipped so the
 * video still opens.
 */
export async function resolveSidecarSubtitles(search: SidecarSearch): Promise<SidecarSubtitle[]> {
  const { video, siblings, fromDataSource } = search
  if (!isVideo(video)) return []
  const named = siblings.filter(isFile).flatMap((item): Candidate[] => {
    const match = matchSidecarSubtitle(video.name, item.name)
    return match ? [{ ...match, item, name: item.name }] : []
  })
  const candidates = [...named, ...(await subtitleFolderCandidates(search))]
  const results = await Promise.allSettled(candidates.map(({ item }) => resolvePreviewFile(item, fromDataSource)))
  return results.flatMap((result, index) => {
    const { name, format, tag } = candidates[index]
    if (result.status === 'rejected') {
      console.error(`Failed to resolve subtitle ${name}`, result.reason)
      return []
    }
    return result.value ? [{ name, url: result.value.downloadUrl, format, tag }] : []
  })
}

async function subtitleFolderCandidates({
  video,
  folderPath,
  siblings,
  listFolder,
}: SidecarSearch): Promise<Candidate[]> {
  const folder = siblings.find((item) => !isFile(item) && SUBTITLE_FOLDER.test(item.name))
  if (!folder) return []
  const folderAt = joinPath(folderPath, folder.name)
  try {
    const entries = [...(await listFolder(folderAt))].sort(byName)
    // Without a second video in the folder, every subtitle in Subs/ can only belong to this one.
    const ownsFolder = siblings.filter(isVideo).length === 1
    const direct = entries.filter(isFile).flatMap((item): Candidate[] => {
      const match = matchSidecarSubtitle(video.name, item.name) ?? (ownsFolder ? matchSubtitleFile(item.name) : null)
      return match ? [{ ...match, item, name: `${folder.name}/${item.name}` }] : []
    })
    const videoKey = baseName(video.name).toLowerCase()
    const episodeFolder = entries.find((item) => !isFile(item) && item.name.toLowerCase() === videoKey)
    if (!episodeFolder) return direct
    const episode = [...(await listFolder(joinPath(folderAt, episodeFolder.name)))].sort(byName)
    return [
      ...direct,
      ...episode.filter(isFile).flatMap((item): Candidate[] => {
        const match = matchSubtitleFile(item.name)
        return match ? [{ ...match, item, name: `${folder.name}/${episodeFolder.name}/${item.name}` }] : []
      }),
    ]
  } catch (error) {
    console.error(`Failed to list subtitles in ${folderAt}`, error)
    return []
  }
}
