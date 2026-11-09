import { createHash } from 'node:crypto'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { DirType, ZPAN_CLOUD_URL_DEFAULT } from '@shared/constants'
import type { BackgroundJob } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3'
import { MEDIA_LIBRARY_INDEX_MIME, mediaLibraryFeedItems } from '../domain/media-library'
import type { Deps } from './deps'
import { processMediaLibraryScan } from './media-library-scan'
import type { Matter, MediaLibraryFileCursor, MediaLibraryState } from './ports'

setFlagsFromString('--expose-gc')
const gc = runInNewContext('gc') as () => void

const VIDEO_COUNT = 200_000
const MB = 1024 * 1024
const generatedAt = new Date('2026-11-09T00:00:00.000Z')

const library: MediaLibraryState = {
  id: 'lib-1',
  orgId: 'org-1',
  folderId: 'folder-1',
  folder: { path: 'Movies', name: 'Movies', trashed: false },
  fingerprint: null,
  lastScannedAt: null,
  scanning: true,
  scraping: false,
  createdByUserId: 'user-1',
  createdBy: { type: 'user', ref: 'user-1', issuer: null },
  createdAt: generatedAt,
  updatedAt: generatedAt,
}

// File i sits on shelf floor(i / 1000); names sort in index order, so the
// cursor alone says where the next page starts.
function video(i: number): Matter {
  return {
    id: `video-${i}`,
    orgId: 'org-1',
    name: `Movie Title ${String(i).padStart(7, '0')} (2010).mkv`,
    parent: `Movies/Shelf ${String(Math.floor(i / 1000)).padStart(4, '0')}`,
    type: 'application/octet-stream',
    size: 1_000_000 + i,
    dirtype: DirType.FILE,
    updatedAt: generatedAt,
  } as Matter
}

function indexAfter(cursor: MediaLibraryFileCursor | null): number {
  return cursor ? Number(/Movie Title (\d+)/.exec(cursor.name)?.[1]) + 1 : 0
}

// Typed-array bytes live outside the JS heap, and the upload buffers its parts there.
function liveMemory(): number {
  gc()
  const { heapUsed, arrayBuffers } = process.memoryUsage()
  return heapUsed + arrayBuffers
}

// The real S3 adapter with only its network calls stubbed, so its multipart
// buffering counts toward the measured heap. Stubs that see page or part data
// are plain functions: a vi.fn would retain every argument and result.
function stubbedS3(onPart: (bytes: Uint8Array) => void) {
  const s3 = new S3Service()
  vi.spyOn(s3, 'createMultipartUpload').mockResolvedValue('upload-1')
  vi.spyOn(s3, 'completeMultipartUpload').mockResolvedValue()
  vi.spyOn(s3, 'deleteObject').mockResolvedValue()
  Object.assign(s3, {
    async uploadPart(
      _client: unknown,
      _bucket: string,
      _key: string,
      _uploadId: string,
      partNumber: number,
      body: Uint8Array,
    ) {
      onPart(body)
      return { ETag: `etag-${partNumber}`, PartNumber: partNumber }
    },
  })
  return s3
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('media library scan memory', () => {
  it('streams a 200k-video library into one index with bounded memory [spec: media-library/bounded-memory-scan]', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(generatedAt)
    const events: Array<'page' | 'renew'> = []
    const updates: Record<string, unknown>[] = []
    const streamed = createHash('sha256')
    let streamedBytes = 0
    let streamedPeak = 0
    const baseline = liveMemory()
    const s3 = stubbedS3((part) => {
      streamed.update(part)
      streamedBytes += part.byteLength
      streamedPeak = Math.max(streamedPeak, liveMemory() - baseline)
    })
    const deps = {
      backgroundJobs: {
        update: vi.fn(async (_orgId: string, _id: string, input: Record<string, unknown>) => {
          if (input.progress && !input.status) events.push('renew')
          updates.push(input)
          return input as unknown as BackgroundJob
        }),
      },
      mediaLibraries: {
        get: vi.fn(async () => library),
        listByOrg: vi.fn(async () => [library]),
        fingerprint: vi.fn(async () => '1:1:1:1'),
        recordScan: vi.fn(async () => {}),
        async listVideoFilesPage(
          _orgId: string,
          _path: string,
          _extensions: readonly string[],
          page: { after: MediaLibraryFileCursor | null; limit: number },
        ) {
          events.push('page')
          const start = indexAfter(page.after)
          const end = Math.min(start + page.limit, VIDEO_COUNT)
          const files = Array.from({ length: Math.max(0, end - start) }, (_, k) => video(start + k))
          streamedPeak = Math.max(streamedPeak, liveMemory() - baseline)
          return files
        },
      },
      matter: {
        findActiveConflict: vi.fn(async () => ({
          id: 'index-1',
          name: 'library.json',
          parent: 'Movies',
          type: MEDIA_LIBRARY_INDEX_MIME,
          dirtype: DirType.FILE,
          size: 0,
          object: 'objects/old.json',
          storageId: 'storage-1',
        })),
        applyUpload: vi.fn(async () => {}),
      },
      storages: { get: vi.fn(async () => ({ id: 'storage-1', bucket: 'bucket' })) },
      s3,
      quota: { incrementUsageIfEffectiveQuotaAllows: vi.fn(async () => true) },
      storageUsage: { rollbackReservations: vi.fn(async () => {}) },
      webdavPath: { invalidateFolders: vi.fn(async () => {}) },
      tmdb: { getConfig: vi.fn(async () => null) },
    }

    const job = await processMediaLibraryScan(
      deps as unknown as Deps,
      {
        jobId: 'job-1',
        orgId: 'org-1',
        userId: 'user-1',
        createdBy: { type: 'user', ref: 'user-1', issuer: null },
        request: { type: 'media_library_scan', libraryId: 'lib-1' },
      },
      { cloudBaseUrl: ZPAN_CLOUD_URL_DEFAULT },
    )
    expect(job).toMatchObject({ status: 'completed', resultMetadata: { itemCount: VIDEO_COUNT } })

    // The whole-feed write this replaced held every row, item, the JSON string,
    // and its bytes at once.
    const before = liveMemory()
    const files = Array.from({ length: VIDEO_COUNT }, (_, i) => video(i))
    const items = mediaLibraryFeedItems({ folderPath: 'Movies', folderName: 'Movies' }, files)
    const json = JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'Movies',
      _zpan: { generatedAt: generatedAt.toISOString(), libraryId: 'lib-1' },
      items,
    })
    const bytes = new TextEncoder().encode(json)
    const wholePeak = liveMemory() - before

    expect(streamedBytes).toBe(bytes.byteLength)
    expect(streamed.digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(deps.matter.applyUpload).toHaveBeenCalledWith(
      'org-1',
      expect.anything(),
      expect.objectContaining({ size: bytes.byteLength }),
    )
    const runsWithoutRenewal = events
      .join('')
      .split('renew')
      .map((run) => run.length / 'page'.length)
    expect(Math.max(...runsWithoutRenewal)).toBeLessThanOrEqual(10)
    console.info(
      `media_library.memory videos=${VIDEO_COUNT} bytes=${bytes.byteLength} streamed_peak_mb=${(streamedPeak / MB).toFixed(1)} whole_peak_mb=${(wholePeak / MB).toFixed(1)}`,
    )
    expect(streamedPeak).toBeLessThan(24 * MB)
    expect(wholePeak).toBeGreaterThan(5 * streamedPeak)
  }, 120_000)
})
