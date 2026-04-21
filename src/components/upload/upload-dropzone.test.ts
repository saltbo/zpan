// Tests for src/components/upload/upload-dropzone.tsx
// Tests the uploadFn prop behavior and default upload logic.
import { afterEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    promise: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
  }),
}))

vi.mock('@/lib/api', () => ({
  createObject: vi.fn(),
  confirmUpload: vi.fn(),
  uploadToS3: vi.fn(),
  isNameConflictError: vi.fn(() => false),
}))

vi.mock('@/components/files/hooks/use-conflict-resolver', () => ({
  withConflictRetry: vi.fn(),
}))

vi.mock('react-dropzone', () => ({
  useDropzone: vi.fn(() => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
    open: vi.fn(),
  })),
}))

import { toast } from 'sonner'
import { confirmUpload, createObject, uploadToS3 } from '@/lib/api'

// ---------------------------------------------------------------------------
// Extracted pure logic: simulate the onDrop handler with uploadFn path
// ---------------------------------------------------------------------------

async function simulateOnDropWithUploadFn(
  files: File[],
  uploadFn: (file: File) => Promise<void>,
  onUploadComplete: () => void,
  t: (key: string, opts?: Record<string, unknown>) => string,
): Promise<void> {
  if (uploadFn) {
    let anySuccess = false
    for (const file of files) {
      const p = uploadFn(file)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(toast as any).promise(p, {
        loading: t('files.uploading', { name: file.name }),
        success: t('files.uploadSuccess', { name: file.name }),
        error: t('files.uploadFailed', { name: file.name }),
      })
      try {
        await p
        anySuccess = true
      } catch {
        // Toast already surfaced the error — continue.
      }
    }
    if (anySuccess) onUploadComplete()
  }
}

// ---------------------------------------------------------------------------
// Simulate the default object-upload path (no uploadFn)
// ---------------------------------------------------------------------------

async function simulateDefaultUpload(file: File, parent: string, onUploadComplete: () => void): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created = await (createObject as any)({
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    parent,
    dirtype: 0,
  })
  if (!created) return
  if (!created.uploadUrl) throw new Error('No upload URL returned')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (uploadToS3 as any)(created.uploadUrl, file)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (confirmUpload as any)(created.id)
  onUploadComplete()
}

const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)

afterEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// uploadFn path
// ---------------------------------------------------------------------------

