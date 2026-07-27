import { afterEach, describe, expect, it, vi } from 'vitest'
import type { S3StorageCredentials } from '../../usecases/ports'
import { S3Service } from './s3'

const storage: S3StorageCredentials = {
  bucket: 'bucket',
  endpoint: 'https://account.r2.cloudflarestorage.com',
  region: 'auto',
  accessKey: 'access-key',
  secretKey: 'secret-key',
  customHost: null,
  forcePathStyle: true,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('S3Service upload metadata presigning', () => {
  it('keeps Content-Disposition out of single-PUT SignedHeaders', async () => {
    const url = await new S3Service().presignUpload(storage, 'audio.mp3', 'audio/mpeg', '中文音频.mp3')

    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(['host'])
  })

  it('keeps Content-Disposition out of multipart-create SignedHeaders', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response('<CreateMultipartUploadResult><UploadId>upload-1</UploadId></CreateMultipartUploadResult>'),
      )
    vi.stubGlobal('fetch', fetchMock)

    await new S3Service().createMultipartUpload(storage, 'video.mp4', 'video/mp4', '中文视频.mp4')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(['host'])
  })
})
