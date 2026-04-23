import { describe, expect, it, vi } from 'vitest'
import type { Platform } from '../platform/interface'
import { deletePublicImageVariants, isImageMime, uploadPublicImage } from './image-upload'

// biome-ignore lint/suspicious/noExplicitAny: test stub intentionally opaque
type Any = any

function mockR2Bucket() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function mockPlatform(
  opts: { r2?: ReturnType<typeof mockR2Bucket>; publicUrl?: string; dbStorage?: Any; dbStorageThrows?: boolean } = {},
): Platform {
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () =>
                opts.dbStorageThrows
                  ? (() => {
                      throw new Error('no storage')
                    })()
                  : opts.dbStorage
                    ? [opts.dbStorage]
                    : [],
            }),
          }),
        }),
      }),
    } as Any,
    getEnv: (key) => (key === 'PUBLIC_IMAGES_URL' ? opts.publicUrl : undefined),
    getBinding: <T>(key: string) => (key === 'PUBLIC_IMAGES' && opts.r2 ? (opts.r2 as unknown as T) : undefined),
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
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    const result = await uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://pub-abc.r2.dev/_system/avatars/u1.png')
    expect(r2.put).toHaveBeenCalledOnce()
    expect(r2.put.mock.calls[0]?.[0]).toBe('_system/avatars/u1.png')
    expect(r2.put.mock.calls[0]?.[2]).toEqual({ httpMetadata: { contentType: 'image/png' } })
  })

  it('maps mime to correct file extension (jpeg → jpg)', async () => {
    const r2 = mockR2Bucket()
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    const result = await uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/jpeg'))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toMatch(/\.jpg$/)
  })

  it('trims a trailing slash in PUBLIC_IMAGES_URL', async () => {
    const r2 = mockR2Bucket()
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev/' })

    const result = await uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://pub-abc.r2.dev/_system/avatars/u1.png')
  })

  it('rejects invalid mime (gif) before touching R2', async () => {
    const r2 = mockR2Bucket()
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    const result = await uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/gif'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
    expect(r2.put).not.toHaveBeenCalled()
  })

  it('rejects file > 2 MiB before touching R2', async () => {
    const r2 = mockR2Bucket()
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    const result = await uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png', 3 * 1024 * 1024))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(413)
    expect(r2.put).not.toHaveBeenCalled()
  })

  it('falls back to S3 path when binding is missing (PUBLIC_IMAGES_URL alone ignored)', async () => {
    const platform = mockPlatform({ publicUrl: 'https://pub-abc.r2.dev', dbStorageThrows: true })

    const result = await uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
  })

  it('falls back to S3 path when PUBLIC_IMAGES_URL is missing (binding alone ignored)', async () => {
    const r2 = mockR2Bucket()
    const platform = mockPlatform({ r2, dbStorageThrows: true })

    const result = await uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
    expect(r2.put).not.toHaveBeenCalled()
  })

  it('returns 503 when neither binding nor DB storage is available', async () => {
    const platform = mockPlatform({ dbStorageThrows: true })

    const result = await uploadPublicImage(platform, '_system/avatars', 'u1', makeFile('image/png'))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
  })
})

describe('deletePublicImageVariants — R2 binding path', () => {
  it('deletes all 3 mime variants via R2 binding', async () => {
    const r2 = mockR2Bucket()
    const platform = mockPlatform({ r2, publicUrl: 'https://pub-abc.r2.dev' })

    await deletePublicImageVariants(platform, '_system/avatars', 'u1')

    expect(r2.delete).toHaveBeenCalledTimes(3)
    const keys = r2.delete.mock.calls.map((c) => c[0] as string)
    expect(keys).toContain('_system/avatars/u1.png')
    expect(keys).toContain('_system/avatars/u1.jpg')
    expect(keys).toContain('_system/avatars/u1.webp')
  })

  it('is a no-op when no backend is configured', async () => {
    const platform = mockPlatform({ dbStorageThrows: true })
    await expect(deletePublicImageVariants(platform, '_system/avatars', 'u1')).resolves.toBeUndefined()
  })
})
