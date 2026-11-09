import { MEDIA_LIBRARY_FEED_VERSION, type MediaLibraryFeed, type MediaLibraryFeedItem } from '@shared/schemas'
import { parseMediaPath } from './media-filename'

export const MEDIA_LIBRARY_INDEX_FOLDER = '.zpan'
export const MEDIA_LIBRARY_INDEX_FILE = 'library.json'
export const MEDIA_LIBRARY_INDEX_MIME = 'application/feed+json'

// A queued or running scan older than this no longer blocks a new one, so a
// consumer that died mid-scan (or a Node restart that lost the in-process
// queue) cannot freeze a library forever.
export const MEDIA_LIBRARY_SCAN_LEASE_MS = 60 * 60 * 1000

const VIDEO_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mkv: 'video/x-matroska',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  webm: 'video/webm',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ogv: 'video/ogg',
  rmvb: 'application/vnd.rn-realmedia-vbr',
}

export const VIDEO_EXTENSIONS: readonly string[] = Object.keys(VIDEO_MIME_BY_EXTENSION)

// Uploads often store a generic MIME (WebDAV clients send octet-stream for .mkv),
// so the extension decides when the stored type is not a video type.
export function videoMimeType(name: string, storedType: string): string | null {
  if (storedType.startsWith('video/')) return storedType
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (VIDEO_MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null
}

export function joinMatterPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

// Two library roots overlap when one contains the other; libraries never nest.
export function folderPathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

export interface MediaLibraryFile {
  id: string
  parent: string
  name: string
  type: string
  size: number | null
  updatedAt: Date
}

export function buildMediaLibraryFeed(input: {
  libraryId: string
  folderPath: string
  folderName: string
  files: readonly MediaLibraryFile[]
  generatedAt: Date
}): MediaLibraryFeed {
  const rootPrefix = `${input.folderPath}/`
  const items = input.files.flatMap((file): { path: string; item: MediaLibraryFeedItem }[] => {
    const mimeType = videoMimeType(file.name, file.type)
    if (!mimeType) return []
    const path = joinMatterPath(file.parent, file.name).slice(rootPrefix.length)
    const folders = [input.folderName, ...path.split('/').slice(0, -1)]
    const media = parseMediaPath(folders, file.name)
    return [
      {
        path,
        item: {
          id: file.id,
          title: media.title || file.name,
          content_text: path,
          date_modified: file.updatedAt.toISOString(),
          attachments: [
            {
              url: path.split('/').map(encodeURIComponent).join('/'),
              mime_type: mimeType,
              size_in_bytes: file.size ?? 0,
            },
          ],
          _media: media,
        },
      },
    ]
  })
  items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return {
    version: MEDIA_LIBRARY_FEED_VERSION,
    title: input.folderName,
    _zpan: { generatedAt: input.generatedAt.toISOString(), libraryId: input.libraryId },
    items: items.map(({ item }) => item),
  }
}