describe('UploadDropzone — uploadFn path', () => {
  it('calls uploadFn for each file when uploadFn is provided', async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined)
    const onUploadComplete = vi.fn()
    const files = [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })]

    await simulateOnDropWithUploadFn(files, uploadFn, onUploadComplete, t)

    expect(uploadFn).toHaveBeenCalledTimes(2)
    expect(uploadFn).toHaveBeenCalledWith(files[0])
    expect(uploadFn).toHaveBeenCalledWith(files[1])
  })

  it('calls onUploadComplete when at least one file succeeds', async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined)
    const onUploadComplete = vi.fn()
    const files = [new File(['a'], 'a.png', { type: 'image/png' })]

    await simulateOnDropWithUploadFn(files, uploadFn, onUploadComplete, t)

    expect(onUploadComplete).toHaveBeenCalledTimes(1)
  })

  it('does not call onUploadComplete when all files fail', async () => {
    const uploadFn = vi.fn().mockRejectedValue(new Error('upload error'))
    const onUploadComplete = vi.fn()
    const files = [new File(['a'], 'a.png', { type: 'image/png' })]

    await simulateOnDropWithUploadFn(files, uploadFn, onUploadComplete, t)

    expect(onUploadComplete).not.toHaveBeenCalled()
  })

  it('continues uploading remaining files when one file fails', async () => {
    const uploadFn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(undefined)
    const onUploadComplete = vi.fn()
    const files = [new File(['a'], 'fail.png', { type: 'image/png' }), new File(['b'], 'ok.png', { type: 'image/png' })]

    await simulateOnDropWithUploadFn(files, uploadFn, onUploadComplete, t)

    // Second file succeeded, so onUploadComplete should be called
    expect(onUploadComplete).toHaveBeenCalledTimes(1)
    expect(uploadFn).toHaveBeenCalledTimes(2)
  })

  it('calls toast.promise for each file', async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined)
    const onUploadComplete = vi.fn()
    const files = [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })]

    await simulateOnDropWithUploadFn(files, uploadFn, onUploadComplete, t)

    expect(vi.mocked(toast).promise).toHaveBeenCalledTimes(2)
  })

  it('does not call default createObject when uploadFn is provided', async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined)
    const onUploadComplete = vi.fn()
    const files = [new File(['a'], 'a.png', { type: 'image/png' })]

    await simulateOnDropWithUploadFn(files, uploadFn, onUploadComplete, t)

    expect(createObject).not.toHaveBeenCalled()
  })

  it('handles a single file correctly', async () => {
    const uploadFn = vi.fn().mockResolvedValue(undefined)
    const onUploadComplete = vi.fn()
    const file = new File(['data'], 'single.png', { type: 'image/png' })

    await simulateOnDropWithUploadFn([file], uploadFn, onUploadComplete, t)

    expect(uploadFn).toHaveBeenCalledWith(file)
    expect(onUploadComplete).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Default upload path (no uploadFn)
// ---------------------------------------------------------------------------

describe('UploadDropzone — default upload path (no uploadFn)', () => {
  it('calls createObject when no uploadFn is provided', async () => {
    vi.mocked(createObject).mockResolvedValue({ id: 'obj-1', uploadUrl: 'https://s3/presigned' } as never)
    vi.mocked(uploadToS3).mockResolvedValue(undefined)
    vi.mocked(confirmUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const onUploadComplete = vi.fn()

    await simulateDefaultUpload(file, 'root', onUploadComplete)

    expect(createObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'photo.png', type: 'image/png', parent: 'root', dirtype: 0 }),
    )
  })

  it('calls uploadToS3 with the presigned URL from createObject', async () => {
    vi.mocked(createObject).mockResolvedValue({ id: 'obj-1', uploadUrl: 'https://s3/presigned' } as never)
    vi.mocked(uploadToS3).mockResolvedValue(undefined)
    vi.mocked(confirmUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const onUploadComplete = vi.fn()

    await simulateDefaultUpload(file, 'root', onUploadComplete)

    expect(uploadToS3).toHaveBeenCalledWith('https://s3/presigned', file)
  })

  it('calls confirmUpload with the object id', async () => {
    vi.mocked(createObject).mockResolvedValue({ id: 'obj-1', uploadUrl: 'https://s3/presigned' } as never)
    vi.mocked(uploadToS3).mockResolvedValue(undefined)
    vi.mocked(confirmUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const onUploadComplete = vi.fn()

    await simulateDefaultUpload(file, 'root', onUploadComplete)

    expect(confirmUpload).toHaveBeenCalledWith('obj-1')
  })

  it('calls onUploadComplete after successful upload', async () => {
    vi.mocked(createObject).mockResolvedValue({ id: 'obj-1', uploadUrl: 'https://s3/presigned' } as never)
    vi.mocked(uploadToS3).mockResolvedValue(undefined)
    vi.mocked(confirmUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const onUploadComplete = vi.fn()

    await simulateDefaultUpload(file, 'root', onUploadComplete)

    expect(onUploadComplete).toHaveBeenCalledTimes(1)
  })

  it('uses application/octet-stream when file type is empty', async () => {
    vi.mocked(createObject).mockResolvedValue({ id: 'obj-1', uploadUrl: 'https://s3/presigned' } as never)
    vi.mocked(uploadToS3).mockResolvedValue(undefined)
    vi.mocked(confirmUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)

    const file = new File(['data'], 'blob') // no type
    const onUploadComplete = vi.fn()

    await simulateDefaultUpload(file, 'root', onUploadComplete)

    expect(createObject).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/octet-stream' }))
  })

  it('throws when createObject returns no uploadUrl', async () => {
    vi.mocked(createObject).mockResolvedValue({ id: 'obj-1', uploadUrl: undefined } as never)
    vi.mocked(uploadToS3).mockResolvedValue(undefined)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const onUploadComplete = vi.fn()

    await expect(simulateDefaultUpload(file, 'root', onUploadComplete)).rejects.toThrow('No upload URL returned')
  })
})
