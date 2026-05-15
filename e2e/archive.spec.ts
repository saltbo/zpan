import { randomBytes } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { DirType } from '../shared/constants'
import type { BackgroundJob, PaginatedResponse, StorageObject } from '../shared/types'
import { signUpAndGoToFiles } from './helpers'

const textType = 'text/plain'
const fixtureSize = 6 * 1024 * 1024

test.describe('Archive jobs with queued streaming workers @all', () => {
  test.setTimeout(120_000)

  test('compresses and extracts through the background queue', async ({ page }) => {
    await signUpAndGoToFiles(page)
    await seedFile(page, 'alpha.txt', randomBytes(fixtureSize))
    await seedFile(page, 'beta.txt', randomBytes(fixtureSize))
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
    await expect(page.getByRole('link', { name: /tasks/i })).toContainText('1')

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
    await expect(page.getByRole('link', { name: /tasks/i })).toContainText('1')

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
  const draft = (await draftResponse.json()) as StorageObject & { uploadUrl: string }
  expect(draft.uploadUrl).toBeTruthy()

  const uploadResponse = await page.request.put(draft.uploadUrl, {
    headers: { 'Content-Type': textType },
    data: bytes,
  })
  expect(uploadResponse.ok()).toBe(true)

  const confirmResponse = await page.request.patch(`/api/objects/${draft.id}`, {
    data: { action: 'confirm' },
  })
  expect(confirmResponse.ok()).toBe(true)
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
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const response = await page.request.get('/api/background-jobs?page=1&pageSize=20')
    expect(response.ok()).toBe(true)
    const body = (await response.json()) as PaginatedResponse<BackgroundJob>
    const job = body.items.find((item) => item.id === jobId)
    if (job?.status === 'completed') return job
    if (job?.status === 'failed') throw new Error(job.errorMessage ?? 'Archive job failed')
    await page.waitForTimeout(500)
  }
  throw new Error(`Timed out waiting for archive job ${jobId}`)
}

function isBackgroundJobPost(url: string, method: string) {
  return method === 'POST' && url.includes('/api/background-jobs')
}
