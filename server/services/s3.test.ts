import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  class MockCreateMultipartUploadCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockUploadPartCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockCompleteMultipartUploadCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockAbortMultipartUploadCommand {
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
    CreateMultipartUploadCommand: MockCreateMultipartUploadCommand,
    UploadPartCommand: MockUploadPartCommand,
    CompleteMultipartUploadCommand: MockCompleteMultipartUploadCommand,
    AbortMultipartUploadCommand: MockAbortMultipartUploadCommand,
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

  beforeEach(() => {
    mockSend.mockReset()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  describe('createClient', () => {
    it('creates a client with correct config', () => {
      const client = service.createClient(storage)
      expect(client.config).toMatchObject({
        region: 'us-east-1',
        endpoint: 'https://s3.example.com',
        requestChecksumCalculation: 'WHEN_REQUIRED',
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
    it('returns bytes from fetched object bodies', async () => {
      const bytes = new Uint8Array([1, 2, 3])
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(bytes)))

      await expect(service.getObjectBytes(storage, 'test.bin')).resolves.toEqual(bytes)
      expect(fetch).toHaveBeenCalledWith('https://signed-url.example.com', undefined)
    })

    it('sends Range when reading partial object bytes', async () => {
      const bytes = new Uint8Array([4, 5, 6])
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(bytes, { status: 206 })))

      await expect(service.getObjectBytes(storage, 'test.bin', 'bytes=0-2')).resolves.toEqual(bytes)
      expect(fetch).toHaveBeenCalledWith('https://signed-url.example.com', {
        headers: { Range: 'bytes=0-2' },
      })
    })

    it('rejects failed object reads', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })))

      await expect(service.getObjectBytes(storage, 'missing.bin')).rejects.toThrow('S3 object read failed: 404')
    })
  })

  describe('getObjectBody', () => {
    it('returns fetched ReadableStream bodies without buffering', async () => {
      const stream = new ReadableStream()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(stream)))

      await expect(service.getObjectBody(storage, 'test.bin')).resolves.toBe(stream)
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
      await expect(service.putObject(storage, 'images/test.png', body, 'image/png')).resolves.toBe(3)
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

    it('uploads small fixed-length ReadableStream bodies directly', async () => {
      mockSend.mockResolvedValueOnce({ $metadata: {} })
      const body = bytesStream(new Uint8Array([1, 2, 3]))

      await expect(service.putObject(storage, 'notes/test.txt', body, 'text/plain', 3)).resolves.toBe(3)

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: 'my-bucket',
            Key: 'notes/test.txt',
            Body: new Uint8Array([1, 2, 3]),
            ContentType: 'text/plain',
            ContentLength: 3,
          },
        }),
      )
    })

    it('rejects small fixed-length streams that do not match Content-Length', async () => {
      const body = bytesStream(new Uint8Array([1, 2, 3]))

      await expect(service.putObject(storage, 'notes/test.txt', body, 'text/plain', 4)).rejects.toThrow(
        'Request body length does not match Content-Length',
      )
    })

    it('uploads large ReadableStream bodies through a presigned PUT without buffering', async () => {
      mockSend.mockClear()
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)
      const body = new ReadableStream()
      await expect(service.putObject(storage, 'videos/test.mp4', body, 'video/mp4', 1024 * 1024)).resolves.toBe(
        1024 * 1024,
      )
      expect(fetchMock).toHaveBeenCalledWith('https://signed-url.example.com', {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '1048576',
        },
        body,
      })
      expect(mockSend).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('fails when presigned stream upload is rejected', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 })))
      await expect(
        service.putObject(storage, 'videos/test.mp4', new ReadableStream(), 'video/mp4', 1024 * 1024),
      ).rejects.toThrow('S3 stream upload failed: 403')
      vi.unstubAllGlobals()
    })

    it('uploads ReadableStream bodies without content length through multipart upload', async () => {
      mockSend.mockClear()
      mockSend
        .mockResolvedValueOnce({ UploadId: 'upload-1' })
        .mockResolvedValueOnce({ ETag: '"part-1"' })
        .mockResolvedValueOnce({ $metadata: {} })
      const body = bytesStream(new Uint8Array([1, 2, 3]))

      await expect(service.putObject(storage, 'videos/test.mp4', body, 'video/mp4')).resolves.toBe(3)

      expect(mockSend).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          input: { Bucket: 'my-bucket', Key: 'videos/test.mp4', ContentType: 'video/mp4' },
        }),
      )
      expect(mockSend).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          input: {
            Bucket: 'my-bucket',
            Key: 'videos/test.mp4',
            UploadId: 'upload-1',
            PartNumber: 1,
            Body: new Uint8Array([1, 2, 3]),
            ContentLength: 3,
          },
        }),
      )
      expect(mockSend).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          input: {
            Bucket: 'my-bucket',
            Key: 'videos/test.mp4',
            UploadId: 'upload-1',
            MultipartUpload: { Parts: [{ ETag: '"part-1"', PartNumber: 1 }] },
          },
        }),
      )
    })

    it('writes empty unknown-length streams as empty objects', async () => {
      mockSend.mockClear()
      mockSend.mockResolvedValueOnce({ UploadId: 'upload-1' }).mockResolvedValueOnce({}).mockResolvedValueOnce({})

      await expect(service.putObject(storage, 'empty.bin', bytesStream(), 'application/octet-stream')).resolves.toBe(0)

      expect(mockSend).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'empty.bin', UploadId: 'upload-1' } }),
      )
      expect(mockSend).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          input: {
            Bucket: 'my-bucket',
            Key: 'empty.bin',
            Body: new Uint8Array(),
            ContentType: 'application/octet-stream',
            ContentLength: 0,
          },
        }),
      )
    })

    it('aborts multipart upload when a part upload fails', async () => {
      mockSend.mockClear()
      mockSend
        .mockResolvedValueOnce({ UploadId: 'upload-1' })
        .mockRejectedValueOnce(new Error('part failed'))
        .mockResolvedValueOnce({})

      await expect(
        service.putObject(storage, 'fail.mp4', bytesStream(new Uint8Array([1])), 'video/mp4'),
      ).rejects.toThrow('part failed')

      expect(mockSend).toHaveBeenLastCalledWith(
        expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'fail.mp4', UploadId: 'upload-1' } }),
      )
    })

    it('propagates S3 errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('S3 put failed'))
      await expect(service.putObject(storage, 'fail.png', new Uint8Array(), 'image/png')).rejects.toThrow(
        'S3 put failed',
      )
    })
  })
})

function bytesStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}
