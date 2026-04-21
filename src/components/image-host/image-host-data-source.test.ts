// Tests for src/components/image-host/image-host-data-source.ts
import { DirType } from '@shared/constants'
import type { ImageHosting } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  listIhostImages: vi.fn(),
  createIhostImagePresign: vi.fn(),
  uploadToS3: vi.fn(),
  confirmIhostImage: vi.fn(),
  deleteIhostImage: vi.fn(),
}))

import { confirmIhostImage, createIhostImagePresign, deleteIhostImage, listIhostImages, uploadToS3 } from '@/lib/api'
import { imageHostDataSource } from './image-host-data-source'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImageHosting(overrides: Partial<ImageHosting> = {}): ImageHosting {
  return {
    id: 'img-1',
    orgId: 'org-1',
    token: 'tok_abc',
    path: 'folder/photo.png',
    storageId: 'stor-1',
    storageKey: 'ih/tok_abc',
    size: 1024,
    mime: 'image/png',
    width: 800,
    height: 600,
    status: 'active',
    accessCount: 5,
    lastAccessedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------------

describe('imageHostDataSource.list', () => {
  beforeEach(() => {
    vi.mocked(listIhostImages).mockResolvedValue({ items: [], nextCursor: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls listIhostImages with limit 200', async () => {
    await imageHostDataSource.list('', {})

    expect(listIhostImages).toHaveBeenCalledWith({ limit: 200 })
  })

  it('returns items mapped to IhostItems', async () => {
    const img = makeImageHosting()
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe('img-1')
  })

  it('maps name from the last segment of path', async () => {
    const img = makeImageHosting({ path: 'folder/photo.png' })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    expect(result.items[0].name).toBe('photo.png')
  })

  it('maps type from mime', async () => {
    const img = makeImageHosting({ mime: 'image/jpeg' })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    expect(result.items[0].type).toBe('image/jpeg')
  })

  it('maps size correctly', async () => {
    const img = makeImageHosting({ size: 2048 })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    expect(result.items[0].size).toBe(2048)
  })

  it('sets dirtype to FILE', async () => {
    const img = makeImageHosting()
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    expect(result.items[0].dirtype).toBe(DirType.FILE)
  })

  it('maps token from img.token', async () => {
    const img = makeImageHosting({ token: 'tok_xyz' })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    // Cast to IhostItem to access extra fields
    const ihostItem = result.items[0] as { token: string }
    expect(ihostItem.token).toBe('tok_xyz')
  })

  it('computes url as /r/${token}.${ext} for png mime', async () => {
    const img = makeImageHosting({ token: 'tok_abc', mime: 'image/png' })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    const ihostItem = result.items[0] as { url: string }
    expect(ihostItem.url).toBe('/r/tok_abc.png')
  })

  it('computes url with jpg ext for image/jpeg mime', async () => {
    const img = makeImageHosting({ token: 'tok_jpg', mime: 'image/jpeg' })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    const ihostItem = result.items[0] as { url: string }
    expect(ihostItem.url).toBe('/r/tok_jpg.jpg')
  })

  it('computes url with gif ext for image/gif mime', async () => {
    const img = makeImageHosting({ token: 'tok_gif', mime: 'image/gif' })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    const ihostItem = result.items[0] as { url: string }
    expect(ihostItem.url).toBe('/r/tok_gif.gif')
  })

  it('computes url with webp ext for image/webp mime', async () => {
    const img = makeImageHosting({ token: 'tok_webp', mime: 'image/webp' })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    const ihostItem = result.items[0] as { url: string }
    expect(ihostItem.url).toBe('/r/tok_webp.webp')
  })

  it('computes url with bin ext for unknown mime', async () => {
    const img = makeImageHosting({ token: 'tok_unk', mime: 'application/octet-stream' })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    const ihostItem = result.items[0] as { url: string }
    expect(ihostItem.url).toBe('/r/tok_unk.bin')
  })

  it('computes dimensions string when width and height are set', async () => {
    const img = makeImageHosting({ width: 800, height: 600 })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    const ihostItem = result.items[0] as { dimensions: string | null }
    expect(ihostItem.dimensions).toBe('800×600')
  })

  it('sets dimensions to null when width is null', async () => {
    const img = makeImageHosting({ width: null, height: 600 })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    const ihostItem = result.items[0] as { dimensions: string | null }
    expect(ihostItem.dimensions).toBeNull()
  })

  it('sets dimensions to null when height is null', async () => {
    const img = makeImageHosting({ width: 800, height: null })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    const ihostItem = result.items[0] as { dimensions: string | null }
    expect(ihostItem.dimensions).toBeNull()
  })

  it('maps accessCount correctly', async () => {
    const img = makeImageHosting({ accessCount: 42 })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    const ihostItem = result.items[0] as { accessCount: number }
    expect(ihostItem.accessCount).toBe(42)
  })

  it('returns empty items when listIhostImages returns empty', async () => {
    vi.mocked(listIhostImages).mockResolvedValue({ items: [], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    expect(result.items).toHaveLength(0)
  })

  it('uses full path as name when path has no slash', async () => {
    const img = makeImageHosting({ path: 'photo.png' })
    vi.mocked(listIhostImages).mockResolvedValue({ items: [img], nextCursor: null })

    const result = await imageHostDataSource.list('', {})

    expect(result.items[0].name).toBe('photo.png')
  })
})

// ---------------------------------------------------------------------------
// upload()
// ---------------------------------------------------------------------------

describe('imageHostDataSource.upload', () => {
  beforeEach(() => {
    vi.mocked(createIhostImagePresign).mockResolvedValue({
      id: 'draft-1',
      token: 'tok_abc',
      path: '123_photo.png',
      uploadUrl: 'https://s3/presigned',
      storageKey: 'ih/tok_abc',
    })
    vi.mocked(uploadToS3).mockResolvedValue(undefined)
    vi.mocked(confirmIhostImage).mockResolvedValue({ id: 'draft-1', status: 'active' } as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls createIhostImagePresign with correct mime and size', async () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 1024 })

    await imageHostDataSource.upload(file)

    expect(createIhostImagePresign).toHaveBeenCalledWith(expect.objectContaining({ mime: 'image/png', size: 1024 }))
  })

  it('calls uploadToS3 with the presigned url and file', async () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' })

    await imageHostDataSource.upload(file)

    expect(uploadToS3).toHaveBeenCalledWith('https://s3/presigned', file)
  })

  it('calls confirmIhostImage with the draft id', async () => {
    const file = new File(['data'], 'photo.png', { type: 'image/png' })

    await imageHostDataSource.upload(file)

    expect(confirmIhostImage).toHaveBeenCalledWith('draft-1')
  })

  it('calls steps in order: presign → S3 upload → confirm', async () => {
    const order: string[] = []
    vi.mocked(createIhostImagePresign).mockImplementation(async () => {
      order.push('presign')
      return {
        id: 'draft-1',
        token: 'tok_abc',
        path: '123_photo.png',
        uploadUrl: 'https://s3/presigned',
        storageKey: 'ih/tok_abc',
      }
    })
    vi.mocked(uploadToS3).mockImplementation(async () => {
      order.push('s3')
    })
    vi.mocked(confirmIhostImage).mockImplementation(async () => {
      order.push('confirm')
      return { id: 'draft-1', status: 'active' } as never
    })

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    await imageHostDataSource.upload(file)

    expect(order).toEqual(['presign', 's3', 'confirm'])
  })

  it('generates path with timestamp and base filename', async () => {
    const file = new File(['data'], 'my photo.png', { type: 'image/png' })

    await imageHostDataSource.upload(file)

    const call = vi.mocked(createIhostImagePresign).mock.calls[0][0]
    // path should match: ${timestamp}_${sanitized_base}.${ext}
    expect(call.path).toMatch(/^\d+_my_photo\.png$/)
  })

  it('generates path with jpg ext for jpeg mime', async () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })

    await imageHostDataSource.upload(file)

    const call = vi.mocked(createIhostImagePresign).mock.calls[0][0]
    expect(call.path).toMatch(/\.jpg$/)
  })
})

// ---------------------------------------------------------------------------
// delete()
// ---------------------------------------------------------------------------

describe('imageHostDataSource.delete', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls deleteIhostImage with the provided id', async () => {
    vi.mocked(deleteIhostImage).mockResolvedValue(undefined as never)

    await imageHostDataSource.delete('img-42')

    expect(deleteIhostImage).toHaveBeenCalledWith('img-42')
    expect(deleteIhostImage).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// getThumbnailUrl()
// ---------------------------------------------------------------------------

describe('imageHostDataSource.getThumbnailUrl', () => {
  it('returns item.url when token is present', () => {
    const item = {
      id: 'img-1',
      orgId: 'org-1',
      alias: 'folder/photo.png',
      name: 'photo.png',
      type: 'image/png',
      size: 1024,
      dirtype: DirType.FILE,
      parent: '',
      object: 'ih/tok_abc',
      storageId: 'stor-1',
      status: 'active' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      token: 'tok_abc',
      url: '/r/tok_abc.png',
      dimensions: null,
      accessCount: 0,
    }

    const result = imageHostDataSource.getThumbnailUrl(item)

    expect(result).toBe('/r/tok_abc.png')
  })

  it('returns null when token is empty string', () => {
    const item = {
      id: 'img-1',
      orgId: 'org-1',
      alias: '',
      name: 'photo.png',
      type: 'image/png',
      size: 1024,
      dirtype: DirType.FILE,
      parent: '',
      object: '',
      storageId: 'stor-1',
      status: 'active' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      token: '',
      url: '/r/.png',
      dimensions: null,
      accessCount: 0,
    }

    const result = imageHostDataSource.getThumbnailUrl(item)

    expect(result).toBeNull()
  })

  it('returns null when token is falsy (undefined cast)', () => {
    const item = {
      id: 'img-1',
      orgId: 'org-1',
      alias: '',
      name: 'photo.png',
      type: 'image/png',
      size: 0,
      dirtype: DirType.FILE,
      parent: '',
      object: '',
      storageId: '',
      status: 'active' as const,
      createdAt: '',
      updatedAt: '',
      // No token or url — simulates a plain StorageObject cast to IhostItem
    }

    const result = imageHostDataSource.getThumbnailUrl(item as never)

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getShareUrl()
// ---------------------------------------------------------------------------

describe('imageHostDataSource.getShareUrl', () => {
  it('returns item.url', () => {
    const item = {
      id: 'img-1',
      orgId: 'org-1',
      alias: '',
      name: 'photo.png',
      type: 'image/png',
      size: 0,
      dirtype: DirType.FILE,
      parent: '',
      object: '',
      storageId: '',
      status: 'active' as const,
      createdAt: '',
      updatedAt: '',
      token: 'tok_abc',
      url: '/r/tok_abc.png',
      dimensions: null,
      accessCount: 0,
    }

    const result = imageHostDataSource.getShareUrl(item)

    expect(result).toBe('/r/tok_abc.png')
  })

  it('returns empty string when url is undefined/null', () => {
    const item = {
      id: 'img-1',
      orgId: 'org-1',
      alias: '',
      name: 'photo.png',
      type: 'image/png',
      size: 0,
      dirtype: DirType.FILE,
      parent: '',
      object: '',
      storageId: '',
      status: 'active' as const,
      createdAt: '',
      updatedAt: '',
    }

    const result = imageHostDataSource.getShareUrl(item as never)

    expect(result).toBe('')
  })
})

// ---------------------------------------------------------------------------
// getPreviewFile()
// ---------------------------------------------------------------------------

describe('imageHostDataSource.getPreviewFile', () => {
  it('returns PreviewFile with downloadUrl from item.url', async () => {
    const item = {
      id: 'img-1',
      orgId: 'org-1',
      alias: '',
      name: 'photo.png',
      type: 'image/png',
      size: 1024,
      dirtype: DirType.FILE,
      parent: '',
      object: '',
      storageId: '',
      status: 'active' as const,
      createdAt: '',
      updatedAt: '',
      token: 'tok_abc',
      url: '/r/tok_abc.png',
      dimensions: null,
      accessCount: 0,
    }

    const result = await imageHostDataSource.getPreviewFile(item)

    expect(result).toEqual({
      id: 'img-1',
      name: 'photo.png',
      type: 'image/png',
      size: 1024,
      downloadUrl: '/r/tok_abc.png',
    })
  })

  it('returns null when url is falsy', async () => {
    const item = {
      id: 'img-1',
      orgId: 'org-1',
      alias: '',
      name: 'photo.png',
      type: 'image/png',
      size: 0,
      dirtype: DirType.FILE,
      parent: '',
      object: '',
      storageId: '',
      status: 'active' as const,
      createdAt: '',
      updatedAt: '',
    }

    const result = await imageHostDataSource.getPreviewFile(item as never)

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// queryKeyPrefix
// ---------------------------------------------------------------------------

describe('imageHostDataSource.queryKeyPrefix', () => {
  it('has queryKeyPrefix ["ihost", "images"]', () => {
    expect(imageHostDataSource.queryKeyPrefix).toEqual(['ihost', 'images'])
  })
})
