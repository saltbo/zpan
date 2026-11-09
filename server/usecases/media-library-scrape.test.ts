import { ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import type { MediaLibraryScrapeJobRequest } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import type { TmdbMovie } from '../domain/tmdb'
import type { Deps } from './deps'
import { enqueueScrapeAfterScan, processMediaLibraryScrape } from './media-library-scrape'
import {
  type BackgroundJobMessage,
  type Matter,
  type MediaLibraryState,
  NameConflictError,
  TmdbRateLimitError,
  TmdbUnavailableError,
} from './ports'

const library: MediaLibraryState = {
  id: 'lib-1',
  orgId: 'org-1',
  folderId: 'folder-1',
  folder: { path: 'Movies', name: 'Movies', trashed: false },
  fingerprint: null,
  lastScannedAt: null,
  scanning: false,
  scraping: true,
  createdByUserId: 'user-1',
  createdBy: { type: 'user', ref: 'user-1', issuer: null },
  createdAt: new Date(),
  updatedAt: new Date(),
}

const message: BackgroundJobMessage<MediaLibraryScrapeJobRequest> = {
  jobId: 'job-1',
  orgId: 'org-1',
  userId: 'user-1',
  createdBy: { type: 'system', ref: null, issuer: null },
  request: { type: 'media_library_scrape', libraryId: 'lib-1' },
}

function video(name: string): Matter {
  return {
    id: `id-${name}`,
    orgId: 'org-1',
    parent: 'Movies',
    name,
    type: 'video/x-matroska',
    updatedAt: new Date(),
  } as Matter
}

function movie(id: number): TmdbMovie {
  return {
    id,
    title: 'Title',
    originalTitle: 'Title',
    overview: '',
    date: '2010-01-01',
    genres: [],
    runtime: null,
    posterPath: null,
    backdropPath: null,
    posters: [],
    backdrops: [],
  }
}

function makeDeps(
  options: {
    videos?: Matter[]
    state?: MediaLibraryState | null
    search?: (title: string) => Promise<Array<{ id: number; title: string; originalTitle: string; year: number }>>
    quota?: boolean
    create?: () => Promise<Matter>
  } = {},
) {
  const updates: Record<string, unknown>[] = []
  const deps = {
    backgroundJobs: {
      update: vi.fn(async (_orgId: string, _id: string, input: Record<string, unknown>) => {
        updates.push(input)
        return input as unknown as BackgroundJob
      }),
      create: vi.fn(async () => ({ id: 'scan-job', orgId: 'org-1', userId: 'user-1' }) as BackgroundJob),
    },
    jobQueue: { dispatch: vi.fn(async () => {}) },
    mediaLibraries: {
      get: vi.fn(async () => (options.state === undefined ? library : options.state)),
      listVideosToScrape: vi.fn(async () => (options.videos ?? []).map((file) => ({ file, previous: null }))),
      hasVideosToScrape: vi.fn(async () => true),
      recordScrape: vi.fn(async () => {}),
    },
    tmdb: {
      getConfig: vi.fn(async () => ({ accessToken: 'token', language: 'en-US' })),
      searchMovies: vi.fn(async (_token: string, query: { title: string }) =>
        options.search
          ? options.search(query.title)
          : [{ id: 1, title: query.title, originalTitle: query.title, year: 2010 }],
      ),
      getMovie: vi.fn(async (_token: string, id: number) => movie(id)),
      getImage: vi.fn(async () => null),
    },
    matter: {
      findActiveAt: vi.fn(async () => []),
      create: vi.fn(options.create ?? (async () => ({}) as Matter)),
    },
    storages: { select: vi.fn(async () => ({ id: 'storage-1' })) },
    s3: { putObject: vi.fn(async () => 1), deleteObject: vi.fn(async () => {}) },
    quota: { incrementUsageIfEffectiveQuotaAllows: vi.fn(async () => options.quota ?? true) },
    storageUsage: { rollbackReservations: vi.fn(async () => {}) },
    webdavPath: { invalidateFolders: vi.fn(async () => {}) },
    licenseBinding: { loadLicenseState: vi.fn(async () => ({ refreshToken: null })) },
  }
  return { deps, updates, typed: deps as unknown as Deps }
}

describe('processMediaLibraryScrape', () => {
  it.each([
    [7, 7],
    [0, 1],
    [86_400, 300],
  ])('re-queues after a 429 with Retry-After %s as a %s second delay, keeping what it did [spec: media-scraping/rate-limited]', async (retryAfter, delaySeconds) => {
    const { deps, typed, updates } = makeDeps({
      videos: [video('First (2010).mkv'), video('Second (2010).mkv')],
      search: async (title) => {
        if (title === 'Second') throw new TmdbRateLimitError(retryAfter)
        return [{ id: 1, title, originalTitle: title, year: 2010 }]
      },
    })

    await processMediaLibraryScrape(typed, message)

    expect(deps.mediaLibraries.recordScrape).toHaveBeenCalledOnce()
    expect(deps.jobQueue.dispatch).toHaveBeenCalledExactlyOnceWith(
      {
        ...message,
        request: {
          ...message.request,
          resume: { after: { parent: 'Movies', name: 'First (2010).mkv' }, processed: 1, matched: 1, changed: 1 },
        },
      },
      { delaySeconds },
    )
    expect(updates.at(-1)).toEqual({ progress: { fileCount: 1, currentFilename: null } })
  })

  it('fails as retryable on a TMDB outage, naming the video it stopped at [spec: media-scraping/transient-failure]', async () => {
    const { deps, typed, updates } = makeDeps({
      videos: [video('First (2010).mkv')],
      search: async () => {
        throw new TmdbUnavailableError('TMDB request failed (HTTP 503)')
      },
    })

    await processMediaLibraryScrape(typed, message)

    expect(updates.at(-1)).toMatchObject({
      status: 'failed',
      retryable: true,
      errorMessage: 'TMDB request failed (HTTP 503)',
      progress: { fileCount: 0, currentFilename: 'Movies/First (2010).mkv' },
    })
    expect(deps.mediaLibraries.recordScrape).not.toHaveBeenCalled()
    expect(deps.jobQueue.dispatch).not.toHaveBeenCalled()
  })

  it('stops on a quota failure and deletes the object it could not keep [spec: media-scraping/quota]', async () => {
    const { deps, typed, updates } = makeDeps({ videos: [video('First (2010).mkv')], quota: false })

    await processMediaLibraryScrape(typed, message)

    expect(updates.at(-1)).toMatchObject({
      status: 'failed',
      errorMessage: 'Quota exceeded while writing metadata files. The files written so far are kept.',
    })
    const [[, key]] = deps.s3.putObject.mock.calls as unknown as [[unknown, string]]
    expect(deps.s3.deleteObject).toHaveBeenCalledExactlyOnceWith({ id: 'storage-1' }, key)
    expect(deps.matter.create).not.toHaveBeenCalled()
  })

  it('leaves a sidecar that appears during the write to its owner [spec: media-scraping/scrape-library]', async () => {
    const { deps, typed, updates } = makeDeps({
      videos: [video('First (2010).mkv')],
      create: async () => {
        throw new NameConflictError('First (2010).nfo', 'other')
      },
    })

    await processMediaLibraryScrape(typed, message)

    const [[, key]] = deps.s3.putObject.mock.calls as unknown as [[unknown, string]]
    expect(deps.s3.deleteObject).toHaveBeenCalledWith({ id: 'storage-1' }, key)
    expect(updates.at(-1)).toMatchObject({ status: 'completed', resultMetadata: { matched: 1, unmatched: 0 } })
  })

  it.each([
    ['the library is gone', { state: null }],
    ['its folder is in trash', { state: { ...library, folder: { path: 'Movies', name: 'Movies', trashed: true } } }],
  ])('fails without retry when %s [spec: media-scraping/transient-failure]', async (_label, options) => {
    const { deps, typed, updates } = makeDeps(options)

    await processMediaLibraryScrape(typed, message)

    expect(updates.at(-1)).toMatchObject({ status: 'failed', retryable: false })
    expect(deps.mediaLibraries.listVideosToScrape).not.toHaveBeenCalled()
  })

  it('does not queue a scan for its ids while another scan holds the lease [spec: media-scraping/loop-terminates]', async () => {
    const { deps, typed, updates } = makeDeps({
      videos: [video('First (2010).mkv')],
      state: { ...library, scanning: true },
    })

    await processMediaLibraryScrape(typed, message)

    expect(updates.at(-1)).toMatchObject({ status: 'completed' })
    expect(deps.backgroundJobs.create).not.toHaveBeenCalled()
  })
})

describe('enqueueScrapeAfterScan', () => {
  const view = { ...library, folder: { path: 'Movies', name: 'Movies', trashed: false } }
  const runtime = { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT }

  it('queues nothing without a TMDB token or a license [spec: media-scraping/requires-license]', async () => {
    const unconfigured = makeDeps()
    unconfigured.deps.tmdb.getConfig.mockResolvedValue(null as never)
    await enqueueScrapeAfterScan(unconfigured.typed, message, view, runtime)

    const unlicensed = makeDeps()
    await enqueueScrapeAfterScan(unlicensed.typed, message, view, runtime)

    for (const { deps } of [unconfigured, unlicensed]) {
      expect(deps.mediaLibraries.hasVideosToScrape).not.toHaveBeenCalled()
      expect(deps.backgroundJobs.create).not.toHaveBeenCalled()
    }
  })
})
