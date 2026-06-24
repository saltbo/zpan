import type { Storage } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    bucket: 'my-bucket',
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    accessKey: 'AKID',
    secretKey: 'SECRET',
    filePath: '',
    customHost: '',
    capacity: 0,
    egressCreditBillingEnabled: false,
    egressCreditUnitBytes: 104857600,
    egressCreditPerUnit: 1,
    forcePathStyle: true,
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

    it('uses forcePathStyle: false when storage has it disabled', () => {
      const s = makeStorage({ forcePathStyle: false })
      const client = service.createClient(s)
      expect(client.config).toMatchObject({
        forcePathStyle: false,
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

    it('includes Content-Disposition metadata when filename is provided', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      await service.presignUpload(storage, 'test.jpg', 'image/jpeg', 'my file.jpg')
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: expect.objectContaining({
            ContentDisposition: 'attachment; filename="my file.jpg"; filename*=UTF-8\'\'my%20file.jpg',
          }),
        }),
        expect.anything(),
      )
    })

    it('does not apply customHost to the signed URL to support PUT write uploads', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      vi.mocked(getSignedUrl).mockResolvedValueOnce('https://s3.example.com/my-bucket/test.jpg?X-Amz-Signature=abc')
      const s = makeStorage({ customHost: 'https://cdn.example.com' })
      const url = await service.presignUpload(s, 'test.jpg', 'image/jpeg')
      expect(url).toBe('https://s3.example.com/my-bucket/test.jpg?X-Amz-Signature=abc')
    })

    it('leaves URL unchanged when customHost is empty', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      vi.mocked(getSignedUrl).mockResolvedValueOnce('https://s3.example.com/my-bucket/test.jpg?X-Amz-Signature=abc')
      const url = await service.presignUpload(storage, 'test.jpg', 'image/jpeg')
      expect(url).toBe('https://s3.example.com/my-bucket/test.jpg?X-Amz-Signature=abc')
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
            ResponseContentDisposition: 'attachment; filename="my photo.jpg"; filename*=UTF-8\'\'my%20photo.jpg',
          }),
        }),
        expect.anything(),
      )
    })

    it('applies customHost to the signed URL and omits the bucket name from the path', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      vi.mocked(getSignedUrl).mockResolvedValueOnce('https://s3.example.com/my-bucket/test.jpg?X-Amz-Signature=abc')
      const s = makeStorage({ customHost: 'https://cdn.example.com' })
      const url = await service.presignDownload(s, 'test.jpg', 'test.jpg')
      expect(url).toBe('https://cdn.example.com/test.jpg?X-Amz-Signature=abc')
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

    it('applies customHost to the signed URL and omits the bucket name from the path', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      vi.mocked(getSignedUrl).mockResolvedValueOnce(
        'https://s3.example.com/my-bucket/images/photo.jpg?X-Amz-Signature=abc',
      )
      const s = makeStorage({ customHost: 'https://cdn.example.com' })
      const url = await service.presignInline(s, 'images/photo.jpg', 'image/jpeg')
      expect(url).toBe('https://cdn.example.com/images/photo.jpg?X-Amz-Signature=abc')
    })
  })

  describe('multipart upload controls', () => {
    it('creates multipart uploads through a presigned POST and parses upload id', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('<CreateMultipartUploadResult><UploadId>upload-1</UploadId></CreateMultipartUploadResult>'),
        )
      vi.stubGlobal('fetch', fetchMock)

      await expect(service.createMultipartUpload(storage, 'video.mp4', 'video/mp4')).resolves.toBe('upload-1')

      expect(fetchMock).toHaveBeenCalledWith('https://signed-url.example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4' },
      })
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('fails create multipart uploads when S3 omits the upload id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('<CreateMultipartUploadResult />')))

      await expect(service.createMultipartUpload(storage, 'video.mp4', 'video/mp4')).rejects.toThrow(
        'S3 multipart upload did not return an upload id',
      )
    })

    it('completes multipart uploads through a presigned POST XML body', async () => {
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response('<CompleteMultipartUploadResult />'))
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        service.completeMultipartUpload(storage, 'video.mp4', 'upload-1', [
          { partNumber: 2, etag: '"etag&2"' },
          { partNumber: 1, etag: '"etag-1"' },
        ]),
      ).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledWith('https://signed-url.example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;etag-1&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;etag&amp;2&quot;</ETag></Part></CompleteMultipartUpload>',
      })
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: { Bucket: 'my-bucket', Key: 'video.mp4', UploadId: 'upload-1' },
        }),
        expect.anything(),
      )
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('rejects embedded S3 complete errors returned with HTTP 200', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response('<Error><Code>InvalidPart</Code><Message>part does not exist</Message></Error>'),
          ),
      )

      await expect(
        service.completeMultipartUpload(storage, 'video.mp4', 'upload-1', [{ partNumber: 1, etag: '"etag-1"' }]),
      ).rejects.toThrow('InvalidPart')
    })

    it('aborts multipart uploads through a presigned DELETE', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(service.abortMultipartUpload(storage, 'video.mp4', 'upload-1')).resolves.toBeUndefined()

      expect(fetchMock).toHaveBeenCalledWith('https://signed-url.example.com', { method: 'DELETE' })
      expect(mockSend).not.toHaveBeenCalled()
    })
  })

  describe('headObject', () => {
    it('returns size, contentType, and the quote-stripped etag', async () => {
      mockSend.mockResolvedValueOnce({
        ContentLength: 1024,
        ContentType: 'image/png',
        ETag: '"abc123"',
        $metadata: {},
      })
      const result = await service.headObject(storage, 'test.png')
      expect(result).toEqual({ size: 1024, contentType: 'image/png', etag: 'abc123' })
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'test.png' } }),
      )
    })

    it('defaults size to 0, contentType to application/octet-stream, and etag to empty', async () => {
      mockSend.mockResolvedValueOnce({ $metadata: {} })
      const result = await service.headObject(storage, 'test.bin')
      expect(result).toEqual({ size: 0, contentType: 'application/octet-stream', etag: '' })
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
      mockSend.mockResolvedValueOnce({ ETag: '"part-1"' })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('<CreateMultipartUploadResult><UploadId>upload-1</UploadId></CreateMultipartUploadResult>'),
        )
        .mockResolvedValueOnce(new Response('<CompleteMultipartUploadResult />'))
      vi.stubGlobal('fetch', fetchMock)
      const body = bytesStream(new Uint8Array([1, 2, 3]))

      await expect(service.putObject(storage, 'videos/test.mp4', body, 'video/mp4')).resolves.toBe(3)

      expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://signed-url.example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'video/mp4' },
      })
      expect(mockSend).toHaveBeenCalledWith(
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
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://signed-url.example.com',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('writes empty unknown-length streams as empty objects', async () => {
      mockSend.mockClear()
      mockSend.mockResolvedValueOnce({})
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('<CreateMultipartUploadResult><UploadId>upload-1</UploadId></CreateMultipartUploadResult>'),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(service.putObject(storage, 'empty.bin', bytesStream(), 'application/octet-stream')).resolves.toBe(0)

      expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://signed-url.example.com', { method: 'DELETE' })
      expect(mockSend).toHaveBeenNthCalledWith(
        1,
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
      mockSend.mockRejectedValueOnce(new Error('part failed'))
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('<CreateMultipartUploadResult><UploadId>upload-1</UploadId></CreateMultipartUploadResult>'),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        service.putObject(storage, 'fail.mp4', bytesStream(new Uint8Array([1])), 'video/mp4'),
      ).rejects.toThrow('part failed')

      expect(fetchMock).toHaveBeenLastCalledWith('https://signed-url.example.com', { method: 'DELETE' })
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
