import { expect, test } from '@playwright/test'
import { signInAsAdmin } from './helpers'

test.describe('Image custom-domain provider', () => {
  test('admin configures self-managed DNS and sees the ready state in English and Chinese @desktop', async ({
    page,
  }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/admin\/settings/)

    const card = page.locator('[data-settings-row]', {
      has: page.getByText('Image custom-domain provider', { exact: true }),
    })
    await expect(card).toContainText('Not configured')
    await card.getByRole('button', { name: 'Edit' }).click()

    const drawer = page.getByRole('dialog', { name: 'Image custom-domain provider' })
    await drawer.getByRole('switch', { name: 'Enable custom domains' }).click()
    await drawer.getByRole('combobox', { name: 'Provider' }).click()
    await page.getByRole('option', { name: 'Self-managed' }).click()
    await drawer.getByRole('textbox', { name: 'DNS records' }).fill('A 192.0.2.10\nAAAA 2001:db8::10')
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes('/api/site/settings/image-domains') &&
          response.request().method() === 'PUT' &&
          response.status() === 200,
      ),
      drawer.getByRole('button', { name: 'Save' }).click(),
    ])

    await expect(card).toContainText('Self-managed')
    await card.getByRole('button', { name: 'Test configuration' }).click()
    await expect(card).toContainText('Ready')
    await card.screenshot({ path: 'test-results/image-domain-provider-en.png' })

    await page.getByRole('button', { name: /E2E Admin/ }).click()
    await page.getByRole('menuitem', { name: 'Language' }).hover()
    await page.getByRole('menuitemradio', { name: '中文' }).click()

    const chineseCard = page.locator('[data-settings-row]', {
      has: page.getByText('图床自定义域名 Provider', { exact: true }),
    })
    await expect(chineseCard).toContainText('站长手动管理')
    await chineseCard.screenshot({ path: 'test-results/image-domain-provider-zh.png' })
  })
})
