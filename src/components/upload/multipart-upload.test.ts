import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadFileInParts } from './multipart-upload'
import type { UploadRunnerContext } from './upload-queue'

const api = vi.hoisted(() => ({
  createObjectUploadSession: vi.fn(),
  presignObjectUploadParts: vi.fn(),
  patchObjectUploadSession: vi.fn(),
  uploadPartToS3: vi.fn(),
  cancelUpload: vi.fn(),
}))

vi.mock('@/lib/api', () => api)

function makeCtx(overrides: Partial<UploadRunnerContext> = {}): UploadRunnerContext & {
  cleanup?: () => Promise<void>
  progress: number[]
} {
  const controller = new AbortController()
  const ctx = {
    signal: controller.signal,
    progress: [] as number[],
    cleanup: undefined as (() => Promise<void>) | undefined,
    onProgress: vi.fn((p: { loaded: number; total: number }) => {
      ctx.progress.push(p.loaded)
    }),
    setStatus: vi.fn(),
    registerCleanup: vi.fn((fn: () => Promise<void>) => {
      ctx.cleanup = fn
    }),
    ...overrides,
  }
  return ctx as never
}

describe('uploadFileInParts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.createObjectUploadSession.mockResolvedValue({ id: 'session-1', partSize: 4 })
    api.presignObjectUploadParts.mockImplementation((_id, _sid, { partNumbers }: { partNumbers: number[] }) =>
      Promise.resolve({
        uploadId: 'mp-1',
        partSize: 4,
        parts: partNumbers.map((n) => ({ partNumber: n, url: `https://s3/part-${n}` })),
      }),
    )
    api.uploadPartToS3.mockImplementation((url: string) => Promise.resolve(`etag-${url.split('-').pop()}`))
    api.patchObjectUploadSession.mockResolvedValue({ id: 'session-1', status: 'completed' })
    api.cancelUpload.mockResolvedValue(undefined)
  })

  it('splits the file into parts and completes with ordered etags', async () => {
    // 10 bytes, partSize 4 -> 3 parts (4, 4, 2)
    const file = new File(['0123456789'], 'big.bin')
    const ctx = makeCtx()

    await uploadFileInParts('obj-1', file, ctx)

    expect(api.uploadPartToS3).toHaveBeenCalledTimes(3)
    // Each presigned part PUTs the correct slice size
    const sentSizes = api.uploadPartToS3.mock.calls.map(([, blob]) => (blob as Blob).size).sort()
    expect(sentSizes).toEqual([2, 4, 4])

    const completeCall = api.patchObjectUploadSession.mock.calls.at(-1)
    expect(completeCall?.[2]).toEqual({
      action: 'complete',
      parts: [
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: 'etag-2' },
        { partNumber: 3, etag: 'etag-3' },
      ],
    })
  })

  it('reports cumulative progress up to the file size', async () => {
    const file = new File(['0123456789'], 'big.bin')
    const ctx = makeCtx()

    await uploadFileInParts('obj-1', file, ctx)

    expect(Math.max(...ctx.progress)).toBe(file.size)
  })

  it('registers a cleanup that aborts the multipart and the draft', async () => {
    const file = new File(['0123456789'], 'big.bin')
    const ctx = makeCtx()

    await uploadFileInParts('obj-1', file, ctx)
    expect(ctx.cleanup).toBeTypeOf('function')

    await ctx.cleanup?.()
    expect(api.patchObjectUploadSession).toHaveBeenCalledWith('obj-1', 'session-1', { action: 'abort' })
    expect(api.cancelUpload).toHaveBeenCalledWith('obj-1')
  })

  it('retries a failing part before succeeding', async () => {
    vi.useFakeTimers()
    api.uploadPartToS3.mockReset()
    api.uploadPartToS3.mockRejectedValueOnce(new Error('network blip')).mockResolvedValue('etag-retry')
    const file = new File(['0123'], 'small-multipart.bin') // 1 part
    const ctx = makeCtx()

    const promise = uploadFileInParts('obj-1', file, ctx)
    await vi.runAllTimersAsync()
    await promise

    expect(api.uploadPartToS3).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
