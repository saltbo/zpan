import type { ObjectUploadInstructions } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadObjectSlices } from './multipart-upload'
import type { UploadRunnerContext } from './upload-queue'

const api = vi.hoisted(() => ({
  uploadPartToS3: vi.fn(),
}))

vi.mock('@/lib/api', () => api)

function makeCtx(overrides: Partial<UploadRunnerContext> = {}): UploadRunnerContext & {
  progress: number[]
} {
  const controller = new AbortController()
  const ctx = {
    signal: controller.signal,
    progress: [] as number[],
    onProgress: vi.fn((p: { loaded: number; total: number }) => {
      ctx.progress.push(p.loaded)
    }),
    setStatus: vi.fn(),
    registerCleanup: vi.fn(),
    ...overrides,
  }
  return ctx as never
}

function makeUpload(urls: string[], partSize: number): ObjectUploadInstructions {
  return { sessionId: 'sess-1', partSize, urls }
}

describe('uploadObjectSlices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.uploadPartToS3.mockImplementation((url: string) => Promise.resolve(`etag-${url.split('-').pop()}`))
  })

  it('PUTs the single URL and returns one part (single-PUT case)', async () => {
    const file = new File(['0123456789'], 'small.bin') // 10 bytes, 1 url
    const ctx = makeCtx()

    const parts = await uploadObjectSlices(makeUpload(['https://s3/part-1'], file.size), file, ctx)

    expect(api.uploadPartToS3).toHaveBeenCalledTimes(1)
    const [url, blob] = api.uploadPartToS3.mock.calls[0]
    expect(url).toBe('https://s3/part-1')
    expect((blob as Blob).size).toBe(10)
    expect(parts).toEqual([{ partNumber: 1, etag: 'etag-1' }])
  })

  it('slices the file by partSize across N URLs and returns parts sorted by partNumber', async () => {
    // 10 bytes, partSize 4 -> 3 slices (4, 4, 2)
    const file = new File(['0123456789'], 'big.bin')
    const ctx = makeCtx()

    const parts = await uploadObjectSlices(
      makeUpload(['https://s3/part-1', 'https://s3/part-2', 'https://s3/part-3'], 4),
      file,
      ctx,
    )

    expect(api.uploadPartToS3).toHaveBeenCalledTimes(3)
    const sentSizes = api.uploadPartToS3.mock.calls.map(([, blob]) => (blob as Blob).size).sort((a, b) => a - b)
    expect(sentSizes).toEqual([2, 4, 4])

    expect(parts).toEqual([
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 3, etag: 'etag-3' },
    ])
  })

  it('reports cumulative progress up to the file size', async () => {
    const file = new File(['0123456789'], 'big.bin')
    const ctx = makeCtx()

    await uploadObjectSlices(makeUpload(['https://s3/part-1', 'https://s3/part-2', 'https://s3/part-3'], 4), file, ctx)

    expect(Math.max(...ctx.progress)).toBe(file.size)
  })

  it('retries a failing part before succeeding', async () => {
    vi.useFakeTimers()
    api.uploadPartToS3.mockReset()
    api.uploadPartToS3.mockRejectedValueOnce(new Error('network blip')).mockResolvedValue('etag-retry')
    const file = new File(['0123'], 'small-multipart.bin') // 1 part
    const ctx = makeCtx()

    const promise = uploadObjectSlices(makeUpload(['https://s3/part-1'], file.size), file, ctx)
    await vi.runAllTimersAsync()
    const parts = await promise

    expect(api.uploadPartToS3).toHaveBeenCalledTimes(2)
    expect(parts).toEqual([{ partNumber: 1, etag: 'etag-retry' }])
    vi.useRealTimers()
  })

  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const file = new File(['0123456789'], 'big.bin')
    const ctx = makeCtx({ signal: controller.signal })

    await expect(uploadObjectSlices(makeUpload(['https://s3/part-1'], file.size), file, ctx)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(api.uploadPartToS3).not.toHaveBeenCalled()
  })

  it('propagates an AbortError thrown by uploadPartToS3 without retrying', async () => {
    api.uploadPartToS3.mockReset()
    api.uploadPartToS3.mockRejectedValue(new DOMException('Upload cancelled', 'AbortError'))
    const file = new File(['0123'], 'aborted.bin')
    const ctx = makeCtx()

    await expect(uploadObjectSlices(makeUpload(['https://s3/part-1'], file.size), file, ctx)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(api.uploadPartToS3).toHaveBeenCalledTimes(1)
  })
})
