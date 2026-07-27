import type { ObjectUploadInstructions } from '@shared/types'
import { uploadPartToS3 } from '@/lib/api'
import type { UploadRunnerContext } from './upload-queue'

/** Concurrent slice PUTs in flight. */
const PART_CONCURRENCY = 4
/** Retry attempts per slice before giving up — survives transient network blips. */
const PART_ATTEMPTS = 3

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

async function uploadPartWithRetry(
  url: string,
  blob: Blob,
  options: { signal: AbortSignal; onProgress: (loaded: number) => void; contentType?: string },
): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < PART_ATTEMPTS; attempt++) {
    try {
      return await uploadPartToS3(url, blob, {
        signal: options.signal,
        onProgress: (p) => options.onProgress(p.loaded),
        contentType: options.contentType,
      })
    } catch (error) {
      if (isAbortError(error)) throw error
      lastError = error
      options.onProgress(0)
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw lastError
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  })
  await Promise.all(runners)
}

/**
 * The uniform upload: PUT every presigned slice directly to S3 (1 URL = single
 * PutObject, N URLs = 5 GiB-part multipart — the server already decided), read
 * each slice's ETag, and return them sorted for the completions call. Bounded
 * concurrency, per-slice retry, aggregated progress. Bytes never touch our server.
 */
export async function uploadObjectSlices(
  upload: ObjectUploadInstructions,
  file: File,
  ctx: UploadRunnerContext,
): Promise<Array<{ partNumber: number; etag: string }>> {
  const { partSize, urls } = upload
  const completed: Array<{ partNumber: number; etag: string }> = []
  const loadedByPart = new Map<number, number>()

  const reportProgress = () => {
    let loaded = 0
    for (const value of loadedByPart.values()) loaded += value
    ctx.onProgress({ loaded, total: file.size })
  }

  const slices = urls.map((url, index) => ({ url, partNumber: index + 1 }))
  await runPool(slices, PART_CONCURRENCY, async ({ url, partNumber }) => {
    if (ctx.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
    const start = (partNumber - 1) * partSize
    const slice = file.slice(start, Math.min(start + partSize, file.size))
    const etag = await uploadPartWithRetry(url, slice, {
      signal: ctx.signal,
      contentType: file.type || undefined,
      onProgress: (loaded) => {
        loadedByPart.set(partNumber, loaded)
        reportProgress()
      },
    })
    loadedByPart.set(partNumber, slice.size)
    reportProgress()
    completed.push({ partNumber, etag })
  })

  completed.sort((a, b) => a.partNumber - b.partNumber)
  return completed
}
