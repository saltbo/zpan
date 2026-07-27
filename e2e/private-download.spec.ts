import { expect, type Page, test } from '@playwright/test'
import { DirType } from '../shared/constants'
import type { StorageObject } from '../shared/types'
import { signUpAndGoToFiles } from './helpers'

test.describe('Private S3 downloads @desktop', () => {
  test('keeps the signed S3 host and uses the latest English and Chinese filenames', async ({ page }) => {
    await signUpAndGoToFiles(page)

    const mp3 = await uploadFile(page, 'track.mp3', 'audio/mpeg')
    const mp4 = await uploadFile(page, 'movie.mp4', 'video/mp4')
    const image = await uploadFile(page, 'photo.png', 'image/png')

    await expectDownload(page, mp3.id, 'track.mp3')
    await expectDownload(page, mp4.id, 'movie.mp4')

    const rename = await page.request.patch(`/api/objects/${image.id}`, {
      data: { name: '中文 图片.png' },
    })
    expect(rename.ok()).toBe(true)
    await expectDownload(page, image.id, '中文 图片.png')
  })
})

async function uploadFile(page: Page, name: string, type: string): Promise<StorageObject> {
  const body = Buffer.from(`fixture:${name}`)
  const draftResponse = await page.request.post('/api/objects', {
    data: {
      name,
      type,
      size: body.byteLength,
      parent: '',
      dirtype: DirType.FILE,
    },
  })
  expect(draftResponse.ok()).toBe(true)
  const draft = (await draftResponse.json()) as StorageObject & {
    upload: { sessionId: string; urls: string[] }
  }
  expect(draft.upload.urls).toHaveLength(1)

  const uploadResponse = await page.request.put(draft.upload.urls[0], {
    headers: { 'Content-Type': type },
    data: body,
  })
  expect(uploadResponse.ok()).toBe(true)

  const completeResponse = await page.request.post(
    `/api/objects/${draft.id}/uploads/${draft.upload.sessionId}/completions`,
    { data: { parts: [{ partNumber: 1, etag: uploadResponse.headers().etag }] } },
  )
  expect(completeResponse.ok()).toBe(true)
  return draft
}

async function expectDownload(page: Page, objectId: string, filename: string): Promise<void> {
  const objectResponse = await page.request.get(`/api/objects/${objectId}`)
  expect(objectResponse.ok()).toBe(true)
  const object = (await objectResponse.json()) as StorageObject & { downloadUrl: string }
  const url = new URL(object.downloadUrl)

  expect(url.hostname).toBe('127.0.0.1')
  expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
  expect(url.searchParams.get('response-content-disposition')).toContain(
    `filename*=UTF-8''${encodeURIComponent(filename)}`,
  )

  const downloadResponse = await page.request.get(object.downloadUrl)
  expect(downloadResponse.ok()).toBe(true)
  expect(downloadResponse.headers()['content-disposition']).toContain(
    `filename*=UTF-8''${encodeURIComponent(filename)}`,
  )
}
