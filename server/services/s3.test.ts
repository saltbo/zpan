import { describe, expect, it, vi } from 'vitest'
import type { Storage } from '../../shared/types'
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
    customHost: '',
    capacity: 0,
    used: 0,
    status: 'active',
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

  describe('presignInline', () => {
    it('returns a signed URL with inline Content-Disposition and ResponseContentType', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      const url = await service.presignInline(storage, 'images/photo.jpg', 'image/jpeg')
      expect(url).toBe('https://signed-url.example.com')
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: expect.objectContaining({
            ResponseContentDisposition: 'inline',
            ResponseContentType: 'image/jpeg',
          }),
        }),
        expect.anything(),
      )
    })

    it('respects custom expiresIn', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      await service.presignInline(storage, 'img.png', 'image/png', 600)
      expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 600 })
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

  describe('getObjectBytes', () => {
    it('returns bytes from Uint8Array bodies', async () => {
      const bytes = new Uint8Array([1, 2, 3])
      mockSend.mockResolvedValueOnce({ Body: bytes })

      await expect(service.getObjectBytes(storage, 'test.bin')).resolves.toEqual(bytes)
    })

    it('returns bytes from ReadableStream bodies', async () => {
      const bytes = new Uint8Array([4, 5, 6])
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })
      mockSend.mockResolvedValueOnce({ Body: stream })

      await expect(service.getObjectBytes(storage, 'test.bin')).resolves.toEqual(bytes)
    })

    it('returns bytes from transformToByteArray bodies', async () => {
      const bytes = new Uint8Array([1, 2, 3])
      mockSend.mockResolvedValueOnce({
        Body: { transformToByteArray: async () => bytes },
      })

      await expect(service.getObjectBytes(storage, 'test.bin')).resolves.toEqual(bytes)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'test.bin' } }),
      )
    })

    it('returns bytes from arrayBuffer bodies', async () => {
      const bytes = new Uint8Array([7, 8, 9])
      mockSend.mockResolvedValueOnce({
        Body: { arrayBuffer: async () => bytes.buffer },
      })

      await expect(service.getObjectBytes(storage, 'test.bin')).resolves.toEqual(bytes)
    })

    it('rejects empty object bodies', async () => {
      mockSend.mockResolvedValueOnce({})

      await expect(service.getObjectBytes(storage, 'missing.bin')).rejects.toThrow('Empty body from object')
    })

    it('rejects unsupported object bodies', async () => {
      mockSend.mockResolvedValueOnce({ Body: {} })

      await expect(service.getObjectBytes(storage, 'test.bin')).rejects.toThrow('Unsupported object body')
    })
  })

  describe('getObjectBody', () => {
    it('returns ReadableStream bodies without buffering', async () => {
      const stream = new ReadableStream()
      mockSend.mockResolvedValueOnce({ Body: stream })

      await expect(service.getObjectBody(storage, 'test.bin')).resolves.toBe(stream)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'test.bin' } }),
      )
    })

    it('returns Uint8Array bodies as a response body', async () => {
      const bytes = new Uint8Array([1, 2, 3])
      mockSend.mockResolvedValueOnce({ Body: bytes })

      const body = await service.getObjectBody(storage, 'test.bin')
      await expect(new Response(body).arrayBuffer()).resolves.toEqual(bytes.buffer)
    })

    it('uses transformToWebStream bodies without converting to bytes', async () => {
      const stream = new ReadableStream()
      const body = {
        transformToByteArray: vi.fn(),
        transformToWebStream: vi.fn(() => stream),
      }
      mockSend.mockResolvedValueOnce({ Body: body })

      await expect(service.getObjectBody(storage, 'test.bin', 'bytes=0-4')).resolves.toBe(stream)
      expect(body.transformToByteArray).not.toHaveBeenCalled()
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'test.bin', Range: 'bytes=0-4' } }),
      )
    })

    it('rejects empty object bodies', async () => {
      mockSend.mockResolvedValueOnce({})

      await expect(service.getObjectBody(storage, 'missing.bin')).rejects.toThrow('Empty body from object')
    })

    it('rejects unsupported object bodies', async () => {
      mockSend.mockResolvedValueOnce({ Body: {} })

      await expect(service.getObjectBody(storage, 'test.bin')).rejects.toThrow('Unsupported object body')
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
    it('sends individual DeleteObjectCommand for each key', async () => {
      mockSend.mockResolvedValue({ $metadata: {} })
      await service.deleteObjects(storage, ['a.jpg', 'b.jpg'])
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'a.jpg' } }))
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'b.jpg' } }))
    })

    it('skips API call for empty keys array', async () => {
      mockSend.mockClear()
      await service.deleteObjects(storage, [])
      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  describe('putObject', () => {
    it('sends PutObjectCommand with correct params for Uint8Array body', async () => {
      mockSend.mockResolvedValueOnce({ $metadata: {} })
      const body = new Uint8Array([1, 2, 3])
      await service.putObject(storage, 'images/test.png', body, 'image/png')
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'my-bucket',
            Key: 'images/test.png',
            Body: body,
            ContentType: 'image/png',
            ContentLength: 3,
          },
        }),
      )
    })

    it('sends ReadableStream bodies without buffering when content length is known', async () => {
      mockSend.mockResolvedValueOnce({ $metadata: {} })
      const body = new ReadableStream()
      await service.putObject(storage, 'videos/test.mp4', body, 'video/mp4', 1024)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'my-bucket',
            Key: 'videos/test.mp4',
            Body: body,
            ContentType: 'video/mp4',
            ContentLength: 1024,
          },
        }),
      )
    })

    it('rejects streaming bodies without content length', async () => {
      mockSend.mockClear()
      await expect(service.putObject(storage, 'videos/test.mp4', new ReadableStream(), 'video/mp4')).rejects.toThrow(
        'Content-Length required for streaming object uploads',
      )
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('propagates S3 errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('S3 put failed'))
      await expect(service.putObject(storage, 'fail.png', new Uint8Array(), 'image/png')).rejects.toThrow(
        'S3 put failed',
      )
    })
  })
})
