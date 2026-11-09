import { mediaLibraryFeedSchema } from '@shared/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildMediaLibraryFeed,
  decideMediaLibrarySweep,
  folderPathsOverlap,
  type MediaLibraryFile,
  olderOverlappingLibrary,
  videoMimeType,
} from './media-library'

const modified = new Date('2026-01-02T03:04:05.000Z')

function file(parent: string, name: string, overrides: Partial<MediaLibraryFile> = {}): MediaLibraryFile {
  return {
    id: `id-${name}`,
    parent,
    name,
    type: 'application/octet-stream',
    size: 10,
    updatedAt: modified,
    ...overrides,
  }
}

describe('decideMediaLibrarySweep', () => {
  const live = { trashed: false }
  const changed = {
    folder: live,
    indexed: true,
    scanning: false,
    fingerprint: '1:10:5:5',
    subtreeFingerprint: '2:20:6:11',
  }

  it.each([
    ['the folder was purged', { folder: null, indexed: false }, { action: 'delete', reason: 'folder_purged' }],
    [
      'the folder is in trash',
      { folder: { trashed: true }, indexed: false },
      { action: 'skip', reason: 'folder_trashed' },
    ],
    ['the index was removed', { indexed: false }, { action: 'delete', reason: 'index_removed' }],
    [
      'the index was removed while a scan runs',
      { indexed: false, scanning: true },
      { action: 'delete', reason: 'index_removed' },
    ],
    ['a scan holds the lease', { scanning: true }, { action: 'skip', reason: 'scanning' }],
    ['the subtree is unchanged', { subtreeFingerprint: '1:10:5:5' }, { action: 'skip', reason: 'unchanged' }],
    ['the subtree changed', {}, { action: 'scan', folder: live }],
    ['the library was never scanned', { fingerprint: null }, { action: 'scan', folder: live }],
  ] as const)('decides when %s', (_label, facts, decision) => {
    expect(decideMediaLibrarySweep({ ...changed, ...facts })).toEqual(decision)
  })
})

describe('videoMimeType', () => {
  it('prefers a stored video type and falls back to the extension', () => {
    expect(videoMimeType('clip.bin', 'video/mp4')).toBe('video/mp4')
    expect(videoMimeType('Movie.MKV', 'application/octet-stream')).toBe('video/x-matroska')
    expect(videoMimeType('notes.txt', 'text/plain')).toBeNull()
    expect(videoMimeType('mkv', 'application/octet-stream')).toBeNull()
  })
})

describe('folderPathsOverlap', () => {
  it.each([
    ['Media', 'Media', true],
    ['Media', 'Media/Movies', true],
    ['Media/Movies', 'Media', true],
    ['Media', 'Media Archive', false],
    ['Movies', 'TV', false],
  ])('%s vs %s → %s', (a, b, expected) => {
    expect(folderPathsOverlap(a, b)).toBe(expected)
  })
})

describe('olderOverlappingLibrary', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute))
  const media = { id: 'b', createdAt: at(1), path: 'Media' }
  const libraries = [
    media,
    { id: 'a', createdAt: at(1), path: 'Media/Movies' },
    { id: 'c', createdAt: at(0), path: 'Media Archive' },
    { id: 'd', createdAt: at(2), path: 'Media/Shows' },
  ]

  it('names the overlapping library created first, breaking createdAt ties by id', () => {
    expect(olderOverlappingLibrary(media, libraries)?.id).toBe('a')
    expect(olderOverlappingLibrary(libraries[1], libraries)).toBeUndefined()
    expect(olderOverlappingLibrary(libraries[3], libraries)?.id).toBe('b')
    expect(olderOverlappingLibrary(libraries[2], libraries)).toBeUndefined()
  })
})

describe('buildMediaLibraryFeed', () => {
  it('builds a JSON Feed 1.1 snapshot of the videos under the library, ordered by path [spec: media-library/build-feed]', () => {
    const feed = buildMediaLibraryFeed({
      libraryId: 'lib-1',
      folderPath: 'Media/Movies',
      folderName: 'Movies',
      generatedAt: new Date('2026-02-01T00:00:00.000Z'),
      files: [
        file('Media/Movies/Sci-Fi', 'Dune (2021).mkv', { size: 2048 }),
        file('Media/Movies', 'Inception (2010).mp4', { type: 'video/mp4' }),
        file('Media/Movies', 'poster.jpg', { type: 'image/jpeg' }),
        file('Media/Movies/Shows/Season 1', 'S01E02 #1?.mkv'),
      ],
    })

    expect(mediaLibraryFeedSchema.parse(feed)).toEqual(feed)
    expect(feed).toEqual({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Movies',
      _zpan: { generatedAt: '2026-02-01T00:00:00.000Z', libraryId: 'lib-1' },
      items: [
        {
          id: 'id-Inception (2010).mp4',
          title: 'Inception',
          content_text: 'Inception (2010).mp4',
          date_modified: '2026-01-02T03:04:05.000Z',
          attachments: [{ url: 'Inception%20(2010).mp4', mime_type: 'video/mp4', size_in_bytes: 10 }],
          _media: { type: 'movie', title: 'Inception', year: 2010 },
        },
        {
          id: 'id-Dune (2021).mkv',
          title: 'Dune',
          content_text: 'Sci-Fi/Dune (2021).mkv',
          date_modified: '2026-01-02T03:04:05.000Z',
          attachments: [{ url: 'Sci-Fi/Dune%20(2021).mkv', mime_type: 'video/x-matroska', size_in_bytes: 2048 }],
          _media: { type: 'movie', title: 'Dune', year: 2021 },
        },
        {
          id: 'id-S01E02 #1?.mkv',
          title: 'Shows',
          content_text: 'Shows/Season 1/S01E02 #1?.mkv',
          date_modified: '2026-01-02T03:04:05.000Z',
          attachments: [
            { url: 'Shows/Season%201/S01E02%20%231%3F.mkv', mime_type: 'video/x-matroska', size_in_bytes: 10 },
          ],
          _media: { type: 'episode', title: 'Shows', season: 1, episode: 2 },
        },
      ],
    })
  })

  it('falls back to the file name when nothing yields a title', () => {
    const feed = buildMediaLibraryFeed({
      libraryId: 'lib-1',
      folderPath: 'Season 1',
      folderName: 'Season 1',
      generatedAt: modified,
      files: [file('Season 1', 'S01E01.mkv')],
    })
    expect(feed.items[0]).toMatchObject({ title: 'S01E01.mkv', _media: { type: 'episode', title: '' } })
  })
})
