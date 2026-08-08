import { expect, type Page, test } from '@playwright/test'
import { DirType } from '../shared/constants'
import type { BackgroundJob, PaginatedResponse, StorageObject } from '../shared/types'
import { signUpAndGoToFiles } from './helpers'

const textType = 'text/plain'
const fixtureSize = 6 * 1024 * 1024

test.describe('Archive jobs with queued streaming workers @all @critical', () => {
  test.setTimeout(120_000)

  test('compresses and extracts through the background queue', async ({ page }) => {
    await signUpAndGoToFiles(page)
    await seedFile(page, 'alpha.txt', fixtureBytes(fixtureSize, 0x13579bdf))
    await seedFile(page, 'beta.txt', fixtureBytes(fixtureSize, 0x2468ace0))
    await page.reload()

    await selectFile(page, 'alpha.txt')
    await selectFile(page, 'beta.txt')
    await expect(page.getByTestId('files-toolbar-selection')).toContainText('2 selected')

    const [compressResponse] = await Promise.all([
      page.waitForResponse((response) => isBackgroundJobPost(response.url(), response.request().method())),
      page.getByTitle('Compress').click(),
    ])
    expect(compressResponse.ok()).toBe(true)
    const compressJob = (await compressResponse.json()) as BackgroundJob
    expect(compressJob.status).toBe('queued')
    await expect(page.getByText('Background task created')).toBeVisible()

    await expectJobCompleted(page, compressJob.id)
    await page.goto('/tasks')
    await page.getByRole('button', { name: 'Completed' }).click()
    await expect(page.getByText('selection.zip')).toBeVisible()

    await page.goto('/files')
    await expect(page.getByRole('cell', { name: 'selection.zip' })).toBeVisible()

    const [extractResponse] = await Promise.all([
      page.waitForResponse((response) => isBackgroundJobPost(response.url(), response.request().method())),
      openRowAction(page, 'selection.zip', 'Extract'),
    ])
    expect(extractResponse.ok()).toBe(true)
    const extractJob = (await extractResponse.json()) as BackgroundJob
    expect(extractJob.status).toBe('queued')

    await expectJobCompleted(page, extractJob.id)
    await page.goto('/files')
    await expect(page.getByRole('cell', { name: 'alpha (1).txt' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'beta (1).txt' })).toBeVisible()
  })
})

async function seedFile(page: Page, name: string, bytes: Buffer) {
  const draftResponse = await page.request.post('/api/objects', {
    data: {
      name,
      type: textType,
      size: bytes.byteLength,
      parent: '',
      dirtype: DirType.FILE,
    },
  })
  expect(draftResponse.ok()).toBe(true)
  const draft = (await draftResponse.json()) as StorageObject & {
    upload: { sessionId: string; partSize: number; urls: string[] }
  }
  // Small fixture → single PutObject (one URL).
  expect(draft.upload?.urls?.length).toBe(1)

  const uploadResponse = await page.request.put(draft.upload.urls[0], {
    headers: { 'Content-Type': textType },
    data: bytes,
  })
  expect(uploadResponse.ok()).toBe(true)
  const etag = uploadResponse.headers().etag

  const completeResponse = await page.request.post(
    `/api/objects/${draft.id}/uploads/${draft.upload.sessionId}/completions`,
    { data: { parts: [{ partNumber: 1, etag }] } },
  )
  expect(completeResponse.ok()).toBe(true)
}

async function selectFile(page: Page, name: string) {
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible()
  await row.getByRole('checkbox').check()
}

async function openRowAction(page: Page, fileName: string, action: string) {
  const row = page.getByRole('row').filter({ hasText: fileName })
  await row.getByRole('button').last().click()
  await page.getByRole('menuitem', { name: action }).click()
}

async function expectJobCompleted(page: Page, jobId: string): Promise<BackgroundJob> {
  let completed: BackgroundJob | undefined
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/background-jobs?page=1&pageSize=20')
        expect(response.ok()).toBe(true)
        const body = (await response.json()) as PaginatedResponse<BackgroundJob>
        const job = body.items.find((item) => item.id === jobId)
        if (job?.status === 'failed') throw new Error(job.errorMessage ?? 'Archive job failed')
        if (job?.status === 'completed') completed = job
        return job?.status
      },
      { timeout: 60_000 },
    )
    .toBe('completed')
  if (!completed) throw new Error(`Archive job ${jobId} completed without a result`)
  return completed
}

function isBackgroundJobPost(url: string, method: string) {
  return method === 'POST' && url.includes('/api/background-jobs')
}

function fixtureBytes(size: number, seed: number): Buffer {
  const bytes = Buffer.allocUnsafe(size)
  let state = seed
  for (let index = 0; index < size; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state
  }
  return bytes
}
