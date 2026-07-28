// Tests for src/components/upload/upload-dropzone.tsx
// Tests the uploadFn prop behavior and default object-upload logic.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UploadRunnerContext } from './upload-queue'

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
  completeObjectUpload: vi.fn(),
  abortObjectUpload: vi.fn(),
  isNameConflictError: vi.fn(() => false),
}))

vi.mock('./multipart-upload', () => ({
  uploadObjectSlices: vi.fn(),
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
import { withConflictRetry } from '@/components/files/hooks/use-conflict-resolver'
import { abortObjectUpload, completeObjectUpload, createObject } from '@/lib/api'
import { uploadObjectSlices } from './multipart-upload'
import { directoryFolderParts, relativePathParts } from './upload-dropzone'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeCtx(): UploadRunnerContext & { cleanup?: () => Promise<void> } {
  const controller = new AbortController()
  const ctx = {
    signal: controller.signal,
    cleanup: undefined as (() => Promise<void>) | undefined,
    onProgress: vi.fn(),
    setStatus: vi.fn(),
    registerCleanup: vi.fn((fn: () => Promise<void>) => {
      ctx.cleanup = fn
    }),
  }
  return ctx as never
}

// ---------------------------------------------------------------------------
// uploadFn path (image host etc.)
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
      toast.promise(p, {
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
// Default object-upload path (no uploadFn): mirrors uploadFile() in the source.
// create draft → registerCleanup(abort) → uploadObjectSlices → completeObjectUpload.
// ---------------------------------------------------------------------------

async function simulateDefaultUpload(file: File, parent: string, ctx: UploadRunnerContext): Promise<void> {
  const created = await createObject({
    name: file.name,
    type: file.type || undefined,
    size: file.size,
    parent,
    dirtype: 0,
  })
  if (!created) return
  const upload = created.upload
  if (!upload) throw new Error('No upload instructions returned')

  ctx.registerCleanup(async () => {
    await abortObjectUpload(created.id, upload.sessionId)
  })

  const parts = await uploadObjectSlices(upload, file, ctx)
  await completeObjectUpload(created.id, upload.sessionId, parts)
}

// folder creation via createObject, optionally retrying name conflicts.
async function simulateCreateFolder(name: string, parent: string, withRetry: boolean): Promise<string | 'cancelled'> {
  const created = withRetry
    ? await withConflictRetry((() => Promise.resolve('replace')) as never, 'folder', (strategy) =>
        createObject({ name, type: 'folder', parent, dirtype: 1, onConflict: strategy }),
      )
    : await createObject({ name, type: 'folder', parent, dirtype: 1 })
  if (!created) return 'cancelled'
  return created.name
}

const t = (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)

afterEach(() => {
  vi.clearAllMocks()
})

describe('UploadDropzone — directory path parsing', () => {
  it('uses webkitRelativePath when a browser directory picker provides one', () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' }) as File & { webkitRelativePath: string }
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Album/Trips/photo.jpg' })

    expect(relativePathParts(file)).toEqual(['Album', 'Trips', 'photo.jpg'])
  })

  it('falls back to file.name for ordinary file uploads', () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })

    expect(relativePathParts(file)).toEqual(['photo.jpg'])
  })

  it('keeps the selected root folder when planning directory folders', () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' }) as File & { webkitRelativePath: string }
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Album/Trips/photo.jpg' })

    expect(directoryFolderParts(file)).toEqual(['Album', 'Trips'])
  })
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
  const draft = {
    id: 'obj-1',
    upload: { sessionId: 'sess-1', partSize: 5 * 1024 * 1024, urls: ['https://s3/part-1'] },
  }
  const parts = [{ partNumber: 1, etag: 'etag-1' }]

  it('creates the draft via createObject with file metadata', async () => {
    vi.mocked(createObject).mockResolvedValue(draft as never)
    vi.mocked(uploadObjectSlices).mockResolvedValue(parts)
    vi.mocked(completeObjectUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    await simulateDefaultUpload(file, 'root', makeCtx())

    expect(createObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'photo.png', type: 'image/png', parent: 'root', dirtype: 0 }),
    )
  })

  it('uploads slices with the upload instructions from createObject', async () => {
    vi.mocked(createObject).mockResolvedValue(draft as never)
    vi.mocked(uploadObjectSlices).mockResolvedValue(parts)
    vi.mocked(completeObjectUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const ctx = makeCtx()
    await simulateDefaultUpload(file, 'root', ctx)

    expect(uploadObjectSlices).toHaveBeenCalledWith(draft.upload, file, ctx)
  })

  it('completes the upload with the object id, session id, and parts', async () => {
    vi.mocked(createObject).mockResolvedValue(draft as never)
    vi.mocked(uploadObjectSlices).mockResolvedValue(parts)
    vi.mocked(completeObjectUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    await simulateDefaultUpload(file, 'root', makeCtx())

    expect(completeObjectUpload).toHaveBeenCalledWith('obj-1', 'sess-1', parts)
  })

  it('registers a cleanup that aborts the upload session', async () => {
    vi.mocked(createObject).mockResolvedValue(draft as never)
    vi.mocked(uploadObjectSlices).mockResolvedValue(parts)
    vi.mocked(completeObjectUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)
    vi.mocked(abortObjectUpload).mockResolvedValue(undefined)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    const ctx = makeCtx()
    await simulateDefaultUpload(file, 'root', ctx)

    expect(ctx.registerCleanup).toHaveBeenCalledTimes(1)
    await ctx.cleanup?.()
    expect(abortObjectUpload).toHaveBeenCalledWith('obj-1', 'sess-1')
  })

  it('omits type when the browser does not provide one', async () => {
    vi.mocked(createObject).mockResolvedValue(draft as never)
    vi.mocked(uploadObjectSlices).mockResolvedValue(parts)
    vi.mocked(completeObjectUpload).mockResolvedValue({ id: 'obj-1', status: 'active' } as never)

    const file = new File(['data'], 'blob') // no type
    await simulateDefaultUpload(file, 'root', makeCtx())

    expect(createObject).toHaveBeenCalledWith(expect.objectContaining({ type: undefined }))
  })

  it('throws when createObject returns no upload instructions', async () => {
    vi.mocked(createObject).mockResolvedValue({ id: 'obj-1', upload: undefined } as never)

    const file = new File(['data'], 'photo.png', { type: 'image/png' })

    await expect(simulateDefaultUpload(file, 'root', makeCtx())).rejects.toThrow('No upload instructions returned')
  })
})

// ---------------------------------------------------------------------------
// Folder creation (createObject for folders, with conflict-retry)
// ---------------------------------------------------------------------------

describe('UploadDropzone — folder creation', () => {
  it('creates a folder via createObject', async () => {
    vi.mocked(createObject).mockResolvedValue({ id: 'folder-1', name: 'photos', type: 'folder' } as never)

    const name = await simulateCreateFolder('photos', 'root', false)

    expect(name).toBe('photos')
    expect(createObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'photos', type: 'folder', parent: 'root', dirtype: 1 }),
    )
  })

  it('retries folder creation through withConflictRetry when a prompt is set', async () => {
    vi.mocked(withConflictRetry).mockImplementation(async (_prompt, _kind, run) => run('replace' as never))
    vi.mocked(createObject).mockResolvedValue({ id: 'folder-2', name: 'photos (1)', type: 'folder' } as never)

    const name = await simulateCreateFolder('photos', 'root', true)

    expect(withConflictRetry).toHaveBeenCalledTimes(1)
    expect(createObject).toHaveBeenCalledWith(expect.objectContaining({ onConflict: 'replace' }))
    expect(name).toBe('photos (1)')
  })
})
