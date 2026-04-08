import type { Storage } from '@zpan/shared/types'
import { describe, expect, it, vi } from 'vitest'
import { S3Service } from './s3.js'

const mockSend = vi.fn()

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    config: unknown
    constructor(config: unknown) {
      this.config = config
    }
    send = mockSend
  }
  class MockPutObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockGetObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockHeadObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockCopyObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockDeleteObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockDeleteObjectsCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    HeadObjectCommand: MockHeadObjectCommand,
    CopyObjectCommand: MockCopyObjectCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
    DeleteObjectsCommand: MockDeleteObjectsCommand,
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed-url.example.com'),
}))

function makeStorage(overrides: Partial<Storage> = {}): Storage {
  return {
    id: 's1',
    uid: 'u1',
    title: 'Test',
    mode: 'private',
    bucket: 'my-bucket',
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    accessKey: 'AKID',
    secretKey: 'SECRET',
    filePath: '$UID/$RAW_NAME$RAW_EXT',
    customHost: '',
    status: 'active',
    capacity: 0,
    used: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

describe('S3Service', () => {
  const service = new S3Service()
  const storage = makeStorage()

  describe('createClient', () => {
    it('creates a client with correct config', () => {
      const client = service.createClient(storage)
      expect(client.config).toMatchObject({
        region: 'us-east-1',
        endpoint: 'https://s3.example.com',
        forcePathStyle: true,
      })
    })
  })

  describe('presignUpload', () => {
    it('returns a signed URL', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      const url = await service.presignUpload(storage, 'test.jpg', 'image/jpeg')
      expect(url).toBe('https://signed-url.example.com')
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'test.jpg', ContentType: 'image/jpeg' } }),
        { expiresIn: 3600 },
      )
    })

    it('respects custom expiresIn', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      await service.presignUpload(storage, 'test.jpg', 'image/jpeg', 600)
      expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 600 })
    })
  })

  describe('presignDownload', () => {
    it('returns a signed URL with Content-Disposition', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      const url = await service.presignDownload(storage, 'test.jpg', 'my photo.jpg')
      expect(url).toBe('https://signed-url.example.com')
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: expect.objectContaining({
            ResponseContentDisposition: 'attachment; filename="my%20photo.jpg"',
          }),
        }),
        expect.anything(),
      )
    })
  })

  describe('getPublicUrl', () => {
    it('uses customHost when available', () => {
      const s = makeStorage({ customHost: 'https://cdn.example.com' })
      expect(service.getPublicUrl(s, 'a/b.jpg')).toBe('https://cdn.example.com/a/b.jpg')
    })

    it('strips trailing slash from customHost', () => {
      const s = makeStorage({ customHost: 'https://cdn.example.com/' })
      expect(service.getPublicUrl(s, 'a/b.jpg')).toBe('https://cdn.example.com/a/b.jpg')
    })

    it('falls back to endpoint/bucket when no customHost', () => {
      expect(service.getPublicUrl(storage, 'a/b.jpg')).toBe('https://s3.example.com/my-bucket/a/b.jpg')
    })

    it('strips trailing slash from endpoint', () => {
      const s = makeStorage({ endpoint: 'https://s3.example.com/' })
      expect(service.getPublicUrl(s, 'a/b.jpg')).toBe('https://s3.example.com/my-bucket/a/b.jpg')
    })
  })

  describe('headObject', () => {
    it('returns size and contentType', async () => {
      mockSend.mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: 'image/png',
        $metadata: {},
      })
      const result = await service.headObject(storage, 'test.png')
      expect(result).toEqual({ size: 1024, contentType: 'image/png' })
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'test.png' } }),
      )
    })

    it('defaults size to 0 and contentType to application/octet-stream', async () => {
      mockSend.mockResolvedValueOnce({ $metadata: {} })
      const result = await service.headObject(storage, 'test.bin')
      expect(result).toEqual({ size: 0, contentType: 'application/octet-stream' })
    })
  })

  describe('copyObject', () => {
    it('sends CopyObjectCommand with correct CopySource', async () => {
      mockSend.mockResolvedValueOnce({ $metadata: {} })
      const dst = makeStorage({ bucket: 'dst-bucket' })
      await service.copyObject(storage, 'src.jpg', dst, 'dst.jpg')
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            CopySource: 'my-bucket/src.jpg',
            Bucket: 'dst-bucket',
            Key: 'dst.jpg',
          },
        }),
      )
    })
  })

  describe('deleteObject', () => {
    it('sends DeleteObjectCommand', async () => {
      mockSend.mockResolvedValueOnce({ $metadata: {} })
      await service.deleteObject(storage, 'test.jpg')
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'test.jpg' } }),
      )
    })
  })

  describe('deleteObjects', () => {
    it('sends DeleteObjectsCommand with keys', async () => {
      mockSend.mockResolvedValueOnce({ $metadata: {} })
      await service.deleteObjects(storage, ['a.jpg', 'b.jpg'])
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'my-bucket',
            Delete: { Objects: [{ Key: 'a.jpg' }, { Key: 'b.jpg' }] },
          },
        }),
      )
    })

    it('skips API call for empty keys array', async () => {
      mockSend.mockClear()
      await service.deleteObjects(storage, [])
      expect(mockSend).not.toHaveBeenCalled()
    })
  })
})
