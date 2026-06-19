import { expect, test } from '@playwright/test'
import { signUpAndGoToFiles } from './helpers'

function makeFiles(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `very-long-mobile-upload-file-name-${index}-${Date.now()}-that-should-truncate-in-the-uploader-panel.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(`upload fixture ${index}`),
  }))
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const hasHScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(hasHScroll).toBe(false)
}

test.describe('Uploader responsive behavior', () => {
  test('mobile: multi-file upload opens uploader, truncates long names, and scrolls vertically @mobile', async ({
    page,
  }) => {
    await signUpAndGoToFiles(page)

    await page.route('**/*', async (route) => {
      if (route.request().method() === 'PUT') {
        // The unified slice uploader reads the ETag from each S3 PUT response.
        await route.fulfill({ status: 200, headers: { ETag: '"e2e-etag"' }, body: '' })
        return
      }
      await route.continue()
    })

    const files = makeFiles(12)
    await page.locator('input[type="file"]').first().setInputFiles(files)

    const popover = page.getByTestId('upload-popover')
    await expect(popover).toBeVisible({ timeout: 10000 })
    await expect(popover).toContainText('Uploads')
    await expect(popover).toContainText(files[0].name)

    const taskList = page.getByTestId('upload-task-list')
    await expect(taskList).toBeVisible()

    await expectNoHorizontalOverflow(page)

    const layout = await taskList.evaluate((el) => {
      const styles = window.getComputedStyle(el)
      return {
        overflowX: styles.overflowX,
        overflowY: styles.overflowY,
        scrollsVertically: el.scrollHeight > el.clientHeight,
      }
    })
    expect(layout.overflowX).toBe('hidden')
    expect(layout.overflowY).toBe('auto')
    expect(layout.scrollsVertically).toBe(true)

    const firstFileName = page.getByText(files[0].name)
    await expect(firstFileName).toBeVisible()
    const fileNameLayout = await firstFileName.evaluate((el) => {
      const styles = window.getComputedStyle(el)
      return {
        overflow: styles.overflow,
        textOverflow: styles.textOverflow,
        whiteSpace: styles.whiteSpace,
      }
    })
    expect(fileNameLayout.overflow).toBe('hidden')
    expect(fileNameLayout.textOverflow).toBe('ellipsis')
    expect(fileNameLayout.whiteSpace).toBe('nowrap')
  })
})
