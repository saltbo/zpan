import { DirType } from '@shared/constants'
import { MEDIA_LIBRARY_FEED_VERSION, type MediaLibraryFeed, type MediaLibraryFeedItem } from '@shared/schemas'
import { parseMediaPath } from './media-filename'

export const MEDIA_LIBRARY_INDEX_FILE = 'library.json'
export const MEDIA_LIBRARY_INDEX_MIME = 'application/feed+json'

// The index in the library root is also the library's on switch. Only a file
// named exactly library.json with the feed type counts: a case variant, a
// folder, or a file of another type means the index is gone and the library is
// off.
export function isMediaLibraryIndex(entry: { name: string; dirtype: number | null; type: string }): boolean {
  return (
    entry.name === MEDIA_LIBRARY_INDEX_FILE && entry.dirtype === DirType.FILE && entry.type === MEDIA_LIBRARY_INDEX_MIME
  )
}

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

export interface MediaLibraryRoot {
  id: string
  createdAt: Date
  path: string
}

// Moves and restores can still make two libraries overlap after creation. The
// older one (createdAt, then id) keeps its index; the newer one is not scanned.
export function olderOverlappingLibrary<T extends MediaLibraryRoot>(
  library: MediaLibraryRoot,
  others: readonly T[],
): T | undefined {
  return others.find(
    (other) => other.id !== library.id && folderPathsOverlap(other.path, library.path) && precedes(other, library),
  )
}

function precedes(a: MediaLibraryRoot, b: MediaLibraryRoot): boolean {
  const delta = a.createdAt.getTime() - b.createdAt.getTime()
  return delta === 0 ? a.id < b.id : delta < 0
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

export interface MediaLibrarySweepFacts<F extends { trashed: boolean }> {
  // null once the folder is purged.
  folder: F | null
  // The live library.json index exists in the library root.
  indexed: boolean
  // A scan holds the lease.
  scanning: boolean
  // Fingerprint of the last scan attempt.
  fingerprint: string | null
  // Fingerprint of the subtree now.
  subtreeFingerprint: string
}

export type MediaLibraryDeleteReason = 'folder_purged' | 'index_removed'

export type MediaLibrarySweepDecision<F> =
  | { action: 'delete'; reason: MediaLibraryDeleteReason }
  | { action: 'skip'; reason: 'folder_trashed' | 'scanning' | 'unchanged' }
  | { action: 'scan'; folder: F }

// A trashed folder is skipped before the index is checked, so a library in
// trash keeps its row and comes back when the folder is restored.
export function decideMediaLibrarySweep<F extends { trashed: boolean }>(
  facts: MediaLibrarySweepFacts<F>,
): MediaLibrarySweepDecision<F> {
  const { folder } = facts
  if (!folder) return { action: 'delete', reason: 'folder_purged' }
  if (folder.trashed) return { action: 'skip', reason: 'folder_trashed' }
  if (!facts.indexed) return { action: 'delete', reason: 'index_removed' }
  if (facts.scanning) return { action: 'skip', reason: 'scanning' }
  if (facts.subtreeFingerprint === facts.fingerprint) return { action: 'skip', reason: 'unchanged' }
  return { action: 'scan', folder }
}
