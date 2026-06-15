import { expect, test } from '@playwright/test'
import { signInAsAdmin, signUpAndGoToFiles } from './helpers'

test.describe('Site announcements', () => {
  test('admin publishes an announcement and user sees it in the announcement modal @desktop', async ({ page }) => {
    const suffix = Date.now()
    const title = `E2E announcement ${suffix}`
    const listItem = `Announcement markdown item ${suffix}`
    const body = `**Announcement body ${suffix}**\n\n- ${listItem}`
    let announcementId = ''

    try {
      await signInAsAdmin(page)
      await page.goto('/admin/announcement')
      await expect(page).toHaveURL(/admin\/announcement/, { timeout: 10000 })

      await page.getByRole('button', { name: 'New Announcement' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('textbox', { name: 'Title' }).fill(title)
      await dialog.getByRole('textbox', { name: 'Body' }).fill(body)
      await dialog.getByRole('switch', { name: 'Pin announcement' }).click()
      await expect(dialog.locator('li', { hasText: listItem })).toBeVisible()

      const [createResp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/announcements') && r.request().method() === 'POST'),
        dialog.getByRole('button', { name: 'Save' }).click(),
      ])
      expect(createResp.status()).toBe(201)
      const created = (await createResp.json()) as { id: string }
      announcementId = created.id
      await expect(dialog).not.toBeVisible({ timeout: 10000 })

      const row = page.locator('tr', { hasText: title })
      await expect(row).toBeVisible()
      const [publishResp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/announcements') && r.request().method() === 'PUT'),
        row.getByRole('button', { name: 'Publish' }).click(),
      ])
      expect(publishResp.ok()).toBe(true)
      await expect(row.getByText('Published', { exact: true })).toBeVisible()

      await page.context().clearCookies()
      await signUpAndGoToFiles(page)
      const userDialog = page.getByRole('dialog')
      const userAnnouncement = userDialog.locator('section', { hasText: title })
      await expect(userAnnouncement).toBeVisible()
      await expect(userAnnouncement.getByText('Pinned', { exact: true })).toBeVisible()
      await expect(userAnnouncement.locator('li', { hasText: listItem })).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).not.toBeVisible()
      await page.getByRole('button', { name: 'Notifications' }).click()
      await page.getByRole('button', { name: 'Site Announcements' }).click()
      await expect(userAnnouncement).toBeVisible()
      await expect(userAnnouncement.getByText('Pinned', { exact: true })).toBeVisible()
      await expect(userAnnouncement.locator('li', { hasText: listItem })).toBeVisible()
    } finally {
      if (announcementId) {
        await signInAsAdmin(page)
        const deleteResult = await page.evaluate(async (id) => {
          const res = await fetch(`/api/announcements/${id}`, {
            method: 'DELETE',
            credentials: 'include',
          })
          return res.status
        }, announcementId)
        expect([200, 404]).toContain(deleteResult)
      }
    }
  })
})
