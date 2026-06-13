import { describe, expect, it, vi } from 'vitest'
import type { Platform } from '../../platform/interface'
import type { S3Gateway, StorageRecord, StorageRepo } from '../../usecases/ports'
import { createImageUploadGateway, isImageMime } from './image-upload'

// biome-ignore lint/suspicious/noExplicitAny: test stub intentionally opaque
type Any = any

function mockR2Bucket() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function mockPlatform(opts: { r2?: ReturnType<typeof mockR2Bucket>; publicUrl?: string } = {}): Platform {
  return {
    db: {} as Any,
    getEnv: (key) => (key === 'PUBLIC_IMAGES_URL' ? opts.publicUrl : undefined),
    getBinding: <T>(key: string) => (key === 'PUBLIC_IMAGES' && opts.r2 ? (opts.r2 as unknown as T) : undefined),
  }
}

// A StorageRepo whose `select('public')` either returns a storage or throws
// (no public storage configured). Only `select` is exercised by the gateway.
function mockStorages(opts: { storage?: StorageRecord; selectThrows?: boolean } = {}): StorageRepo {
  return {
    select: async () => {
      if (opts.selectThrows) throw new Error('no storage')
      return opts.storage as StorageRecord
    },
  } as unknown as StorageRepo
}

function mockS3() {
  return {
    putObject: vi.fn().mockResolvedValue(16),
    getPublicUrl: vi.fn().mockReturnValue('https://s3.example/bucket/key'),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  } as unknown as S3Gateway & {
    putObject: ReturnType<typeof vi.fn>
    getPublicUrl: ReturnType<typeof vi.fn>
    deleteObject: ReturnType<typeof vi.fn>
  }
}

function makeFile(type: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], `f.${type.split('/')[1]}`, { type })
}

describe('isImageMime', () => {
  it('accepts png/jpeg/webp', () => {
    expect(isImageMime('image/png')).toBe(true)
    expect(isImageMime('image/jpeg')).toBe(true)
    expect(isImageMime('image/webp')).toBe(true)
  })

  it('rejects other mimes', () => {
    expect(isImageMime('image/gif')).toBe(false)
    expect(isImageMime('application/pdf')).toBe(false)
    expect(isImageMime('')).toBe(false)
    expect(isImageMime(undefined)).toBe(false)
    expect(isImageMime(42)).toBe(false)
  })
})

describe('uploadPublicImage — R2 binding path', () => {
  it('uses R2 binding when PUBLIC_IMAGES + PUBLIC_IMAGES_URL both set', async () => {
    const r2 = mockR2Bucket()
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    const result = await gw.uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://pub-abc.r2.dev/_system/avatars/u1.png')
    expect(r2.put).toHaveBeenCalledOnce()
    expect(r2.put.mock.calls[0]?.[0]).toBe('_system/avatars/u1.png')
    expect(r2.put.mock.calls[0]?.[2]).toEqual({ httpMetadata: { contentType: 'image/png' } })
  })

  it('maps mime to correct file extension (jpeg → jpg)', async () => {
    const r2 = mockR2Bucket()
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    const result = await gw.uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/jpeg'))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toMatch(/\.jpg$/)
  })

  it('trims a trailing slash in PUBLIC_IMAGES_URL', async () => {
    const r2 = mockR2Bucket()
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev/' })

    const result = await gw.uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://pub-abc.r2.dev/_system/avatars/u1.png')
  })

  it('rejects invalid mime (gif) before touching R2', async () => {
    const r2 = mockR2Bucket()
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    const result = await gw.uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/gif'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
    expect(r2.put).not.toHaveBeenCalled()
  })

  it('rejects file > 2 MiB before touching R2', async () => {
    const r2 = mockR2Bucket()
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    const result = await gw.uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png', 3 * 1024 * 1024))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(413)
    expect(r2.put).not.toHaveBeenCalled()
  })

  it('falls back to S3 path when binding is missing (PUBLIC_IMAGES_URL alone ignored)', async () => {
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform({ publicUrl: 'https://pub-abc.r2.dev' })

    const result = await gw.uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
  })

  it('falls back to S3 path when PUBLIC_IMAGES_URL is missing (binding alone ignored)', async () => {
    const r2 = mockR2Bucket()
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform({ r2 })

    const result = await gw.uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
    expect(r2.put).not.toHaveBeenCalled()
  })

  it('returns 503 when neither binding nor public S3 storage is available', async () => {
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform()

    const result = await gw.uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
  })

  it('uploads via S3 gateway when a public storage is configured', async () => {
    const s3 = mockS3()
    const storage = { id: 's1', bucket: 'b', endpoint: 'https://s3.example' } as unknown as StorageRecord
    const gw = createImageUploadGateway(s3, mockStorages({ storage }))
    const platform = mockPlatform()

    const result = await gw.uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://s3.example/bucket/key')
    expect(s3.putObject).toHaveBeenCalledOnce()
    expect(s3.putObject.mock.calls[0]?.[1]).toBe('_system/avatars/u1.png')
    expect(s3.getPublicUrl.mock.calls[0]?.[1]).toBe('_system/avatars/u1.png')
  })
})

describe('deletePublicImageVariants — R2 binding path', () => {
  it('deletes all 3 mime variants via R2 binding', async () => {
    const r2 = mockR2Bucket()
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    await gw.deletePublicImageVariants(platform, '_system/avatars', 'u1')

    expect(r2.delete).toHaveBeenCalledTimes(3)
    const keys = r2.delete.mock.calls.map((c) => c[0] as string)
    expect(keys).toContain('_system/avatars/u1.png')
    expect(keys).toContain('_system/avatars/u1.jpg')
    expect(keys).toContain('_system/avatars/u1.webp')
  })

  it('deletes all 3 mime variants via S3 gateway when a public storage is configured', async () => {
    const s3 = mockS3()
    const storage = { id: 's1', bucket: 'b', endpoint: 'https://s3.example' } as unknown as StorageRecord
    const gw = createImageUploadGateway(s3, mockStorages({ storage }))
    const platform = mockPlatform()

    await gw.deletePublicImageVariants(platform, '_system/avatars', 'u1')

    expect(s3.deleteObject).toHaveBeenCalledTimes(3)
    const keys = s3.deleteObject.mock.calls.map((c) => c[1] as string)
    expect(keys).toContain('_system/avatars/u1.png')
    expect(keys).toContain('_system/avatars/u1.jpg')
    expect(keys).toContain('_system/avatars/u1.webp')
  })

  it('is a no-op when no backend is configured', async () => {
    const gw = createImageUploadGateway(mockS3(), mockStorages({ selectThrows: true }))
    const platform = mockPlatform()
    await expect(gw.deletePublicImageVariants(platform, '_system/avatars', 'u1')).resolves.toBeUndefined()
  })
})
