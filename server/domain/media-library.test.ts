import { mediaLibraryFeedSchema } from '@shared/schemas'
import { describe, expect, it } from 'vitest'
import {
  decideMediaLibrarySweep,
  folderPathsOverlap,
  type MediaLibraryFile,
  mediaLibraryFeedItems,
  olderOverlappingLibrary,
  serializeMediaLibraryFeed,
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

async function feedText(
  source: Parameters<typeof serializeMediaLibraryFeed>[0],
  pages: Parameters<typeof serializeMediaLibraryFeed>[1],
): Promise<string> {
  let text = ''
  for await (const chunk of serializeMediaLibraryFeed(source, pages)) text += chunk
  return text
}

describe('serializeMediaLibraryFeed', () => {
  const movies = {
    libraryId: 'lib-1',
    folderPath: 'Media/Movies',
    folderName: 'Movies',
    generatedAt: new Date('2026-02-01T00:00:00.000Z'),
  }

  it('streams a JSON Feed 1.1 snapshot of the videos in listing order [spec: media-library/build-feed]', async () => {
    const page = (...files: MediaLibraryFile[]) => mediaLibraryFeedItems(movies, files)
    const text = await feedText(movies, [
      page(file('Media/Movies', 'Inception (2010).mp4', { type: 'video/mp4' }), file('Media/Movies', 'poster.jpg')),
      page(),
      page(file('Media/Movies/Sci-Fi', 'Dune (2021).mkv', { size: 2048 })),
      page(file('Media/Movies/Sci-Fi', 'notes.txt', { type: 'text/plain' })),
      page(file('Media/Movies/Shows/Season 1', 'S01E02 #1?.mkv')),
    ])

    const feed = JSON.parse(text)
    expect(text).toBe(JSON.stringify(feed))
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

  it('emits exactly JSON.stringify of the whole feed however the items are paged', async () => {
    const source = { ...movies, folderPath: '媒体/电影 "4K"', folderName: '电影 "4K"' }
    const names = [
      '盗梦空间.Inception.2010.mkv',
      '流浪地球 第1季第2集.mp4',
      'Quote "Cut" \\ Back.slash.mkv',
      'Tab\tand\u0001control.mkv',
      'Line\u2028Sep 😀 emoji.webm',
      'S01E01.mkv',
    ]
    const items = mediaLibraryFeedItems(
      source,
      names.map((name, i) => file(i % 2 ? `${source.folderPath}/剧集/Season 1` : source.folderPath, name)),
    )
    const whole = (feedItems: unknown[]) =>
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: source.folderName,
        _zpan: { generatedAt: '2026-02-01T00:00:00.000Z', libraryId: 'lib-1' },
        items: feedItems,
      })

    expect(items).toHaveLength(names.length)
    for (const pages of [[items], items.map((item) => [item]), [[], items.slice(0, 2), [], items.slice(2)]]) {
      expect(await feedText(source, pages)).toBe(whole(items))
    }
    expect(await feedText(source, [])).toBe(whole([]))
    expect(await feedText(source, [[], []])).toBe(whole([]))
  })

  it('falls back to the file name when nothing yields a title', () => {
    const [item] = mediaLibraryFeedItems({ folderPath: 'Season 1', folderName: 'Season 1' }, [
      file('Season 1', 'S01E01.mkv'),
    ])
    expect(item).toMatchObject({ title: 'S01E01.mkv', _media: { type: 'episode', title: '' } })
  })
})
