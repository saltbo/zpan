import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './helpers'

test.describe('Image custom-domain provider', () => {
  test('Community admin sees the Pro gate in English and Chinese @desktop', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/admin\/settings/)

    const card = page.locator('[data-settings-row]', {
      has: page.getByText('Image custom-domain provider', { exact: true }),
    })
    await expect(card).toContainText('Not configured')
    await expect(card).toContainText('Pro')
    await expect(card.getByRole('button', { name: 'Edit' })).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Set up and test' })).toBeDisabled()
    await expect(page.getByText('Unlock image custom domains')).toBeVisible()
    await card.screenshot({ path: 'test-results/image-domain-provider-pro-gate-en.png' })

    await page.getByRole('button', { name: /E2E Admin/ }).click()
    await page.getByRole('menuitem', { name: 'Language' }).hover()
    await page.getByRole('menuitemradio', { name: '中文' }).click()

    const chineseCard = page.locator('[data-settings-row]', {
      has: page.getByText('图床自定义域名 Provider', { exact: true }),
    })
    await expect(chineseCard).toContainText('Pro')
    await expect(chineseCard.getByRole('button', { name: '编辑' })).toBeDisabled()
    await expect(chineseCard.getByRole('button', { name: '自动设置并测试' })).toBeDisabled()
    await expect(page.getByText('解锁图床自定义域名')).toBeVisible()
    await chineseCard.screenshot({ path: 'test-results/image-domain-provider-pro-gate-zh.png' })
  })
})
