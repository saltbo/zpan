import {
  cancelUpload,
  createObjectUploadSession,
  patchObjectUploadSession,
  presignObjectUploadParts,
  uploadPartToS3,
} from '@/lib/api'
import type { UploadRunnerContext } from './upload-queue'

/** Files larger than this use S3 multipart (chunked, resumable parts). */
export const MULTIPART_THRESHOLD = 100 * 1024 * 1024
/** Max part numbers presigned per request (matches presignObjectUploadPartsSchema). */
const PRESIGN_BATCH = 100
/** Concurrent part PUTs in flight. */
const PART_CONCURRENCY = 4
/** Retry attempts per part before giving up — survives transient network blips. */
const PART_ATTEMPTS = 3

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

async function uploadPartWithRetry(
  url: string,
  blob: Blob,
  options: { signal: AbortSignal; onProgress: (loaded: number) => void },
): Promise<string> {
  let lastError: unknown
  for (let attempt = 0; attempt < PART_ATTEMPTS; attempt++) {
    try {
      return await uploadPartToS3(url, blob, {
        signal: options.signal,
        onProgress: (p) => options.onProgress(p.loaded),
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
 * Uploads a draft object's bytes via S3 multipart: open session → presign parts
 * in batches → PUT each part (bounded concurrency, per-part retry) → complete.
 * On cancellation the registered cleanup aborts the multipart and the draft.
 */
export async function uploadFileInParts(objectId: string, file: File, ctx: UploadRunnerContext): Promise<void> {
  const session = await createObjectUploadSession(objectId, {})
  ctx.registerCleanup(async () => {
    await patchObjectUploadSession(objectId, session.id, { action: 'abort' }).catch(() => undefined)
    await cancelUpload(objectId).catch(() => undefined)
  })

  const partSize = session.partSize
  const partCount = Math.max(1, Math.ceil(file.size / partSize))
  const completed: Array<{ partNumber: number; etag: string }> = []
  const loadedByPart = new Map<number, number>()

  const reportProgress = () => {
    let loaded = 0
    for (const value of loadedByPart.values()) loaded += value
    ctx.onProgress({ loaded, total: file.size })
  }

  for (let batchStart = 1; batchStart <= partCount; batchStart += PRESIGN_BATCH) {
    if (ctx.signal.aborted) throw new DOMException('Upload cancelled', 'AbortError')
    const partNumbers: number[] = []
    for (let n = batchStart; n < batchStart + PRESIGN_BATCH && n <= partCount; n++) partNumbers.push(n)

    const { parts } = await presignObjectUploadParts(objectId, session.id, { partNumbers })
    await runPool(parts, PART_CONCURRENCY, async ({ partNumber, url }) => {
      const start = (partNumber - 1) * partSize
      const slice = file.slice(start, Math.min(start + partSize, file.size))
      const etag = await uploadPartWithRetry(url, slice, {
        signal: ctx.signal,
        onProgress: (loaded) => {
          loadedByPart.set(partNumber, loaded)
          reportProgress()
        },
      })
      loadedByPart.set(partNumber, slice.size)
      reportProgress()
      completed.push({ partNumber, etag })
    })
  }

  completed.sort((a, b) => a.partNumber - b.partNumber)
  await patchObjectUploadSession(objectId, session.id, { action: 'complete', parts: completed })
}
